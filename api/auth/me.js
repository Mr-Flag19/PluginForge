// GET /api/auth/me  who is signed in right now, whether they are an admin, and their plan and usage
const { authConfigured, configured, sessionUser, isAllowed, avatarUrl, getUsage, send } = require('../_lib');

module.exports = async (req, res) => {
  if (!authConfigured()) return send(res, 503, { error: 'Sign in is not set up on the server' });
  const user = sessionUser(req);
  if (!user) return send(res, 401, { error: 'Not signed in' });
  // Signing in must keep working even if the database is down, so usage is optional
  let usage = null;
  if (configured()) {
    try { usage = await getUsage(user.id); } catch (e) {}
  }
  return send(res, 200, { name: user.name, username: user.username || '', id: user.id, avatar: avatarUrl(user), admin: isAllowed(user), usage });
};
