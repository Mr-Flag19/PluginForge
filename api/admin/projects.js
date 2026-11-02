// Admin only (a signed-in Discord account whose ID is listed in ADMIN_ACCOUNTS). Every use is written to the log.
//   GET    /api/admin/projects?id=<id>  one full project, plus its owner's plan and prompt allowance
//   GET    /api/admin/projects          the 50 most recently updated projects (titles and owners)
//   DELETE /api/admin/projects?id=<id>  remove a project
const { endpoint, send, log, ID_RE, INDEX_KEY, redis, key, getProject, getUsage, deleteProject } = require('../_lib');

module.exports = endpoint({ methods: ['GET', 'DELETE'], auth: 'admin' }, async ({ req, res, user, query }) => {
  const id = query.id ? String(query.id).trim().toLowerCase() : '';

  if (req.method === 'GET' && id) {
    if (!ID_RE.test(id)) return send(res, 400, { error: 'A project ID is 16 letters and numbers' });
    const project = await getProject(id);
    log('info', 'admin.project.view', { admin: user.id, projectId: id, found: Boolean(project), owner: project ? project.ownerId : null });
    if (!project) return send(res, 404, { error: 'No project with that ID' });
    // The plan and allowance belong to the account that owns the project, not to the admin looking at it
    let account = null;
    try { account = await getUsage(project.ownerId); } catch (e) { log('error', 'admin.usage_unavailable', { admin: user.id, error: e }); }
    return send(res, 200, { ...project, account });
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
    log('info', 'admin.project.list', { admin: user.id, returned: projects.length });
    return send(res, 200, { total, projects });
  }

  // DELETE
  if (!ID_RE.test(id)) return send(res, 400, { error: 'A project ID is 16 letters and numbers' });
  const project = await getProject(id);
  if (project) await deleteProject(id, project.ownerId);
  else await redis(['ZREM', INDEX_KEY, id]);
  log('info', 'admin.project.delete', { admin: user.id, projectId: id, found: Boolean(project), owner: project ? project.ownerId : null });
  return send(res, 200, { id, deleted: true });
});
