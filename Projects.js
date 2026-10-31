// Admin only (a signed-in Discord account whose ID is listed in ADMIN_ACCOUNTS)
//   GET    /api/admin/projects?id=<id>  one full project
//   GET    /api/admin/projects          the 50 most recently updated projects
//   DELETE /api/admin/projects?id=<id>  remove a project
const { ID_RE, INDEX_KEY, configured, redis, key, userIndexKey, getProject, send, authConfigured, sessionUser, isAllowed, missingHeader } = require('../_lib');

module.exports = async (req, res) => {
  if (!authConfigured()) return send(res, 503, { error: 'Sign in is not set up on the server' });
  const user = sessionUser(req);
  if (!user) return send(res, 401, { error: 'Sign in to continue' });
  if (!isAllowed(user)) return send(res, 403, { error: 'This account is not an admin' });
  if (missingHeader(req)) return send(res, 403, { error: 'Missing request header' });
  if (!configured()) return send(res, 503, { error: 'Database is not connected' });

  const id = req.query.id ? String(req.query.id).trim().toLowerCase() : '';

  try {
    if (req.method === 'GET' && id) {
      if (!ID_RE.test(id)) return send(res, 400, { error: 'A project ID is 16 letters and numbers' });
      const project = await getProject(id);
      if (!project) return send(res, 404, { error: 'No project with that ID' });
      return send(res, 200, project);
    }

    if (req.method === 'GET') {
      const ids = await redis(['ZREVRANGE', INDEX_KEY, '0', '49']);
      const total = await redis(['ZCARD', INDEX_KEY]);
      const rows = ids.length ? await redis(['MGET', ...ids.map(key)]) : [];
      const projects = rows
        .filter(Boolean)
        .map((raw) => JSON.parse(raw))
        .map((p) => ({
          id: p.id, title: p.title, ownerId: p.ownerId, ownerName: p.ownerName || '', ownerUsername: p.ownerUsername || '',
          createdAt: p.createdAt, updatedAt: p.updatedAt, messageCount: p.messages.length,
        }));
      return send(res, 200, { total, projects });
    }

    if (req.method === 'DELETE' && ID_RE.test(id)) {
      const project = await getProject(id);
      await redis(['DEL', key(id)]);
      await redis(['ZREM', INDEX_KEY, id]);
      if (project && project.ownerId) await redis(['ZREM', userIndexKey(project.ownerId), id]);
      return send(res, 200, { id, deleted: true });
    }

    return send(res, 405, { error: 'Method not allowed' });
  } catch (e) {
    return send(res, 500, { error: 'Something went wrong' });
  }
};
