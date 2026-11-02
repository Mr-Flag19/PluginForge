// Prompt allowance ("quota") for every account.
//
// Everything that reads or changes an account's allowance runs as ONE Lua script inside Redis (EVAL), so two
// requests can never both spend the same prompt, and an admin change can never interleave with a spend.
//
// State per account lives in one hash, usage:<id>:
//   du / de  Stone: prompts used in the current rolling 24 hour window, and when that window ends (ms)
//   mu / me  Iron and Diamond: prompts used this period, and when it ends (ms)
//   total    prompts ever spent (statistics only)
// "used" can go below zero: that is how an admin hands out extra (bonus) prompts. Once the period ends, everything
// starts again from zero. The plan name is stored at user:<id>:tier (no key means Stone).
//
// A period that has ended is never "cleaned up" by a timer. Whenever the script runs it compares the stored end
// time with the time it was given, so nothing can reappear or reset early because a marker key expired.
const { redis, tierKey, usageKey } = require('./_redis');

const TIERS = {
  stone: { name: 'Stone', limit: 5, period: 'day' },
  iron: { name: 'Iron', limit: 250, period: 'month' },
  diamond: { name: 'Diamond', limit: 1000, period: 'month' },
};
const TIER_BY_INDEX = ['stone', 'iron', 'diamond'];
const WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_LEFT = 100000;

const SCRIPT = `
local op = ARGV[1]
local now = tonumber(ARGV[2])
local n = tonumber(ARGV[3]) or 0
local newTier = ARGV[4]
local limStone, limIron, limDiamond = tonumber(ARGV[5]), tonumber(ARGV[6]), tonumber(ARGV[7])
local monthEnd = tonumber(ARGV[8])
local windowMs = tonumber(ARGV[9])
local maxLeft = tonumber(ARGV[10])

if op == 'settier' then
  redis.call('SET', KEYS[1], newTier)
end

local tier = redis.call('GET', KEYS[1])
local limit, pfx, tidx = limStone, 'd', 1
if tier == 'iron' then limit, pfx, tidx = limIron, 'm', 2
elseif tier == 'diamond' then limit, pfx, tidx = limDiamond, 'm', 3 end

local used = tonumber(redis.call('HGET', KEYS[2], pfx .. 'u')) or 0
local periodEnd = tonumber(redis.call('HGET', KEYS[2], pfx .. 'e')) or 0
local active = periodEnd > now
if not active then used = 0; periodEnd = 0 end

local function newEnd()
  if pfx == 'd' then return now + windowMs end
  return monthEnd
end
local function save()
  redis.call('HSET', KEYS[2], pfx .. 'u', used, pfx .. 'e', periodEnd)
end
local function applyLeft(left)
  if left < 0 then left = 0 end
  if left > maxLeft then left = maxLeft end
  local newUsed = limit - left
  if not active then
    if pfx == 'd' and newUsed == 0 then return end
    periodEnd = newEnd()
  end
  used = newUsed
  save()
end

local ok = 1
if op == 'reserve' then
  if n < 1 or n > (limit - used) then
    ok = 0
  else
    if not active then periodEnd = newEnd(); used = 0 end
    used = used + n
    save()
    redis.call('HINCRBY', KEYS[2], 'total', n)
  end
elseif op == 'refund' then
  -- Only gives back prompts of a period that is still running, so a refund can never leak into a newer period
  if active and n > 0 then
    used = used - n
    save()
    redis.call('HINCRBY', KEYS[2], 'total', -n)
  end
elseif op == 'setleft' then
  applyLeft(n)
elseif op == 'addleft' then
  applyLeft((limit - used) + n)
elseif op == 'refill' then
  redis.call('HDEL', KEYS[2], pfx .. 'u', pfx .. 'e')
  used = 0
  periodEnd = 0
elseif op == 'setend' then
  if n <= now then
    redis.call('HDEL', KEYS[2], pfx .. 'u', pfx .. 'e')
    used = 0
    periodEnd = 0
  else
    if not active then used = 0 end
    periodEnd = n
    save()
  end
end

local shownEnd = periodEnd
if shownEnd <= now then
  if pfx == 'm' then shownEnd = monthEnd else shownEnd = 0 end
end
return {tidx, used, shownEnd, ok}
`;

// First moment of next month (UTC)
function monthEndOf(nowMs) {
  const d = new Date(nowMs);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
}

async function run(op, accountId, n = 0, now = new Date(), tier = '') {
  const nowMs = now.getTime();
  const r = await redis([
    'EVAL', SCRIPT, '2', tierKey(accountId), usageKey(accountId),
    op, String(nowMs), String(Math.trunc(n)), tier,
    String(TIERS.stone.limit), String(TIERS.iron.limit), String(TIERS.diamond.limit),
    String(monthEndOf(nowMs)), String(WINDOW_MS), String(MAX_LEFT),
  ]);
  const tierName = TIER_BY_INDEX[Number(r[0]) - 1] || 'stone';
  const plan = TIERS[tierName];
  const raw = Number(r[1]) || 0;
  const left = Math.max(0, plan.limit - raw);
  const end = Number(r[2]) || 0;
  return {
    ok: Number(r[3]) === 1,
    usage: {
      tier: tierName, tierName: plan.name, period: plan.period, limit: plan.limit,
      used: Math.max(0, raw), left, bonus: Math.max(0, left - plan.limit), resetsAt: end > 0 ? end : null,
    },
  };
}

const getUsage = async (accountId, now) => (await run('get', accountId, 0, now)).usage;

// Spend prompts. Returns { ok: false } without changing anything when the account does not have enough left.
const reserveUsage = (accountId, count, now) => run('reserve', accountId, count, now);
const refundUsage = (accountId, count, now) => run('refund', accountId, count, now);

// ---- Admin controls ----
async function setTier(accountId, tier) {
  if (!Object.prototype.hasOwnProperty.call(TIERS, tier)) throw new Error('Unknown tier');
  return (await run('settier', accountId, 0, new Date(), tier)).usage;
}
const setPromptsLeft = async (accountId, left, now) => (await run('setleft', accountId, left, now)).usage;
const addPromptsLeft = async (accountId, delta, now) => (await run('addleft', accountId, delta, now)).usage;
const refillNow = async (accountId, now) => (await run('refill', accountId, 0, now)).usage;
const setRefillAt = async (accountId, at, now) => (await run('setend', accountId, at, now)).usage;

module.exports = {
  TIERS, WINDOW_MS, MAX_LEFT, getUsage, reserveUsage, refundUsage,
  setTier, setPromptsLeft, addPromptsLeft, refillNow, setRefillAt,
};
