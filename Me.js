// GET /api/auth/me  who is signed in right now, and whether they are an admin
const { authConfigured, sessionUser, isAllowed, avatarUrl, send } = require('../_lib');

module.exports = (req, res) => {
  if (!authConfigured()) return send(res, 503, { error: 'Sign in is not set up on the server' });
  const user = sessionUser(req);
  if (!user) return send(res, 401, { error: 'Not signed in' });
  return send(res, 200, { name: user.name, username: user.username || '', id: user.id, avatar: avatarUrl(user), admin: isAllowed(user) });
};
