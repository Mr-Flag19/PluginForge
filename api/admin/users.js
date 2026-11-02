// Admin only (a signed-in Discord account whose ID is listed in ADMIN_ACCOUNTS). Every use is written to the log.
//   GET  /api/admin/users?id=<discord id>   the account's plan, prompts left, refill time and every project it owns
//   POST /api/admin/users                   change that account. Body: { id, action, ... }
//        { action: 'tier', tier: 'stone' | 'iron' | 'diamond' }
//        { action: 'prompts', set: 12 }            set prompts left to exactly 12
//        { action: 'prompts', add: 5 }             give 5 more (use a negative number to take some away)
//        { action: 'refill', now: true }           refill straight away
//        { action: 'refill', at: 1767225600000 }   refill at that time (ms since 1970, in the future)
//        { action: 'revoke' }                      sign this account out on every device
// Looking up any Discord ID is deliberate: it is how an admin finds an account to help. Only admins can do it,
// they are rate limited, and each lookup and change is logged with who did it.
const {
  endpoint, send, log, ACCOUNT_RE, redis, key, userIndexKey, getUsage, setTier, setPromptsLeft, addPromptsLeft,
  refillNow, setRefillAt, revokeUserSessions, MAX_LEFT,
} = require('../_lib');

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

module.exports = endpoint({ methods: ['GET', 'POST'], auth: 'admin' }, async ({ req, res, user, query, body }) => {
  if (req.method === 'GET') {
    const id = String(query.id || '').trim();
    if (!ACCOUNT_RE.test(id)) return send(res, 400, { error: 'Enter a Discord ID' });
    log('info', 'admin.user.lookup', { admin: user.id, target: id });
    return send(res, 200, await describe(id));
  }

  const b = body && typeof body === 'object' ? body : {};
  const id = String(b.id || '').trim();
  if (!ACCOUNT_RE.test(id)) return send(res, 400, { error: 'Enter a Discord ID' });
  const audit = (action, extra) => log('info', 'admin.user.update', { admin: user.id, target: id, action, ...extra });

  if (b.action === 'tier') {
    if (!['stone', 'iron', 'diamond'].includes(b.tier)) return send(res, 400, { error: 'Choose Stone, Iron or Diamond' });
    await setTier(id, b.tier);
    audit('tier', { tier: b.tier });
  } else if (b.action === 'prompts') {
    const hasSet = b.set !== undefined && b.set !== null;
    const amount = Number(hasSet ? b.set : b.add);
    if (!Number.isInteger(amount) || (hasSet ? amount < 0 || amount > MAX_LEFT : Math.abs(amount) > MAX_LEFT)) return send(res, 400, { error: 'Enter a whole number' });
    if (hasSet) await setPromptsLeft(id, amount);
    else await addPromptsLeft(id, amount);
    audit('prompts', hasSet ? { set: amount } : { add: amount });
  } else if (b.action === 'refill') {
    if (b.now === true) {
      await refillNow(id);
      audit('refill', { now: true });
    } else {
      const at = Number(b.at);
      const now = Date.now();
      if (!Number.isFinite(at) || at <= now) return send(res, 400, { error: 'Choose a time in the future, or use Refill now' });
      if (at > now + MAX_AHEAD_MS) return send(res, 400, { error: 'Choose a time within the next year' });
      await setRefillAt(id, Math.round(at));
      audit('refill', { at: Math.round(at) });
    }
  } else if (b.action === 'revoke') {
    const version = await revokeUserSessions(id);
    audit('revoke', { sessionVersion: version });
  } else {
    return send(res, 400, { error: 'Unknown action' });
  }
  return send(res, 200, await describe(id));
});
