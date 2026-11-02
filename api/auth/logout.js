// POST /api/auth/logout  ends the session on the server (the token stops working everywhere) and clears the cookie
const { endpoint, send, log, destroySession, cookie, SESSION_COOKIE } = require('../_lib');

module.exports = endpoint({ methods: ['POST'], auth: 'none', needsDb: true, ipRate: { name: 'logout', limit: 30 } }, async ({ req, res }) => {
  res.setHeader('Set-Cookie', cookie(SESSION_COOKIE, '', 0));
  try {
    await destroySession(req);
  } catch (e) {
    // The browser is signed out either way, but say so if the server-side record could not be removed
    log('error', 'logout.revoke_failed', { error: e });
    return send(res, 503, { error: 'Signed out here, but the server could not end the session. Try again.', signedOut: true });
  }
  return send(res, 200, { signedOut: true });
});
