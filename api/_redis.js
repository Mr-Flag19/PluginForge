// Redis (Upstash REST) access and every key name used by the app.
const { log } = require('./_log');

const REDIS_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

// Production keeps its original key names. Preview and Development deployments get a prefix, so even if they
// are accidentally pointed at the production database they cannot read or overwrite production data.
const NS = ['preview', 'development'].includes(process.env.VERCEL_ENV) ? process.env.VERCEL_ENV + ':' : '';

const ID_RE = /^[a-z0-9]{16}$/;
const ACCOUNT_RE = /^[A-Za-z0-9-]{1,64}$/;

const INDEX_KEY = NS + 'projects:index';
const key = (id) => NS + 'project:' + id;
const userIndexKey = (accountId) => NS + 'user:' + accountId + ':projects';
const tierKey = (accountId) => NS + 'user:' + accountId + ':tier';
const usageKey = (accountId) => NS + 'usage:' + accountId;
const sessionKey = (sid) => NS + 'session:' + sid;
const sessionVersionKey = (accountId) => NS + 'user:' + accountId + ':sv';
const rateKey = (name, subject, bucket) => NS + 'rl:' + name + ':' + subject + ':' + bucket;

function configured() {
  return Boolean(REDIS_URL && REDIS_TOKEN);
}

async function redis(command) {
  let r;
  try {
    r = await fetch(REDIS_URL, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + REDIS_TOKEN, 'Content-Type': 'application/json' },
      body: JSON.stringify(command),
      signal: AbortSignal.timeout(8000),
    });
  } catch (e) {
    log('error', 'redis.unreachable', { command: String(command[0]), error: e });
    throw new Error('Database unreachable');
  }
  let data = {};
  try { data = await r.json(); } catch (e) {}
  if (!r.ok || data.error) {
    log('error', 'redis.error', { command: String(command[0]), status: r.status, error: String(data.error || '') });
    throw new Error('Database error');
  }
  return data.result;
}

module.exports = {
  NS, ID_RE, ACCOUNT_RE, INDEX_KEY, key, userIndexKey, tierKey, usageKey, sessionKey, sessionVersionKey, rateKey,
  configured, redis,
};
