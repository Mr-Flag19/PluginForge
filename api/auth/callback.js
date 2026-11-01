// GET /api/auth/callback  Discord sends the visitor back here after sign-in
const crypto = require('crypto');
const { SESSION_COOKIE, STATE_COOKIE, NEXT_COOKIE, SESSION_SECONDS, authConfigured, parseCookies, cookie, signSession, safeNext } = require('../_lib');

function go(res, location, cookies) {
  res.setHeader('Cache-Control', 'no-store');
  if (cookies) res.setHeader('Set-Cookie', cookies);
  res.statusCode = 302;
  res.setHeader('Location', location);
  res.end();
}

function sameValue(a, b) {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y);
}

module.exports = async (req, res) => {
  const cookies = parseCookies(req);
  const next = safeNext(cookies[NEXT_COOKIE]) || '/';
  const clear = [cookie(STATE_COOKIE, '', 0), cookie(NEXT_COOKIE, '', 0)];
  if (!authConfigured()) return go(res, next + '?error=setup', clear);

  const { code, state, error } = req.query || {};
  if (error) return go(res, next + '?error=cancelled', clear);
  if (!code || !sameValue(state, cookies[STATE_COOKIE])) return go(res, next + '?error=failed', clear);

  try {
    const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'PluginForge (https://pluginforge.com, 1.0)' },
      body: new URLSearchParams({
        client_id: process.env.DISCORD_CLIENT_ID,
        client_secret: process.env.DISCORD_CLIENT_SECRET,
        grant_type: 'authorization_code',
        code: String(code),
        redirect_uri: process.env.SITE_URL.replace(/\/+$/, '') + '/api/auth/callback',
      }).toString(),
    });
    const token = await tokenRes.json();
    if (!tokenRes.ok || !token.access_token) return go(res, next + '?error=failed', clear);

    // The access token came straight from Discord over HTTPS, so what Discord says about it can be trusted
    const meRes = await fetch('https://discord.com/api/users/@me', {
      headers: { Authorization: 'Bearer ' + token.access_token, 'User-Agent': 'PluginForge (https://pluginforge.com, 1.0)' },
    });
    const me = await meRes.json();
    if (!meRes.ok || !me.id) return go(res, next + '?error=failed', clear);

    const user = {
      id: String(me.id),
      name: String(me.global_name || me.username || 'Player').slice(0, 80),
      username: String(me.username || '').slice(0, 40),
      avatar: /^[a-z0-9_]{1,64}$/.test(String(me.avatar || '')) ? String(me.avatar) : '',
      // Only present because the sign in asks Discord for the email scope. Shown to the person on their own profile.
      email: typeof me.email === 'string' ? me.email.slice(0, 254) : '',
    };
    const session = signSession({ ...user, p: 'discord', exp: Math.floor(Date.now() / 1000) + SESSION_SECONDS });
    return go(res, next, [...clear, cookie(SESSION_COOKIE, session, SESSION_SECONDS)]);
  } catch (e) {
    return go(res, next + '?error=failed', clear);
  }
};
