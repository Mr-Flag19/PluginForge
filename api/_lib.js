// Shared helpers for the PluginForge API. Files starting with "_" are not exposed as routes.
const crypto = require('crypto');

const REDIS_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

const ID_RE = /^[a-z0-9]{16}$/;
const ACCOUNT_RE = /^[A-Za-z0-9-]{1,64}$/;
const ID_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';
const INDEX_KEY = 'projects:index';
const MAX_MESSAGES = 200;
const MAX_BYTES = 200 * 1024;
const MAX_PROJECTS_PER_USER = 200;

function configured() {
  return Boolean(REDIS_URL && REDIS_TOKEN);
}

async function redis(command) {
  const r = await fetch(REDIS_URL, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + REDIS_TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
  });
  const data = await r.json();
  if (!r.ok || data.error) throw new Error(data.error || 'Database error ' + r.status);
  return data.result;
}

// 16 random characters, every character equally likely
function newId() {
  let id = '';
  while (id.length < 16) {
    for (const b of crypto.randomBytes(32)) {
      if (b < 252 && id.length < 16) id += ID_CHARS[b % 36];
    }
  }
  return id;
}

const key = (id) => 'project:' + id;
const userIndexKey = (accountId) => 'user:' + accountId + ':projects';

// ---- Plans and generation usage ----
// Limits match the pricing page. Stone refills 24 hours after the first prompt made once it was full again
// (a rolling window, not midnight). Iron and Diamond reset on the 1st of each month (UTC).
// A plan is stored per account at user:<id>:tier ("stone", "iron" or "diamond"). No key means Stone.
const TIERS = {
  stone: { name: 'Stone', limit: 5, period: 'day' },
  iron: { name: 'Iron', limit: 250, period: 'month' },
  diamond: { name: 'Diamond', limit: 1000, period: 'month' },
};
const tierKey = (accountId) => 'user:' + accountId + ':tier';
const usageKey = (accountId, period, label) => 'usage:' + accountId + ':' + period + ':' + label;

// The current day and month (UTC) and when each one ends
function periodInfo(now = new Date()) {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const d = now.getUTCDate();
  const mm = String(m + 1).padStart(2, '0');
  const dd = String(d).padStart(2, '0');
  return {
    day: { label: y + '-' + mm + '-' + dd, resetsAt: Date.UTC(y, m, d + 1) },
    month: { label: y + '-' + mm, resetsAt: Date.UTC(y, m + 1, 1) },
  };
}

async function getTier(accountId) {
  const t = await redis(['GET', tierKey(accountId)]);
  return Object.prototype.hasOwnProperty.call(TIERS, t) ? t : 'stone';
}

const WINDOW_MS = 24 * 60 * 60 * 1000;
const windowKey = (accountId) => 'usage:' + accountId + ':window';
const windowStartKey = (accountId) => 'usage:' + accountId + ':windowstart';
// An admin can move the refill time of a monthly plan. This holds that time (ms) until it passes.
const monthResetKey = (accountId) => 'usage:' + accountId + ':monthreset';
const ttlFor = (ms, now) => String(Math.max(60, Math.ceil((ms - now.getTime()) / 1000)) + 3600);

// The 24 hour window is running if the first prompt of it was made less than 24 hours ago
async function getWindow(accountId, now) {
  const start = Number(await redis(['GET', windowStartKey(accountId)])) || 0;
  if (start && now.getTime() < start + WINDOW_MS) return { start, resetsAt: start + WINDOW_MS };
  return null;
}

// A moved refill time on a monthly plan, or null when there is none or it has passed
async function getMonthOverride(accountId, now) {
  const ov = Number(await redis(['GET', monthResetKey(accountId)])) || 0;
  return ov && now.getTime() < ov ? ov : null;
}

// What this account has used so far in the current period of its plan.
// resetsAt is null for a Stone account whose window has not started yet (nothing used since the last refill).
// An admin can hand out extra prompts, so left can be higher than the limit (bonus).
async function getUsage(accountId, now = new Date()) {
  const tier = await getTier(accountId);
  const plan = TIERS[tier];
  let raw = 0;
  let resetsAt = null;
  if (plan.period === 'day') {
    const w = await getWindow(accountId, now);
    if (w) {
      raw = Number(await redis(['GET', windowKey(accountId)])) || 0;
      resetsAt = w.resetsAt;
    }
  } else {
    const p = periodInfo(now).month;
    const ov = await getMonthOverride(accountId, now);
    const stale = !ov && Number(await redis(['GET', monthResetKey(accountId)])) > 0; // the moved time has passed: a refill happened
    raw = stale ? 0 : Number(await redis(['GET', usageKey(accountId, 'month', p.label)])) || 0;
    resetsAt = ov || p.resetsAt;
  }
  const left = Math.max(0, plan.limit - raw);
  return {
    tier, tierName: plan.name, period: plan.period, limit: plan.limit,
    used: Math.max(0, raw), left, bonus: Math.max(0, left - plan.limit), resetsAt,
  };
}

// One generation per prompt. Both counters move, so changing plan never loses history.
async function addUsage(accountId, count, now = new Date()) {
  if (!(count > 0)) return;
  const ttl = String(Math.ceil(WINDOW_MS / 1000) + 3600);
  const w = await getWindow(accountId, now);
  if (w) {
    await redis(['INCRBY', windowKey(accountId), String(count)]);
  } else {
    // First prompt since the last refill: this starts a new 24 hour window
    await redis(['SET', windowKey(accountId), String(count), 'EX', ttl]);
    await redis(['SET', windowStartKey(accountId), String(now.getTime()), 'EX', ttl]);
  }
  const monthKey = usageKey(accountId, 'month', periodInfo(now).month.label);
  const ov = await getMonthOverride(accountId, now);
  const passed = !ov && Number(await redis(['GET', monthResetKey(accountId)])) > 0;
  if (passed) {
    // A refill time set by an admin has passed: the count starts again from this prompt
    await redis(['DEL', monthResetKey(accountId)]);
    await redis(['SET', monthKey, String(count), 'EX', String(40 * 24 * 3600)]);
    return;
  }
  await redis(['INCRBY', monthKey, String(count)]);
  await redis(['EXPIRE', monthKey, String(40 * 24 * 3600)]);
}

// ---- Admin controls for one account ----
async function setTier(accountId, tier) {
  if (!Object.prototype.hasOwnProperty.call(TIERS, tier)) throw new Error('Unknown tier');
  await redis(['SET', tierKey(accountId), tier]);
}

// Set how many prompts the account has left right now (it can be more than the plan limit)
async function setPromptsLeft(accountId, left, now = new Date()) {
  const tier = await getTier(accountId);
  const plan = TIERS[tier];
  const used = plan.limit - left; // negative when extra prompts are handed out
  if (plan.period === 'day') {
    const w = await getWindow(accountId, now);
    if (w) {
      await redis(['SET', windowKey(accountId), String(used), 'EX', ttlFor(w.resetsAt, now)]);
    } else if (used !== 0) {
      // Nothing used yet, so there is no window. Start one so the change has a refill time.
      const ttl = String(Math.ceil(WINDOW_MS / 1000) + 3600);
      await redis(['SET', windowKey(accountId), String(used), 'EX', ttl]);
      await redis(['SET', windowStartKey(accountId), String(now.getTime()), 'EX', ttl]);
    }
  } else {
    const ov = await getMonthOverride(accountId, now);
    if (!ov) await redis(['DEL', monthResetKey(accountId)]);
    await redis(['SET', usageKey(accountId, 'month', periodInfo(now).month.label), String(used), 'EX', String(40 * 24 * 3600)]);
  }
}

// Give everything back now
async function refillNow(accountId, now = new Date()) {
  const tier = await getTier(accountId);
  if (TIERS[tier].period === 'day') {
    await redis(['DEL', windowKey(accountId)]);
    await redis(['DEL', windowStartKey(accountId)]);
  } else {
    await redis(['DEL', usageKey(accountId, 'month', periodInfo(now).month.label)]);
    await redis(['DEL', monthResetKey(accountId)]);
  }
}

// Choose when the prompts refill (a time in ms, in the future)
async function setRefillAt(accountId, at, now = new Date()) {
  const tier = await getTier(accountId);
  if (TIERS[tier].period === 'day') {
    const w = await getWindow(accountId, now);
    const used = w ? Number(await redis(['GET', windowKey(accountId)])) || 0 : 0;
    const ttl = ttlFor(at, now);
    await redis(['SET', windowKey(accountId), String(used), 'EX', ttl]);
    await redis(['SET', windowStartKey(accountId), String(at - WINDOW_MS), 'EX', ttl]);
  } else {
    await redis(['SET', monthResetKey(accountId), String(at), 'EX', ttlFor(at, now)]);
  }
}

// Stamp each message with the time it was first saved, keeping the time of messages that were already stored
function stampMessages(messages, oldMessages, now) {
  const old = Array.isArray(oldMessages) ? oldMessages : [];
  return messages.map((m, i) => {
    const o = old[i];
    const at = o && o.role === m.role && o.text === m.text && o.at ? o.at : now;
    return { role: m.role, text: m.text, at };
  });
}

const countPrompts = (messages) => (Array.isArray(messages) ? messages.filter((m) => m && m.role === 'user').length : 0);

async function getProject(id) {
  const raw = await redis(['GET', key(id)]);
  return raw ? JSON.parse(raw) : null;
}

// Trim and validate what the browser sends so nothing odd gets stored
function cleanBody(body) {
  if (!body || typeof body !== 'object') return null;
  const title = String(body.title || 'Untitled plugin').slice(0, 120);
  if (!Array.isArray(body.messages) || body.messages.length === 0 || body.messages.length > MAX_MESSAGES) return null;
  const messages = [];
  for (const m of body.messages) {
    if (!m || (m.role !== 'user' && m.role !== 'assistant')) return null;
    messages.push({ role: m.role, text: String(m.text || '').slice(0, 4000) });
  }
  if (Buffer.byteLength(JSON.stringify(messages)) > MAX_BYTES) return null;
  return { title, messages };
}

function send(res, status, payload) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex');
  res.status(status).json(payload);
}

// ---- Sign in with Discord (everyone who uses the site) ----
// Env vars: DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, SESSION_SECRET (32+ characters),
// SITE_URL (e.g. https://pluginforge.com). ADMIN_ACCOUNTS (comma separated Discord user IDs)
// decides who may also open /admin/.
const SESSION_COOKIE = 'pf_session';
const STATE_COOKIE = 'pf_oauth_state';
const NEXT_COOKIE = 'pf_next';
const SESSION_SECONDS = 7 * 24 * 60 * 60;

function authConfigured() {
  return Boolean(
    process.env.DISCORD_CLIENT_ID &&
    process.env.DISCORD_CLIENT_SECRET &&
    process.env.SITE_URL &&
    process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 32
  );
}

function hmac(body) {
  return crypto.createHmac('sha256', process.env.SESSION_SECRET).update(body).digest();
}

// A session is the user's details plus an expiry, signed so it cannot be edited
function signSession(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return body + '.' + hmac(body).toString('base64url');
}

function verifySession(token) {
  if (!process.env.SESSION_SECRET || typeof token !== 'string') return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const given = Buffer.from(sig, 'base64url');
  const expected = hmac(body);
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString());
    // p.p is the sign-in provider, so sessions from the earlier Microsoft login stop working
    return p && p.p === 'discord' && p.exp > Date.now() / 1000 && ACCOUNT_RE.test(String(p.id || '')) ? p : null;
  } catch (e) {
    return null;
  }
}

function parseCookies(req) {
  const out = {};
  String(req.headers.cookie || '').split(';').forEach((part) => {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  });
  return out;
}

function cookie(name, value, maxAge) {
  return name + '=' + value + '; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=' + maxAge;
}

// Only same-site paths like /code/ or /admin/ (never another website)
function safeNext(value) {
  let v = '';
  try { v = decodeURIComponent(String(value || '')); } catch (e) { return ''; }
  return /^\/[A-Za-z0-9\-._~\/]{0,200}$/.test(v) && !v.startsWith('//') ? v : '';
}

// The signed-in Discord account, or null
function sessionUser(req) {
  return verifySession(parseCookies(req)[SESSION_COOKIE]);
}

function isAllowed(user) {
  const list = String(process.env.ADMIN_ACCOUNTS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (!list.length || !user) return false;
  // Match on the Discord user ID only. Usernames can be changed by their owner, IDs cannot.
  return list.includes(String(user.id || '').toLowerCase());
}

// Discord profile picture URL, or null when the account has none
function avatarUrl(user) {
  if (!user || !user.avatar || !/^[a-z0-9_]{1,64}$/.test(user.avatar)) return null;
  const ext = user.avatar.startsWith('a_') ? 'gif' : 'png';
  return 'https://cdn.discordapp.com/avatars/' + user.id + '/' + user.avatar + '.' + ext + '?size=64';
}

// Changes need a header another website cannot add
function missingHeader(req) {
  return req.method !== 'GET' && req.headers['x-pf-request'] !== '1';
}

module.exports = {
  ID_RE, INDEX_KEY, SESSION_COOKIE, STATE_COOKIE, NEXT_COOKIE, SESSION_SECONDS, MAX_PROJECTS_PER_USER,
  configured, redis, newId, key, userIndexKey, getProject, cleanBody, send,
  TIERS, getTier, getUsage, addUsage, countPrompts, stampMessages,
  ACCOUNT_RE, setTier, setPromptsLeft, refillNow, setRefillAt,
  authConfigured, signSession, verifySession, parseCookies, cookie, safeNext, sessionUser, isAllowed, avatarUrl, missingHeader,
};
