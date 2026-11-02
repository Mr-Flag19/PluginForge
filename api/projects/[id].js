// /api/projects/<id>  (only the account that created the project; anyone else gets the same 404 as a missing project)
//   GET     the project and its conversation
//   POST    send one more prompt: { prompt }. Spends one prompt (429 if none left), returns the new messages.
//   PUT     rename: { title }. Saved messages can never be changed this way (409).
//   DELETE  remove the project
const {
  endpoint, send, limited, log, lastSegment, ID_RE, MAX_MESSAGES, getProject, changeProject, deleteProject,
  promptFromBody, cleanTitle, generate, reserveUsage, getUsage, refundQuietly, quotaExceeded,
} = require('../_lib');

module.exports = endpoint({ methods: ['GET', 'POST', 'PUT', 'DELETE'], auth: 'user', rate: { name: 'project', limit: 120 } }, async ({ req, res, user, body }) => {
  const id = lastSegment(req);
  if (!ID_RE.test(id)) return send(res, 400, { error: 'Invalid project ID' });
  const notFound = () => send(res, 404, { error: 'Project not found' });

  if (req.method === 'GET') {
    const project = await getProject(id);
    if (!project || project.ownerId !== user.id) return notFound();
    return send(res, 200, { id: project.id, title: project.title, messages: project.messages, createdAt: project.createdAt, updatedAt: project.updatedAt });
  }

  if (req.method === 'DELETE') {
    const project = await getProject(id);
    if (!project || project.ownerId !== user.id) return notFound();
    await deleteProject(id, user.id);
    return send(res, 200, { id, deleted: true });
  }

  if (req.method === 'PUT') {
    if (!body || typeof body !== 'object') return send(res, 400, { error: 'Invalid project' });
    const now = Date.now();
    const result = await changeProject(id, user.id, (p) => {
      // A page that still sends the conversation along must send exactly what is already saved
      if (Array.isArray(body.messages)) {
        const same = body.messages.length === p.messages.length && body.messages.every((m, i) => m && m.role === p.messages[i].role && String(m.text) === p.messages[i].text);
        if (!same) return { error: 'conflict' };
      }
      const title = body.title === undefined ? p.title : cleanTitle(body.title, '');
      return { project: { ...p, title, updatedAt: now } };
    });
    if (result.status === 'missing') return notFound();
    if (result.status === 'rejected' && result.error === 'conflict') return send(res, 409, { error: "Saved messages can't be changed. Send a new prompt instead." });
    if (result.status === 'rejected') return send(res, 400, { error: result.error });
    if (result.status === 'conflict') return send(res, 409, { error: 'The project changed at the same time. Try again.' });
    return send(res, 200, { id, title: result.project.title, updatedAt: now, usage: await getUsage(user.id).catch(() => null) });
  }

  // POST: one more prompt
  if (await limited(req, res, { name: 'generate', limit: 20, windowSec: 60, subject: user.id })) return;
  const prompt = promptFromBody(body);
  if (!prompt) return send(res, 400, { error: 'Enter a prompt between 1 and 4000 characters.' });

  const project = await getProject(id);
  if (!project || project.ownerId !== user.id) return notFound();
  if (project.messages.length + 2 > MAX_MESSAGES) return send(res, 400, { error: 'This conversation is full. Start a new project.' });

  const now = Date.now();
  // 1. Spend a prompt (atomic). Nothing has been saved yet, so a refusal changes nothing.
  const spent = await reserveUsage(user.id, 1, new Date(now));
  if (!spent.ok) {
    log('warn', 'quota.rejected', { userId: user.id, route: 'project.prompt', tier: spent.usage.tier, left: spent.usage.left });
    return quotaExceeded(res, spent.usage);
  }

  // 2. Generate. Any failure from here on gives the prompt back and saves nothing.
  let reply;
  try {
    reply = await generate({ prompt, project, user });
  } catch (e) {
    log('error', 'generation.failed', { userId: user.id, route: 'project.prompt', error: e });
    await refundQuietly(user.id, 1, 'project.prompt');
    return send(res, 502, { error: 'Generation failed. You were not charged.' });
  }

  // 3. Add the prompt and the reply to the log
  const messages = [{ role: 'user', text: prompt, at: now }, { role: 'assistant', text: reply.text, at: now }];
  let result;
  try {
    result = await changeProject(id, user.id, (p) => {
      if (p.messages.length + 2 > MAX_MESSAGES) return { error: 'This conversation is full. Start a new project.' };
      return { project: { ...p, messages: [...p.messages, ...messages], updatedAt: now } };
    });
  } catch (e) {
    await refundQuietly(user.id, 1, 'project.prompt');
    throw e;
  }
  if (result.status !== 'ok') {
    await refundQuietly(user.id, 1, 'project.prompt');
    if (result.status === 'missing') return notFound();
    if (result.status === 'conflict') return send(res, 409, { error: 'The project is busy. Try again.' });
    return send(res, 400, { error: result.error });
  }
  return send(res, 200, { id, title: result.project.title, messages, updatedAt: now, usage: spent.usage });
});
