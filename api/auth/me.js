// GET /api/auth/me  who is signed in right now, whether they are an admin, and their plan and prompts
const { endpoint, send, log, getUsage, isAllowed, avatarUrl } = require('../_lib');

module.exports = endpoint({ methods: ['GET'], auth: 'user', rate: { name: 'me', limit: 120 } }, async ({ res, user, email }) => {
  // The page still works if the allowance cannot be read, so this is optional
  let usage = null;
  try { usage = await getUsage(user.id); } catch (e) { log('error', 'me.usage_unavailable', { userId: user.id, error: e }); }
  return send(res, 200, { name: user.name, username: user.username || '', email: email || '', id: user.id, avatar: avatarUrl(user), admin: isAllowed(user), usage });
});
