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
  authConfigured, signSession, verifySession, parseCookies, cookie, safeNext, sessionUser, isAllowed, avatarUrl, missingHeader,
};
