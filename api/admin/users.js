// Admin only (a signed-in Discord account whose ID is listed in ADMIN_ACCOUNTS)
//   GET  /api/admin/users?id=<discord id>   the account's plan, prompts left, refill time and every project it owns
//   POST /api/admin/users                   change that account. Body: { id, action, ... }
//        { action: 'tier', tier: 'stone' | 'iron' | 'diamond' }
//        { action: 'prompts', set: 12 }            set prompts left to exactly 12
//        { action: 'prompts', add: 5 }             give 5 more (use a negative number to take some away)
//        { action: 'refill', now: true }           refill straight away
//        { action: 'refill', at: 1767225600000 }   refill at that time (ms since 1970, in the future)
const {
  ACCOUNT_RE, configured, redis, key, userIndexKey, getProject, send, authConfigured, sessionUser, isAllowed, missingHeader,
  getUsage, setTier, setPromptsLeft, refillNow, setRefillAt,
} = require('../_lib');

const MAX_LEFT = 100000;
const MAX_AHEAD_MS = 366 * 24 * 60 * 60 * 1000;

async function describe(id) {
  const usage = await getUsage(id);
  // Every project this account owns, newest first (an account can have at most 200)
  const ids = (await redis(['ZREVRANGE', userIndexKey(id), '0', '-1'])) || [];
  const rows = ids.length ? await redis(['MGET', ...ids.map(key)]) : [];
  const owned = rows.filter(Boolean).map((raw) => JSON.parse(raw)).filter((p) => p.ownerId === id);
  const projects = owned.map((p) => ({ id: p.id, title: p.title, updatedAt: p.updatedAt }));
  // The name and username come from the account's most recent project
  const name = owned.length ? owned[0].ownerName || '' : '';
  const username = owned.length ? owned[0].ownerUsername || '' : '';
  return { id, name, username, projectCount: projects.length, projects, usage };
}

module.exports = async (req, res) => {
  if (!authConfigured()) return send(res, 503, { error: 'Sign in is not set up on the server' });
  const user = sessionUser(req);
  if (!user) return send(res, 401, { error: 'Sign in to continue' });
  if (!isAllowed(user)) return send(res, 403, { error: 'This account is not an admin' });
  if (missingHeader(req)) return send(res, 403, { error: 'Missing request header' });
  if (!configured()) return send(res, 503, { error: 'Database is not connected' });

  try {
    if (req.method === 'GET') {
      const id = String(req.query.id || '').trim();
      if (!ACCOUNT_RE.test(id)) return send(res, 400, { error: 'Enter a Discord ID' });
      return send(res, 200, await describe(id));
    }

    if (req.method === 'POST') {
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const id = String(body.id || '').trim();
      if (!ACCOUNT_RE.test(id)) return send(res, 400, { error: 'Enter a Discord ID' });

      if (body.action === 'tier') {
        if (!['stone', 'iron', 'diamond'].includes(body.tier)) return send(res, 400, { error: 'Choose Stone, Iron or Diamond' });
        await setTier(id, body.tier);
      } else if (body.action === 'prompts') {
        const current = (await getUsage(id)).left;
        const hasSet = body.set !== undefined && body.set !== null;
        const amount = Number(hasSet ? body.set : body.add);
        if (!Number.isInteger(amount) || (hasSet ? amount < 0 : Math.abs(amount) > MAX_LEFT)) return send(res, 400, { error: 'Enter a whole number' });
        const target = Math.min(MAX_LEFT, Math.max(0, hasSet ? amount : current + amount));
        await setPromptsLeft(id, target);
      } else if (body.action === 'refill') {
        if (body.now === true) {
          await refillNow(id);
        } else {
          const at = Number(body.at);
          const now = Date.now();
          if (!Number.isFinite(at) || at <= now) return send(res, 400, { error: 'Choose a time in the future, or use Refill now' });
          if (at > now + MAX_AHEAD_MS) return send(res, 400, { error: 'Choose a time within the next year' });
          await setRefillAt(id, Math.round(at));
        }
      } else {
        return send(res, 400, { error: 'Unknown action' });
      }
      return send(res, 200, await describe(id));
    }

    return send(res, 405, { error: 'Method not allowed' });
  } catch (e) {
    return send(res, 500, { error: 'Something went wrong' });
  }
};
