// GET /api/auth/login?next=/code/  sends the visitor to Discord to sign in
const crypto = require('crypto');
const { STATE_COOKIE, NEXT_COOKIE, authConfigured, cookie, safeNext } = require('../_lib');

module.exports = (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const next = safeNext(req.query && req.query.next);
  if (!authConfigured()) {
    res.statusCode = 302;
    res.setHeader('Location', (next || '/') + '?error=setup');
    return res.end();
  }
  // A random value we check again on the way back, so a forged callback is rejected
  const state = crypto.randomBytes(24).toString('base64url');
  const params = new URLSearchParams({
    client_id: process.env.DISCORD_CLIENT_ID,
    response_type: 'code',
    redirect_uri: process.env.SITE_URL.replace(/\/+$/, '') + '/api/auth/callback',
    scope: 'identify',
    state,
  });
  res.setHeader('Set-Cookie', [cookie(STATE_COOKIE, state, 600), cookie(NEXT_COOKIE, encodeURIComponent(next), 600)]);
  res.statusCode = 302;
  res.setHeader('Location', 'https://discord.com/oauth2/authorize?' + params.toString());
  res.end();
};
