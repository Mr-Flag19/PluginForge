// POST /api/auth/logout  ends the session
const { SESSION_COOKIE, cookie, send, missingHeader } = require('../_lib');

module.exports = (req, res) => {
  if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });
  if (missingHeader(req)) return send(res, 403, { error: 'Missing request header' });
  res.setHeader('Set-Cookie', cookie(SESSION_COOKIE, '', 0));
  return send(res, 200, { signedOut: true });
};
