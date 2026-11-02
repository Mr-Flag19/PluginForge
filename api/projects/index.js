// GET  /api/projects   your projects, newest first (titles only)
// POST /api/projects   start a project from a first prompt: { title?, prompt }
//                      The server spends one prompt from your allowance (429 if you have none), writes the reply and
//                      returns the new project with its server-generated ID. Older pages may send
//                      { title, messages: [ one user message ] }, which is read as the same thing.
const {
  endpoint, send, limited, log, redis, key, userIndexKey, newId, MAX_PROJECTS_PER_USER,
  promptFromBody, cleanTitle, generate, createProject, reserveUsage, refundQuietly, quotaExceeded,
} = require('../_lib');

module.exports = endpoint({ methods: ['GET', 'POST'], auth: 'user', rate: { name: 'projects', limit: 120 } }, async ({ req, res, user, body }) => {
  if (req.method === 'GET') {
    const ids = await redis(['ZREVRANGE', userIndexKey(user.id), '0', String(MAX_PROJECTS_PER_USER - 1)]);
    const rows = ids.length ? await redis(['MGET', ...ids.map(key)]) : [];
    const projects = rows.filter(Boolean).map((raw) => JSON.parse(raw))
      .filter((p) => p.ownerId === user.id)
      .map((p) => ({ id: p.id, title: p.title, createdAt: p.createdAt, updatedAt: p.updatedAt }));
    return send(res, 200, { projects });
  }

  // Starting a project is a generation, so it has its own tighter limit
  if (await limited(req, res, { name: 'generate', limit: 20, windowSec: 60, subject: user.id })) return;

  const prompt = promptFromBody(body);
  if (!prompt) return send(res, 400, { error: 'Enter a prompt between 1 and 4000 characters.' });
  const title = cleanTitle(body.title, prompt);
  const now = Date.now();

  // 1. Spend a prompt. This is the only place the allowance is checked, and it is atomic.
  const spent = await reserveUsage(user.id, 1, new Date(now));
  if (!spent.ok) {
    log('warn', 'quota.rejected', { userId: user.id, route: 'project.create', tier: spent.usage.tier, left: spent.usage.left });
    return quotaExceeded(res, spent.usage);
  }

  // 2. Generate. Any failure from here on gives the prompt back and saves nothing.
  let reply;
  try {
    reply = await generate({ prompt, project: null, user });
  } catch (e) {
    log('error', 'generation.failed', { userId: user.id, route: 'project.create', error: e });
    await refundQuietly(user.id, 1, 'project.create');
    return send(res, 502, { error: 'Generation failed. You were not charged.' });
  }

  // 3. Save
  const messages = [{ role: 'user', text: prompt, at: now }, { role: 'assistant', text: reply.text, at: now }];
  try {
    for (let attempt = 0; attempt < 5; attempt++) {
      const id = newId();
      const project = { id, ownerId: user.id, ownerName: user.name, ownerUsername: user.username || '', title, messages, createdAt: now, updatedAt: now };
      const made = await createProject(project);
      if (made === 1) return send(res, 201, { id, title, messages, createdAt: now, updatedAt: now, usage: spent.usage });
      if (made === 0) {
        await refundQuietly(user.id, 1, 'project.create');
        return send(res, 429, { error: 'You have reached the limit of ' + MAX_PROJECTS_PER_USER + ' projects. Delete one to start another.', code: 'project_limit' });
      }
      // made === -1: that ID was taken, try another
    }
  } catch (e) {
    await refundQuietly(user.id, 1, 'project.create');
    throw e;
  }
  await refundQuietly(user.id, 1, 'project.create');
  return send(res, 500, { error: 'Could not create a unique ID' });
});
