// Request rate limits, kept in Redis so they hold across every serverless instance.
// Fixed one-minute style windows: the counter is created and given its expiry in one atomic script.
const { redis, rateKey, configured } = require('./_redis');
const { log } = require('./_log');

const SCRIPT = `
local c = redis.call('INCR', KEYS[1])
if c == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
local ttl = redis.call('TTL', KEYS[1])
if ttl < 0 then redis.call('EXPIRE', KEYS[1], ARGV[1]); ttl = tonumber(ARGV[1]) end
return {c, ttl}
`;

// The visitor's address. On Vercel these headers are set by the platform, not by the visitor.
function clientIp(req) {
  const h = req.headers || {};
  const real = String(h['x-real-ip'] || '').trim();
  if (real) return real.slice(0, 64);
  const fwd = String(h['x-forwarded-for'] || '').split(',')[0].trim();
  if (fwd) return fwd.slice(0, 64);
  return String((req.socket && req.socket.remoteAddress) || 'unknown').slice(0, 64);
}

// Returns true (and has already answered 429) when the caller is over the limit.
// If Redis is down the request is let through (and logged): a database problem must not lock everyone out.
async function limited(req, res, { name, limit, windowSec, subject }) {
  if (!configured()) return false;
  const bucket = Math.floor(Date.now() / 1000 / windowSec);
  let count = 0;
  let ttl = windowSec;
  try {
    const r = await redis(['EVAL', SCRIPT, '1', rateKey(name, subject, bucket), String(windowSec + 5)]);
    count = Number(r[0]) || 0;
    ttl = Math.max(1, Math.min(windowSec, Number(r[1]) || windowSec));
  } catch (e) {
    log('warn', 'ratelimit.unavailable', { name, error: e });
    return false;
  }
  res.setHeader('RateLimit-Limit', String(limit));
  res.setHeader('RateLimit-Remaining', String(Math.max(0, limit - count)));
  if (count <= limit) return false;
  log('warn', 'ratelimit.exceeded', { name, subject: String(subject).slice(0, 64), limit, windowSec });
  res.setHeader('Retry-After', String(ttl));
  res.setHeader('Cache-Control', 'no-store');
  res.status(429).json({ error: 'Too many requests. Try again in ' + ttl + ' seconds.', retryAfter: ttl });
  return true;
}

module.exports = { limited, clientIp };
