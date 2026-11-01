// GET  /api/projects  your projects, newest first (titles only)
// POST /api/projects  creates a project and returns its server-generated ID
const { INDEX_KEY, MAX_PROJECTS_PER_USER, configured, redis, newId, key, userIndexKey, cleanBody, send, sessionUser, missingHeader, addUsage, getUsage, countPrompts } = require('../_lib');

module.exports = async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });
  if (!configured()) return send(res, 503, { error: 'Database is not connected' });
  const user = sessionUser(req);
  if (!user) return send(res, 401, { error: 'Sign in to continue' });
  if (missingHeader(req)) return send(res, 403, { error: 'Missing request header' });

  try {
    if (req.method === 'GET') {
      const ids = await redis(['ZREVRANGE', userIndexKey(user.id), '0', String(MAX_PROJECTS_PER_USER - 1)]);
      const rows = ids.length ? await redis(['MGET', ...ids.map(key)]) : [];
      const projects = rows.filter(Boolean).map((raw) => JSON.parse(raw))
        .filter((p) => p.ownerId === user.id)
        .map((p) => ({ id: p.id, title: p.title, createdAt: p.createdAt, updatedAt: p.updatedAt }));
      return send(res, 200, { projects });
    }

    const body = cleanBody(req.body);
    if (!body) return send(res, 400, { error: 'Invalid project' });
    if ((await redis(['ZCARD', userIndexKey(user.id)])) >= MAX_PROJECTS_PER_USER) {
      return send(res, 429, { error: 'You have reached the limit of ' + MAX_PROJECTS_PER_USER + ' projects. Delete one to start another.' });
    }

    const now = Date.now();
    for (let attempt = 0; attempt < 5; attempt++) {
      const id = newId();
      const project = {
        id, ownerId: user.id, ownerName: user.name, ownerUsername: user.username || '',
        title: body.title, messages: body.messages, createdAt: now, updatedAt: now,
      };
      // NX: only store if this ID is not already taken
      const stored = await redis(['SET', key(id), JSON.stringify(project), 'NX']);
      if (stored === 'OK') {
        await redis(['ZADD', INDEX_KEY, String(now), id]);
        await redis(['ZADD', userIndexKey(user.id), String(now), id]);
        // Each prompt counts as one generation. A counting problem must never lose the project.
        let usage = null;
        try {
          await addUsage(user.id, countPrompts(body.messages));
          usage = await getUsage(user.id);
        } catch (e) {}
        return send(res, 201, { id, createdAt: now, updatedAt: now, usage });
      }
    }
    return send(res, 500, { error: 'Could not create a unique ID' });
  } catch (e) {
    return send(res, 500, { error: 'Could not save project' });
  }
};
