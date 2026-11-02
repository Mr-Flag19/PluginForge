// Projects and the server-owned conversation log.
//
// What the browser may do:
//   - start a project with a first prompt, or send one more prompt to a project it owns
//   - rename a project it owns
// What it may NOT do: write, edit or remove messages. The conversation is a log kept by the server. Every prompt in it
// was accepted by the server after it spent a prompt from the account's allowance, and every reply in it was produced
// by the server. That is what makes the usage count trustworthy: the history a browser sends never decides what gets
// charged.
const { redis, key, userIndexKey, INDEX_KEY } = require('./_redis');
const { refundUsage } = require('./_quota');
const { log } = require('./_log');
const { send } = require('./_http');

const MAX_MESSAGES = 200;
const MAX_BYTES = 200 * 1024;
const MAX_PROJECTS_PER_USER = 200;
const MAX_TITLE = 120;
const MAX_PROMPT = 4000;

const NOT_CONNECTED = "Plugin generation isn't connected yet, so I can't build this plugin right now. Your message is saved to this project, so it will be here when building goes live.";

function cleanTitle(value, fallbackPrompt) {
  const t = String(value === undefined || value === null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE);
  if (t) return t;
  const p = String(fallbackPrompt || '').replace(/\s+/g, ' ').trim();
  if (p) return p.length > 44 ? p.slice(0, 44).trimEnd() + '...' : p;
  return 'Untitled plugin';
}

// One prompt, 1 to 4000 characters
function cleanPrompt(value) {
  if (typeof value !== 'string') return null;
  const t = value.trim();
  return t.length >= 1 && t.length <= MAX_PROMPT ? t : null;
}

// Accepts { prompt } or, for older pages, { messages: [ one user message ] }. Never a whole history.
function promptFromBody(body) {
  if (!body || typeof body !== 'object') return null;
  if (body.prompt !== undefined) return cleanPrompt(body.prompt);
  if (Array.isArray(body.messages) && body.messages.length === 1 && body.messages[0] && body.messages[0].role === 'user') {
    return cleanPrompt(body.messages[0].text);
  }
  return null;
}

// The AI provider goes here. It runs only after the prompt has been paid for. If it throws, the caller refunds the
// prompt and nothing is saved, so a failed generation costs the user nothing.
async function generate(/* { prompt, project, user } */) {
  return { text: NOT_CONNECTED };
}

async function getProject(id) {
  const raw = await redis(['GET', key(id)]);
  return raw ? JSON.parse(raw) : null;
}

// Creating a project and enforcing the per-account limit happen in one step, so parallel requests cannot go past it.
const CREATE_SCRIPT = `
if redis.call('ZCARD', KEYS[2]) >= tonumber(ARGV[4]) then return 0 end
if not redis.call('SET', KEYS[1], ARGV[1], 'NX') then return -1 end
redis.call('ZADD', KEYS[3], ARGV[2], ARGV[3])
redis.call('ZADD', KEYS[2], ARGV[2], ARGV[3])
return 1
`;

// 1 created, 0 the account already has the maximum, -1 that ID is taken
async function createProject(project) {
  return Number(await redis(['EVAL', CREATE_SCRIPT, '3', key(project.id), userIndexKey(project.ownerId), INDEX_KEY,
    JSON.stringify(project), String(project.createdAt), project.id, String(MAX_PROJECTS_PER_USER)]));
}

// Replace a project only if nobody else changed it since it was read (compare-and-set), otherwise read it again.
// Two prompts sent at the same moment to one project therefore both end up in the log.
const CAS_SCRIPT = `
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
redis.call('SET', KEYS[1], ARGV[2])
redis.call('ZADD', KEYS[2], ARGV[3], ARGV[4])
redis.call('ZADD', KEYS[3], ARGV[3], ARGV[4])
return 1
`;

// change(project) returns { project } to save it or { error } to stop. Result: { status: 'ok' | 'missing' | 'rejected' | 'conflict', ... }
async function changeProject(id, ownerId, change) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const raw = await redis(['GET', key(id)]);
    if (!raw) return { status: 'missing' };
    const current = JSON.parse(raw);
    // "Missing" and "not yours" look the same, so IDs cannot be probed
    if (current.ownerId !== ownerId) return { status: 'missing' };
    const r = change(current);
    if (r.error) return { status: 'rejected', error: r.error };
    const next = r.project;
    if (Buffer.byteLength(JSON.stringify(next)) > MAX_BYTES) return { status: 'rejected', error: 'This conversation is full. Start a new project.' };
    const saved = Number(await redis(['EVAL', CAS_SCRIPT, '3', key(id), userIndexKey(ownerId), INDEX_KEY,
      raw, JSON.stringify(next), String(next.updatedAt), id]));
    if (saved === 1) return { status: 'ok', project: next };
  }
  return { status: 'conflict' };
}

async function deleteProject(id, ownerId) {
  await redis(['DEL', key(id)]);
  await redis(['ZREM', INDEX_KEY, id]);
  await redis(['ZREM', userIndexKey(ownerId), id]);
}

// Give a prompt back after something failed. If even that fails it is logged loudly so it can be fixed by hand.
async function refundQuietly(accountId, count, route) {
  try {
    await refundUsage(accountId, count, new Date());
  } catch (e) {
    log('error', 'quota.refund_failed', { userId: accountId, route, count, error: e });
  }
}

// 429 for "no prompts left", with the account's usage so the page can say when they come back
function quotaExceeded(res, usage) {
  if (usage.resetsAt) res.setHeader('Retry-After', String(Math.max(1, Math.ceil((usage.resetsAt - Date.now()) / 1000))));
  return send(res, 429, { error: 'You have no prompts left.', code: 'quota', usage });
}

module.exports = {
  refundQuietly, quotaExceeded,
  MAX_MESSAGES, MAX_BYTES, MAX_PROJECTS_PER_USER, MAX_TITLE, MAX_PROMPT, NOT_CONNECTED,
  cleanTitle, cleanPrompt, promptFromBody, generate, getProject, createProject, changeProject, deleteProject,
};
