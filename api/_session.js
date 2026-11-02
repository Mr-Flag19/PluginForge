// Sign-in sessions.
//
// The browser holds a signed token (HMAC-SHA256, checked with timingSafeEqual) that only points to a server-side
// session record. Because the record lives in Redis the server can end a session at any time:
//   - logout deletes the record, so a copied token stops working immediately
//   - bumping user:<id>:sv (version) ends every session an account has, on every device
// Sessions last 24 hours. The user's email is kept in the server-side record and is never put in the cookie.
const crypto = require('crypto');
const { redis, ACCOUNT_RE, sessionKey, sessionVersionKey } = require('./_redis');

const SESSION_COOKIE = 'pf_session';
const STATE_COOKIE = 'pf_oauth_state';
const NEXT_COOKIE = 'pf_next';
const SESSION_SECONDS = 24 * 60 * 60;

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

function signSession(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return body + '.' + hmac(body).toString('base64url');
}

// Checks the signature (timing safe). With ignoreExpiry the token only has to be genuine.
function verifyToken(token, ignoreExpiry) {
  if (!process.env.SESSION_SECRET || typeof token !== 'string') return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const given = Buffer.from(sig, 'base64url');
  const expected = hmac(body);
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (!p || p.p !== 'discord' || !ACCOUNT_RE.test(String(p.id || '')) || typeof p.sid !== 'string' || !/^[A-Za-z0-9_-]{20,64}$/.test(p.sid)) return null;
    if (!ignoreExpiry && !(p.exp > Date.now() / 1000)) return null;
    return p;
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

// Called after Discord has confirmed who this is. Returns the cookie value.
async function createSession(user, email) {
  const sid = crypto.randomBytes(24).toString('base64url');
  const version = Number(await redis(['GET', sessionVersionKey(user.id)])) || 0;
  await redis(['SET', sessionKey(sid), JSON.stringify({ id: user.id, email: String(email || '').slice(0, 254), at: Date.now() }), 'EX', String(SESSION_SECONDS)]);
  return signSession({ ...user, p: 'discord', sid, v: version, exp: Math.floor(Date.now() / 1000) + SESSION_SECONDS });
}

// The signed-in account for this request, or null. Throws if the database cannot be reached (callers answer 503,
// so people are not signed out just because Redis had a bad moment).
async function readSession(req) {
  const p = verifyToken(parseCookies(req)[SESSION_COOKIE], false);
  if (!p) return null;
  const [record, version] = await redis(['MGET', sessionKey(p.sid), sessionVersionKey(p.id)]);
  if (!record) return null; // logged out, expired or revoked
  if ((Number(version) || 0) !== (Number(p.v) || 0)) return null; // an admin ended all of this account's sessions
  let email = '';
  try { const r = JSON.parse(record); if (r.id !== p.id) return null; email = r.email || ''; } catch (e) { return null; }
  return { user: { id: p.id, name: p.name, username: p.username || '', avatar: p.avatar || '' }, email, sid: p.sid };
}

// Logout: delete the server-side record. Works even if the token has already expired.
async function destroySession(req) {
  const p = verifyToken(parseCookies(req)[SESSION_COOKIE], true);
  if (!p) return false;
  await redis(['DEL', sessionKey(p.sid)]);
  return true;
}

// End every session this account has, on every device
async function revokeUserSessions(accountId) {
  return Number(await redis(['INCR', sessionVersionKey(accountId)]));
}

function isAllowed(user) {
  const list = String(process.env.ADMIN_ACCOUNTS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (!list.length || !user) return false;
  // Match on the Discord user ID only. Usernames can be changed by their owner, IDs cannot.
  return list.includes(String(user.id || '').toLowerCase());
}

// Discord profile picture URL, or null when the account has none
function avatarUrl(user) {
  if (!user || !user.avatar || !/^[a-z0-9_]{1,64}$/.test(user.avatar) || !ACCOUNT_RE.test(String(user.id))) return null;
  const ext = user.avatar.startsWith('a_') ? 'gif' : 'png';
  return 'https://cdn.discordapp.com/avatars/' + user.id + '/' + user.avatar + '.' + ext + '?size=64';
}

module.exports = {
  SESSION_COOKIE, STATE_COOKIE, NEXT_COOKIE, SESSION_SECONDS,
  authConfigured, signSession, verifyToken, parseCookies, cookie, safeNext,
  createSession, readSession, destroySession, revokeUserSessions, isAllowed, avatarUrl,
};
