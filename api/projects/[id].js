// GET / PUT / DELETE /api/projects/<id>  (only the account that created the project)
const { ID_RE, INDEX_KEY, configured, redis, key, userIndexKey, getProject, cleanBody, send, sessionUser, missingHeader, addUsage, getUsage, countPrompts, stampMessages } = require('../_lib');

module.exports = async (req, res) => {
  const id = String(req.query.id || '');
  if (!ID_RE.test(id)) return send(res, 400, { error: 'Invalid project ID' });
  if (!configured()) return send(res, 503, { error: 'Database is not connected' });
  const user = sessionUser(req);
  if (!user) return send(res, 401, { error: 'Sign in to continue' });
  if (missingHeader(req)) return send(res, 403, { error: 'Missing request header' });

  try {
    const project = await getProject(id);
    // Same answer for "missing" and "not yours", so IDs can't be probed
    if (!project || project.ownerId !== user.id) return send(res, 404, { error: 'Project not found' });

    if (req.method === 'GET') {
      return send(res, 200, { id: project.id, title: project.title, messages: project.messages, createdAt: project.createdAt, updatedAt: project.updatedAt });
    }

    if (req.method === 'PUT') {
      const body = cleanBody(req.body);
      if (!body) return send(res, 400, { error: 'Invalid project' });
      const now = Date.now();
      // Only prompts that are new since the last save count, so saving the same chat again costs nothing
      const newPrompts = countPrompts(body.messages) - countPrompts(project.messages);
      const next = { ...project, title: body.title, messages: stampMessages(body.messages, project.messages, now), updatedAt: now };
      await redis(['SET', key(id), JSON.stringify(next)]);
      await redis(['ZADD', INDEX_KEY, String(now), id]);
      await redis(['ZADD', userIndexKey(user.id), String(now), id]);
      let usage = null;
      try {
        if (newPrompts > 0) await addUsage(user.id, newPrompts);
        usage = await getUsage(user.id);
      } catch (e) {}
      return send(res, 200, { id, updatedAt: now, usage });
    }

    if (req.method === 'DELETE') {
      await redis(['DEL', key(id)]);
      await redis(['ZREM', INDEX_KEY, id]);
      await redis(['ZREM', userIndexKey(user.id), id]);
      return send(res, 200, { id, deleted: true });
    }

    return send(res, 405, { error: 'Method not allowed' });
  } catch (e) {
    return send(res, 500, { error: 'Something went wrong' });
  }
};
