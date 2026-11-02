// One wrapper for every endpoint, so method handling, CSRF checks, sign-in, admin checks and rate limits behave the
// same everywhere and cannot be forgotten on a single route.
//
//   module.exports = endpoint({ methods: ['GET', 'POST'], auth: 'user', rate: { name: 'projects', limit: 60 } }, async (ctx) => { ... });
//
// auth: 'none' | 'user' | 'admin'. ctx gives you req, res, user, email, query, ip and body.
const { log } = require('./_log');
const { configured } = require('./_redis');
const { authConfigured, readSession, isAllowed } = require('./_session');
const { limited, clientIp } = require('./_ratelimit');

function send(res, status, payload) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex');
  res.status(status).json(payload);
}

// Query string as a plain object (read from the URL directly, which also avoids Node's url.parse() deprecation warning)
function queryOf(req) {
  if (req.url) {
    try {
      const out = {};
      for (const [k, v] of new URL(req.url, 'http://localhost').searchParams) if (!(k in out)) out[k] = v;
      return out;
    } catch (e) {}
  }
  return req.query || {};
}

// Last path segment, used for /api/projects/<id>
function lastSegment(req) {
  try { return decodeURIComponent(new URL(req.url, 'http://localhost').pathname.split('/').filter(Boolean).pop() || ''); } catch (e) { return ''; }
}

// Requests that change something must come from our own pages: custom header, plus same-origin browser signals
function crossSiteReason(req) {
  const h = req.headers || {};
  if (h['x-pf-request'] !== '1') return 'Missing request header';
  const site = h['sec-fetch-site'];
  if (site && site !== 'same-origin' && site !== 'none') return 'Cross-site request blocked';
  if (h.origin) {
    let host = '';
    try { host = new URL(h.origin).host; } catch (e) {}
    if (!host || host !== h.host) return 'Cross-site request blocked';
  }
  return '';
}

function endpoint(spec, handler) {
  const methods = spec.methods;
  const allow = ['OPTIONS', ...methods].join(', ');
  const auth = spec.auth || 'none';
  return async function (req, res) {
    try {
      res.setHeader('Allow', allow);
      // OPTIONS: always the same answer, with no CORS headers. Only our own pages may call the API.
      if (req.method === 'OPTIONS') {
        res.setHeader('Cache-Control', 'no-store');
        res.statusCode = 204;
        return res.end();
      }
      if (!methods.includes(req.method)) return send(res, 405, { error: 'Method not allowed' });

      const changes = req.method !== 'GET' && req.method !== 'HEAD';
      if (changes && spec.csrf !== false) {
        const why = crossSiteReason(req);
        if (why) { log('warn', 'request.blocked', { path: String(req.url || '').split('?')[0], reason: why, ip: clientIp(req) }); return send(res, 403, { error: why }); }
      }

      const ip = clientIp(req);
      if (await limited(req, res, { name: 'ip', limit: spec.ipLimit || 240, windowSec: 60, subject: ip })) return;
      if (spec.ipRate && await limited(req, res, { name: spec.ipRate.name, limit: spec.ipRate.limit, windowSec: spec.ipRate.windowSec || 60, subject: ip })) return;

      const ctx = { req, res, ip, query: queryOf(req), body: req.body, user: null, email: '' };

      if (auth !== 'none') {
        if (!authConfigured()) return send(res, 503, { error: 'Sign in is not set up on the server' });
        if (!configured()) return send(res, 503, { error: 'Database is not connected' });
        const session = await readSession(req);
        if (!session) return send(res, 401, { error: 'Sign in to continue' });
        ctx.user = session.user;
        ctx.email = session.email;
        ctx.sid = session.sid;
        if (auth === 'admin' && !isAllowed(session.user)) {
          log('warn', 'admin.denied', { userId: session.user.id, path: String(req.url || '').split('?')[0] });
          return send(res, 403, { error: 'This account is not an admin' });
        }
        const rate = auth === 'admin' ? { name: 'admin', limit: 60 } : spec.rate;
        if (rate && await limited(req, res, { name: rate.name, limit: rate.limit, windowSec: rate.windowSec || 60, subject: session.user.id })) return;
      } else if (spec.needsDb && !configured()) {
        return send(res, 503, { error: 'Database is not connected' });
      }

      return await handler(ctx);
    } catch (e) {
      log('error', 'api.error', { path: String(req.url || '').split('?')[0], method: req.method, error: e });
      if (res.headersSent) return;
      // Database trouble is reported as 503 (try again), anything else as 500
      const dbProblem = e && /^Database/.test(String(e.message));
      return send(res, dbProblem ? 503 : 500, { error: 'Something went wrong. Please try again.' });
    }
  };
}

module.exports = { endpoint, send, queryOf, lastSegment };
