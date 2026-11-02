// Local stand-in for Vercel: static files + vercel.json rewrites/headers + the real API handlers.
const http = require('http'), fs = require('fs'), path = require('path');
const SITE = path.resolve(__dirname, '..');
const cfg = JSON.parse(fs.readFileSync(SITE + '/vercel.json', 'utf8'));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
const toRe = (src) => new RegExp('^' + src.replace(/\/$/, '').replace(/:([a-z]+)(\([^)]*\))?/gi, (m, n, g) => g ? g : '[^/]+').replace(/\(\.\*\)/g, '.*') + '/?$');
const apiRoute = (p) => {
  let m;
  if ((m = p.match(/^\/api\/(auth|admin)\/([a-z]+)$/))) return SITE + '/api/' + m[1] + '/' + m[2] + '.js';
  if (p === '/api/projects') return SITE + '/api/projects/index.js';
  if (/^\/api\/projects\/[^/]+$/.test(p)) return SITE + '/api/projects/[id].js';
  return null;
};
function start(port) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://x'); let p = url.pathname;
      const hdrs = {};
      for (const rule of cfg.headers || []) if (toRe(rule.source).test(p)) for (const h of rule.headers) hdrs[h.key] = h.value;
      const api = apiRoute(p);
      if (api) {
        let data = '';
        req.on('data', (c) => (data += c));
        req.on('end', async () => {
          if (data) { try { req.body = JSON.parse(data); } catch (e) {} }
          const r = Object.assign(res, {
            status(c) { res.statusCode = c; return res; },
            json(b) { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(b)); return res; },
          });
          for (const k of Object.keys(hdrs)) res.setHeader(k, hdrs[k]);
          try { await require(api)(req, r); } catch (e) { res.statusCode = 500; res.end('crash ' + e.message); }
        });
        return;
      }
      for (const rw of cfg.rewrites || []) { if (toRe(rw.source).test(p)) { p = '/' + p.split('/')[1] + '/index.html'; break; } }
      if (p.endsWith('/')) p += 'index.html';
      let f = path.join(SITE, p);
      if (!f.startsWith(SITE) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { if (fs.existsSync(f + '/index.html')) f += '/index.html'; else { res.statusCode = 404; return res.end('nf'); } }
      for (const k of Object.keys(hdrs)) res.setHeader(k, hdrs[k]);
      res.setHeader('Content-Type', TYPES[path.extname(f)] || 'application/octet-stream');
      res.end(fs.readFileSync(f));
    });
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}
module.exports = { start };
