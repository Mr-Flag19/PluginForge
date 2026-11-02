// A tiny stand-in for Upstash's REST API in front of a real local Redis server, so tests run the real Lua scripts
// with real atomicity and real concurrency.
const http = require('http');
const Redis = require('ioredis');
function start(port, redisPort) {
  const client = new Redis(redisPort || 6391);
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', async () => {
      try {
        if (req.headers.authorization !== 'Bearer test-token') { res.statusCode = 401; return res.end(JSON.stringify({ error: 'bad token' })); }
        const cmd = JSON.parse(body);
        const result = await client.call(...cmd.map(String));
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ result }));
      } catch (e) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: String(e.message) }));
      }
    });
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve({ server, client })));
}
module.exports = { start };
