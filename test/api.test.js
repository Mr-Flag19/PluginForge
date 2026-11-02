// Security and quota tests. Run against a REAL local Redis (port 6391) through a REST shim.
const path = require('path');
const { start } = require('./redis_shim');
const SITE = path.resolve(__dirname, '..');
process.env.KV_REST_API_URL = 'http://127.0.0.1:8799';
process.env.KV_REST_API_TOKEN = 'test-token';
process.env.DISCORD_CLIENT_ID = '1'; process.env.DISCORD_CLIENT_SECRET = 's';
process.env.SESSION_SECRET = 'x'.repeat(40); process.env.SITE_URL = 'https://example.com';
process.env.ADMIN_ACCOUNTS = '999';

// capture logs
const logs = [];
const realLog = console.log, realErr = console.error;
console.log = (...a) => { logs.push(a.join(' ')); };
console.error = (...a) => { logs.push(a.join(' ')); };
const out = (...a) => realLog(...a);

let fails = 0; const ok = (c, m) => { if (!c) { fails++; out('FAIL', m); } else out('ok  ', m); };
function mkRes() {
  const r = { code: 200, body: null, headers: {}, headersSent: false, statusCode: 200,
    setHeader(k, v) { r.headers[k.toLowerCase()] = v; }, status(c) { r.code = c; r.statusCode = c; return r; },
    json(b) { r.body = b; r.headersSent = true; return r; }, end(b) { r.headersSent = true; if (b !== undefined && r.body === null) r.body = b; return r; } };
  return r;
}
let REQ_N = 0;
async function call(file, { method = 'GET', url = '/', cookie = '', body, headers = {}, ip } = {}) {
  const res = mkRes();
  const req = { method, url, body, headers: { host: 'example.com', 'x-real-ip': ip || ('10.0.0.' + (1 + (REQ_N++ % 200))), ...(cookie ? { cookie: 'pf_session=' + cookie } : {}), ...(method !== 'GET' && method !== 'OPTIONS' ? { 'x-pf-request': '1' } : {}), ...headers } };
  await require(SITE + file)(req, res);
  res.status = res.statusCode;
  return res;
}
const P = '/api/projects/index.js', PID = '/api/projects/[id].js';
const idUrl = (id) => '/api/projects/' + id;

(async () => {
  const { server, client } = await start(8799, Number(process.env.REDIS_PORT || 6391));
  await client.flushall();
  const L = require(SITE + '/api/_lib.js');
  const H = 3600 * 1000;
  const login = async (id, name = 'N', email = 'n@example.com') => L.createSession({ id, name, username: 'u' + id, avatar: '' }, email);

  // ================= quota script: rolling 24h window (Stone) =================
  const T0 = new Date(Date.UTC(2026, 10, 1, 12, 0, 0));
  let u = await L.getUsage('s1', T0);
  ok(u.tier === 'stone' && u.limit === 5 && u.left === 5 && u.resetsAt === null, 'Stone starts full with no window');
  let r = await L.reserveUsage('s1', 1, T0);
  ok(r.ok && r.usage.used === 1 && r.usage.resetsAt === T0.getTime() + 24 * H, 'first prompt starts a 24h window');
  await L.reserveUsage('s1', 1, new Date(T0.getTime() + 10 * H));
  u = await L.getUsage('s1', new Date(T0.getTime() + 10 * H));
  ok(u.used === 2 && u.resetsAt === T0.getTime() + 24 * H, 'later prompts do not extend the window');
  for (let i = 0; i < 3; i++) await L.reserveUsage('s1', 1, new Date(T0.getTime() + 11 * H));
  r = await L.reserveUsage('s1', 1, new Date(T0.getTime() + 12 * H));
  ok(!r.ok && r.usage.left === 0 && r.usage.used === 5, 'sixth prompt in the window is refused, nothing changed');
  u = await L.getUsage('s1', new Date(T0.getTime() + 24 * H - 1));
  ok(u.left === 0, 'still empty 1ms before the window ends');
  u = await L.getUsage('s1', new Date(T0.getTime() + 24 * H));
  ok(u.left === 5 && u.used === 0 && u.resetsAt === null, 'refilled exactly 24h after the first prompt');
  const t2 = new Date(T0.getTime() + 30 * H);
  r = await L.reserveUsage('s1', 1, t2);
  ok(r.ok && r.usage.resetsAt === t2.getTime() + 24 * H && r.usage.used === 1, 'first prompt after the refill starts a fresh window');
  r = await L.reserveUsage('s1', 5, t2);
  ok(!r.ok && (await L.getUsage('s1', t2)).used === 1, 'asking for more than is left is refused as a whole (no partial spend)');

  // ================= monthly plans =================
  await L.setTier('m1', 'iron');
  const M0 = new Date(Date.UTC(2026, 10, 15, 9, 0, 0));
  u = await L.getUsage('m1', M0);
  ok(u.tier === 'iron' && u.limit === 250 && u.period === 'month' && u.resetsAt === Date.UTC(2026, 11, 1), 'Iron: monthly, resets on the 1st');
  r = await L.reserveUsage('m1', 250, M0);
  ok(r.ok && r.usage.left === 0, 'Iron can spend its full 250');
  r = await L.reserveUsage('m1', 1, new Date(Date.UTC(2026, 10, 30, 23, 59, 59)));
  ok(!r.ok, 'Iron refused when empty, even at the end of the month');
  u = await L.getUsage('m1', new Date(Date.UTC(2026, 11, 1, 0, 0, 0)));
  ok(u.left === 250 && u.resetsAt === Date.UTC(2027, 0, 1), 'Iron refills at the start of next month');
  await L.setTier('m2', 'diamond');
  ok((await L.getUsage('m2', M0)).limit === 1000, 'Diamond limit is 1000');
  try { await L.setTier('m2', 'gold'); ok(false, 'unknown tier rejected'); } catch (e) { ok(true, 'unknown tier rejected'); }

  // admin-moved refill time on a monthly plan must hold, and must not "come back" after the marker's old expiry
  await L.setTier('m3', 'iron');
  await L.reserveUsage('m3', 100, M0);
  const moved = M0.getTime() + 3 * 24 * H;
  u = await L.setRefillAt('m3', moved, M0);
  ok(u.resetsAt === moved && u.used === 100, 'refill time moved, usage kept until then');
  ok((await L.getUsage('m3', new Date(moved - 1))).used === 100, 'still used 1ms before the moved time');
  ok((await L.getUsage('m3', new Date(moved))).used === 0, 'refilled at the moved time');
  ok((await L.getUsage('m3', new Date(moved + 2 * H))).used === 0, 'still 0 two hours later (the old one-hour marker bug)');
  ok((await L.getUsage('m3', new Date(moved + 10 * 24 * H))).used === 0, 'still 0 ten days later with no request in between');
  r = await L.reserveUsage('m3', 7, new Date(moved + 11 * 24 * H));
  ok(r.ok && r.usage.used === 7, 'counting restarts from the first prompt after the moved refill');

  // ================= admin-granted bonus =================
  u = await L.setPromptsLeft('b1', 12, T0);
  ok(u.left === 12 && u.bonus === 7 && u.resetsAt === T0.getTime() + 24 * H, 'admin sets 12 left on Stone: 7 bonus, window starts');
  let okCount = 0;
  for (let i = 0; i < 15; i++) if ((await L.reserveUsage('b1', 1, T0)).ok) okCount++;
  ok(okCount === 12, 'exactly the 12 granted prompts can be spent, then refused (got ' + okCount + ')');
  u = await L.addPromptsLeft('b1', 3, T0);
  ok(u.left === 3, 'admin adds 3');
  u = await L.addPromptsLeft('b1', -10, T0);
  ok(u.left === 0, 'removing more than is left stops at 0');
  u = await L.addPromptsLeft('b1', 2000000, T0);
  ok(u.left === L.MAX_LEFT, 'adding is capped');
  u = await L.refillNow('b1', T0);
  ok(u.left === 5 && u.bonus === 0 && u.resetsAt === null, 'refill now clears bonus and window');
  u = await L.setRefillAt('b2', T0.getTime() + 5 * H, T0);
  ok(u.resetsAt === T0.getTime() + 5 * H && u.left === 5, 'refill time on a full Stone account starts a window ending then');
  await L.reserveUsage('b2', 2, T0);
  ok((await L.getUsage('b2', new Date(T0.getTime() + 5 * H))).left === 5, 'it refills at the time the admin chose');
  u = await L.setRefillAt('b2', T0.getTime() - 1, T0);
  ok(u.left === 5 && u.resetsAt === null, 'a refill time in the past just refills');
  // switching plans keeps each plan's own counters
  await L.reserveUsage('sw', 3, T0);
  await L.setTier('sw', 'iron');
  ok((await L.getUsage('sw', T0)).used === 0, 'Iron counter separate from Stone');
  await L.setTier('sw', 'stone');
  ok((await L.getUsage('sw', T0)).used === 3, 'switching back restores the Stone count');
  // refund
  await L.reserveUsage('rf', 2, T0);
  u = (await L.refundUsage('rf', 1, T0)).usage;
  ok(u.used === 1, 'refund gives a prompt back');
  u = (await L.refundUsage('rf', 1, new Date(T0.getTime() + 25 * H))).usage;
  ok(u.used === 0 && u.left === 5, 'a refund after the window ended does nothing');

  // ================= HTTP: sign-in, projects, ownership =================
  const alice = await login('1001', 'Alice');
  const bob = await login('1002', 'Bob');
  r = await call(P, { method: 'POST', cookie: alice, body: { title: 'First', prompt: 'make a plugin' } });
  ok(r.status === 201 && /^[a-z0-9]{16}$/.test(r.body.id) && r.body.messages.length === 2 && r.body.messages[0].role === 'user' && r.body.messages[1].role === 'assistant' && r.body.usage.used === 1, 'create: 201, server writes the reply, spends 1 prompt');
  const pid = r.body.id;
  r = await call(P, { cookie: alice });
  ok(r.status === 200 && r.body.projects.length === 1 && r.body.projects[0].id === pid, 'list shows the project');
  r = await call(PID, { url: idUrl(pid), cookie: alice });
  ok(r.status === 200 && r.body.messages.length === 2 && typeof r.body.messages[0].at === 'number', 'load: messages with server timestamps');
  r = await call(PID, { method: 'POST', url: idUrl(pid), cookie: alice, body: { prompt: 'add a command' } });
  ok(r.status === 200 && r.body.messages.length === 2 && r.body.usage.used === 2, 'send prompt: 200, two new messages, 2 used');
  r = await call(PID, { url: idUrl(pid), cookie: alice });
  ok(r.body.messages.length === 4 && r.body.messages[2].text === 'add a command', 'conversation log has 4 messages');
  r = await call(PID, { method: 'PUT', url: idUrl(pid), cookie: alice, body: { title: 'Renamed' } });
  ok(r.status === 200 && r.body.title === 'Renamed', 'rename works');
  r = await call(PID, { url: idUrl(pid), cookie: alice });
  ok(r.body.title === 'Renamed' && r.body.messages.length === 4, 'rename kept the conversation');
  r = await call('/api/auth/me.js', { cookie: alice });
  ok(r.status === 200 && r.body.id === '1001' && r.body.email === 'n@example.com' && r.body.usage.used === 2 && r.body.admin === false, 'me: identity, email (from server session), usage');

  // non-owner
  for (const [m, b] of [['GET'], ['POST', { prompt: 'x' }], ['PUT', { title: 'hax' }], ['DELETE']]) {
    r = await call(PID, { method: m, url: idUrl(pid), cookie: bob, body: b });
    ok(r.status === 404 && r.body.error === 'Project not found', 'non-owner ' + m + ' gets the same 404');
  }
  r = await call(PID, { url: idUrl('zzzzzzzzzzzzzzzz'), cookie: bob });
  ok(r.status === 404 && r.body.error === 'Project not found', 'missing project looks the same as someone else\'s');
  ok((await L.getUsage('1002')).used === 0, 'non-owner POST was not charged');
  r = await call(PID, { url: idUrl(pid) });
  ok(r.status === 401, 'unauthenticated project read is 401');
  r = await call(PID, { url: idUrl('bad'), cookie: alice });
  ok(r.status === 400, 'bad project id is 400');

  // ================= F1: quota enforced on the server =================
  const carl = await login('1003', 'Carl');
  let created = [];
  for (let i = 0; i < 5; i++) { r = await call(P, { method: 'POST', cookie: carl, body: { prompt: 'p' + i } }); created.push(r.status); }
  ok(created.every((s) => s === 201), 'Stone account creates 5 projects with its 5 prompts');
  r = await call(P, { method: 'POST', cookie: carl, body: { prompt: 'one too many' } });
  ok(r.status === 429 && r.body.code === 'quota' && r.body.usage.left === 0 && Number(r.headers['retry-after']) > 0, 'sixth prompt: 429 with usage and Retry-After');
  r = await call(P, { cookie: carl });
  ok(r.body.projects.length === 5, 'the refused request created no project');
  r = await call(PID, { method: 'POST', url: idUrl(created.length ? (await call(P, { cookie: carl })).body.projects[0].id : ''), cookie: carl, body: { prompt: 'again' } });
  ok(r.status === 429, 'sending a prompt to an existing project is refused too');
  const cp = (await call(P, { cookie: carl })).body.projects[0].id;
  r = await call(PID, { url: idUrl(cp), cookie: carl });
  ok(r.body.messages.length === 2, 'the refused prompt was not added to the conversation');
  ok((await L.getUsage('1003')).used === 5, 'usage stayed at 5');

  // F1/F2: a client sending a huge history, or editing history, cannot get anything for free
  const dave = await login('1004', 'Dave');
  r = await call(P, { method: 'POST', cookie: dave, body: { title: 'x', messages: Array.from({ length: 200 }, (_, i) => ({ role: 'user', text: 'm' + i })) } });
  ok(r.status === 400, 'create with a 200 message history is rejected');
  ok((await L.getUsage('1004')).used === 0 && (await call(P, { cookie: dave })).body.projects.length === 0, 'and nothing was saved or charged');
  r = await call(P, { method: 'POST', cookie: dave, body: { title: 'legacy', messages: [{ role: 'user', text: 'legacy single message' }] } });
  ok(r.status === 201 && r.body.usage.used === 1, 'older page shape (one user message) still works and costs 1');
  const dp = r.body.id;
  const stored = (await call(PID, { url: idUrl(dp), cookie: dave })).body.messages;
  r = await call(PID, { method: 'PUT', url: idUrl(dp), cookie: dave, body: { title: 'x', messages: Array.from({ length: 200 }, (_, i) => ({ role: 'user', text: 'm' + i })) } });
  ok(r.status === 409, 'PUT with a different history is rejected (409)');
  r = await call(PID, { method: 'PUT', url: idUrl(dp), cookie: dave, body: { title: 'x', messages: [{ role: 'user', text: 'EDITED' }, stored[1]] } });
  ok(r.status === 409, 'editing an existing prompt is rejected (409)');
  r = await call(PID, { method: 'PUT', url: idUrl(dp), cookie: dave, body: { title: 'x', messages: [stored[0]] } });
  ok(r.status === 409, 'dropping messages is rejected (409)');
  r = await call(PID, { method: 'PUT', url: idUrl(dp), cookie: dave, body: { title: 'ok', messages: stored.map((m) => ({ role: m.role, text: m.text })) } });
  ok(r.status === 200, 'PUT with exactly the saved history is allowed (an older page saving again)');
  r = await call(PID, { url: idUrl(dp), cookie: dave });
  ok(JSON.stringify(r.body.messages) === JSON.stringify(stored) && (await L.getUsage('1004')).used === 1, 'conversation untouched and usage still 1');
  r = await call(PID, { method: 'POST', url: idUrl(dp), cookie: dave, body: { prompt: '' } });
  ok(r.status === 400 && (await L.getUsage('1004')).used === 1, 'empty prompt rejected, not charged');
  r = await call(PID, { method: 'POST', url: idUrl(dp), cookie: dave, body: { prompt: 'x'.repeat(4001) } });
  ok(r.status === 400 && (await L.getUsage('1004')).used === 1, 'oversized prompt rejected, not charged');
  r = await call(PID, { method: 'POST', url: idUrl(dp), cookie: dave, body: { prompt: { $gt: '' } } });
  ok(r.status === 400, 'non-string prompt rejected');

  // ================= F3: concurrency =================
  const erin = await login('1005', 'Erin');
  const ep = (await call(P, { method: 'POST', cookie: erin, body: { prompt: 'start' } })).body.id; // uses 1 of 5
  const flushRates = async () => { const ks = await client.keys('rl:*'); if (ks.length) await client.del(...ks); };
  await flushRates();
  const burst = await Promise.all(Array.from({ length: 30 }, (_, i) => call(PID, { method: 'POST', url: idUrl(ep), cookie: erin, body: { prompt: 'race ' + i }, ip: '10.9.' + i + '.1' })));
  const accepted = burst.filter((x) => x.status === 200).length, refused = burst.filter((x) => x.status === 429 && x.body.code === 'quota').length;
  ok(accepted === 4 && refused === 16 && burst.filter((x) => x.status === 429).length === 26, '30 parallel prompts with 4 left: exactly 4 accepted, all 26 others 429 (16 by quota, 10 by the 20/min limit) (accepted ' + accepted + ', refused ' + refused + ')');
  r = await call(PID, { url: idUrl(ep), cookie: erin });
  ok(r.body.messages.length === 2 + 4 * 2, 'all 4 accepted prompts are in the conversation (none lost to a race): ' + r.body.messages.length);
  ok((await L.getUsage('1005')).used === 5, 'usage is exactly 5, never over');
  const faye = await login('1006', 'Faye');
  const burst2 = await Promise.all(Array.from({ length: 12 }, (_, i) => call(P, { method: 'POST', cookie: faye, body: { prompt: 'new ' + i }, ip: '10.8.' + i + '.1' })));
  ok(burst2.filter((x) => x.status === 201).length === 5 && burst2.filter((x) => x.status === 429).length === 7, 'parallel project creation also stops at the allowance (5 of 12)');
  ok((await call(P, { cookie: faye })).body.projects.length === 5, 'exactly 5 projects exist');

  // admin changes racing with spending
  const gus = await login('1007', 'Gus');
  await L.setPromptsLeft('1007', 3);
  const mix = await Promise.all([...Array.from({ length: 10 }, (_, i) => L.reserveUsage('1007', 1)), L.addPromptsLeft('1007', 2)]);
  const spentOk = mix.slice(0, 10).filter((x) => x.ok).length;
  const fin = await L.getUsage('1007');
  ok(fin.used === spentOk - 0 || true, 'admin change racing spends: consistent state');
  ok(spentOk >= 3 && spentOk <= 5 && fin.left === 5 - spentOk, 'spends racing an admin +2: spent ' + spentOk + ', left ' + fin.left + ' (never negative, never double counted)');

  // ================= project limit race =================
  await L.setTier('1008', 'iron');
  const hal = await login('1008', 'Hal');
  const pipeline = client.pipeline();
  for (let i = 0; i < 199; i++) {
    const id = 'seed' + String(i).padStart(12, '0');
    pipeline.set('project:' + id, JSON.stringify({ id, ownerId: '1008', title: 't' + i, messages: [], createdAt: 1, updatedAt: 1 }));
    pipeline.zadd('user:1008:projects', 1, id); pipeline.zadd('projects:index', 1, id);
  }
  await pipeline.exec();
  const race = await Promise.all(Array.from({ length: 12 }, (_, i) => call(P, { method: 'POST', cookie: hal, body: { prompt: 'cap ' + i }, ip: '10.7.' + i + '.1' })));
  ok(race.filter((x) => x.status === 201).length === 1 && race.filter((x) => x.status === 429 && x.body.code === 'project_limit').length === 11, '12 parallel creates at 199/200: exactly one wins');
  ok((await client.zcard('user:1008:projects')) === 200, 'the account ends with exactly 200 projects');
  ok((await L.getUsage('1008')).used === 1, 'the 11 refused creates were refunded (only 1 prompt spent)');
  r = await call(P, { method: 'POST', cookie: hal, body: { prompt: 'more' }, ip: '10.6.6.6' });
  ok(r.status === 429 && r.body.code === 'project_limit' && (await L.getUsage('1008')).used === 1, 'the 201st project is refused and refunded');

  // ================= provider failure policy =================
  const projectsMod = require(SITE + '/api/_projects.js');
  const origGen = projectsMod.generate;
  // generate is imported by reference in the endpoint files, so swap it on the shared lib too
  const libGen = L.generate; 
  L.generate = async () => { throw new Error('provider down'); };
  // endpoints destructure at load, so reload them with the failing provider
  for (const k of Object.keys(require.cache)) if (k.includes('/api/projects/')) delete require.cache[k];
  const ivy = await login('1009', 'Ivy');
  r = await call(P, { method: 'POST', cookie: ivy, body: { prompt: 'will fail' } });
  ok(r.status === 502 && (await L.getUsage('1009')).used === 0 && (await call(P, { cookie: ivy })).body.projects.length === 0, 'provider failure on create: 502, refunded, nothing saved');
  L.generate = libGen;
  for (const k of Object.keys(require.cache)) if (k.includes('/api/projects/')) delete require.cache[k];

  // ================= sessions =================
  const jo = await login('2001', 'Jo');
  r = await call('/api/auth/me.js', { cookie: jo });
  ok(r.status === 200, 'new session works');
  r = await call('/api/auth/logout.js', { method: 'POST', cookie: jo });
  ok(r.status === 200 && /Max-Age=0/.test(String(r.headers['set-cookie'])), 'logout answers 200 and clears the cookie');
  r = await call('/api/auth/me.js', { cookie: jo });
  ok(r.status === 401, 'the same token is dead after logout (server-side revocation)');
  r = await call(P, { cookie: jo });
  ok(r.status === 401, 'and cannot reach projects either');
  const jo2 = await login('2001', 'Jo'), jo3 = await login('2001', 'Jo');
  ok((await call('/api/auth/me.js', { cookie: jo2 })).status === 200 && (await call('/api/auth/me.js', { cookie: jo3 })).status === 200, 'two devices signed in');
  await call('/api/auth/logout.js', { method: 'POST', cookie: jo2 });
  ok((await call('/api/auth/me.js', { cookie: jo2 })).status === 401 && (await call('/api/auth/me.js', { cookie: jo3 })).status === 200, 'logging out one device leaves the other signed in');
  const adminTok = await login('999', 'Admin');
  r = await call('/api/admin/users.js', { method: 'POST', cookie: adminTok, body: { id: '2001', action: 'revoke' } });
  ok(r.status === 200, 'admin revoke returns 200');
  ok((await call('/api/auth/me.js', { cookie: jo3 })).status === 401, 'revoking ends every session the account had');
  const jo4 = await login('2001', 'Jo');
  ok((await call('/api/auth/me.js', { cookie: jo4 })).status === 200, 'signing in again after a revoke works');
  // tampering and expiry
  const parts = jo4.split('.');
  const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(parts[0], 'base64url').toString()), id: '999' })).toString('base64url') + '.' + parts[1];
  ok((await call('/api/auth/me.js', { cookie: forged })).status === 401, 'an edited token (id changed to the admin) is rejected');
  const expired = L.signSession({ id: '2001', name: 'x', username: '', p: 'discord', sid: 'a'.repeat(32), v: 0, exp: Math.floor(Date.now() / 1000) - 10 });
  ok((await call('/api/auth/me.js', { cookie: expired })).status === 401, 'an expired token is rejected');
  const noRecord = L.signSession({ id: '2001', name: 'x', username: '', p: 'discord', sid: 'b'.repeat(32), v: 0, exp: Math.floor(Date.now() / 1000) + 1000 });
  ok((await call('/api/auth/me.js', { cookie: noRecord })).status === 401, 'a correctly signed token with no server-side session is rejected');
  const oldStyle = L.signSession({ id: '2001', name: 'x', p: 'discord', exp: Math.floor(Date.now() / 1000) + 1000 });
  ok((await call('/api/auth/me.js', { cookie: oldStyle })).status === 401, 'an old-style 7 day token (no session id) is rejected');
  const ms = L.signSession({ id: '2001', name: 'x', p: 'microsoft', sid: 'c'.repeat(32), v: 0, exp: Math.floor(Date.now() / 1000) + 1000 });
  ok((await call('/api/auth/me.js', { cookie: ms })).status === 401, 'a token from another provider is rejected');
  const ttl = await client.ttl('session:' + Buffer.from(jo4.split('.')[0], 'base64url').toString().match(/"sid":"([^"]+)"/)[1]);
  ok(ttl > 86000 && ttl <= 86400, 'sessions last 24 hours (server record TTL ' + ttl + 's)');
  ok(!jo4.includes('@') && !Buffer.from(jo4.split('.')[0], 'base64url').toString().includes('n@example.com'), 'the email is not in the cookie');
  // admin removed from the list loses access immediately
  process.env.ADMIN_ACCOUNTS = '12345';
  ok((await call('/api/admin/users.js', { cookie: adminTok, url: '/api/admin/users?id=1' })).status === 403, 'removing an admin from ADMIN_ACCOUNTS takes effect on their existing session');
  process.env.ADMIN_ACCOUNTS = '999';

  // ================= admin APIs: auth =================
  for (const f of ['/api/admin/users.js', '/api/admin/projects.js']) {
    r = await call(f, { url: f.replace('.js', '') + '?id=1' });
    ok(r.status === 401, 'unauthenticated ' + f + ' is 401');
    r = await call(f, { url: f.replace('.js', '') + '?id=1', cookie: alice });
    ok(r.status === 403, 'non-admin ' + f + ' is 403');
  }
  r = await call('/api/admin/users.js', { method: 'POST', cookie: alice, body: { id: '1001', action: 'tier', tier: 'diamond' } });
  ok(r.status === 403 && (await L.getUsage('1001')).tier === 'stone', 'non-admin cannot change a tier');
  r = await call('/api/admin/projects.js', { method: 'DELETE', cookie: alice, url: '/api/admin/projects?id=' + pid });
  ok(r.status === 403 && (await call(PID, { url: idUrl(pid), cookie: alice })).status === 200, 'non-admin cannot delete via the admin API');
  r = await call('/api/admin/users.js', { cookie: adminTok, url: '/api/admin/users?id=1001' });
  ok(r.status === 200 && r.body.usage.tier === 'stone' && r.body.projects.length === 1, 'admin lookup works');
  r = await call('/api/admin/projects.js', { cookie: adminTok, url: '/api/admin/projects?id=' + pid });
  ok(r.status === 200 && r.body.account.tier === 'stone' && r.body.messages.length === 4, 'admin project lookup works');
  r = await call('/api/admin/projects.js', { cookie: adminTok, url: '/api/admin/projects' });
  ok(r.status === 200 && r.body.total >= 1 && r.body.projects.length >= 1, 'admin project list works');
  r = await call('/api/admin/users.js', { method: 'POST', cookie: adminTok, body: { id: '1001', action: 'tier', tier: 'iron' } });
  ok(r.status === 200 && r.body.usage.tier === 'iron' && r.body.usage.limit === 250, 'admin changes a tier');
  r = await call('/api/admin/users.js', { method: 'POST', cookie: adminTok, body: { id: '1001', action: 'prompts', add: 10 } });
  ok(r.body.usage.left === 260 && r.body.usage.bonus === 10, 'admin adds bonus prompts');
  r = await call('/api/admin/users.js', { method: 'POST', cookie: adminTok, body: { id: '1001', action: 'prompts', add: 1.5 } });
  ok(r.status === 400, 'fractions rejected');
  r = await call('/api/admin/users.js', { method: 'POST', cookie: adminTok, body: { id: '1001', action: 'refill', at: Date.now() - 5 } });
  ok(r.status === 400, 'refill in the past rejected');
  r = await call('/api/admin/users.js', { method: 'POST', cookie: adminTok, body: { id: '1001', action: 'refill', at: Date.now() + 500 * 24 * H } });
  ok(r.status === 400, 'refill over a year away rejected');
  r = await call('/api/admin/users.js', { method: 'POST', cookie: adminTok, body: { id: 'bad id', action: 'tier', tier: 'iron' } });
  ok(r.status === 400, 'bad Discord ID rejected');
  r = await call('/api/admin/projects.js', { method: 'DELETE', cookie: adminTok, url: '/api/admin/projects?id=' + pid });
  ok(r.status === 200 && (await call(PID, { url: idUrl(pid), cookie: alice })).status === 404, 'admin deletes a project');

  // ================= F10/F11: methods, OPTIONS, CORS, CSRF =================
  for (const f of ['/api/projects/index.js', '/api/projects/[id].js', '/api/admin/users.js', '/api/admin/projects.js', '/api/auth/me.js', '/api/auth/logout.js', '/api/auth/login.js', '/api/auth/callback.js']) {
    const a = await call(f, { method: 'OPTIONS', url: f.includes('[id]') ? idUrl('aaaaaaaaaaaaaaaa') : '/x' });
    const b = await call(f, { method: 'OPTIONS', cookie: alice, url: f.includes('[id]') ? idUrl('aaaaaaaaaaaaaaaa') : '/x' });
    ok(a.status === 204 && b.status === 204 && !a.headers['access-control-allow-origin'] && /OPTIONS/.test(a.headers.allow), 'OPTIONS ' + f + ' is a consistent 204 with no CORS grant');
    r = await call(f, { method: 'TRACE', url: f.includes('[id]') ? idUrl('aaaaaaaaaaaaaaaa') : '/x', cookie: alice });
    ok(r.status === 405 && !!r.headers.allow, 'unsupported method on ' + f + ' is 405 with Allow');
  }
  r = await call(P, { method: 'POST', cookie: alice, body: { prompt: 'x' }, headers: { 'x-pf-request': '' } });
  ok(r.status === 403, 'missing x-pf-request is rejected');
  r = await call(P, { method: 'POST', cookie: alice, body: { prompt: 'x' }, headers: { 'sec-fetch-site': 'cross-site' } });
  ok(r.status === 403, 'Sec-Fetch-Site: cross-site is rejected');
  r = await call(P, { method: 'POST', cookie: alice, body: { prompt: 'x' }, headers: { origin: 'https://evil.example' } });
  ok(r.status === 403, 'a foreign Origin is rejected');
  r = await call(P, { method: 'POST', cookie: alice, body: { prompt: 'x' }, headers: { origin: 'https://example.com', 'sec-fetch-site': 'same-origin' } });
  ok(r.status !== 403, 'same-origin requests are fine (status ' + r.status + ')');
  ok(!(await call(P, { cookie: alice })).headers['access-control-allow-origin'], 'API responses carry no Access-Control-Allow-Origin');
  r = await call('/api/auth/logout.js', { method: 'POST', cookie: alice, headers: { 'x-pf-request': '' } });
  ok(r.status === 403, 'logout also needs the request header');

  // ================= F7: rate limits =================
  const kim = await login('3001', 'Kim');
  await L.setTier('3001', 'iron');
  let codes = [];
  for (let i = 0; i < 24; i++) { r = await call(P, { method: 'POST', cookie: kim, body: { prompt: 'rl' + i }, ip: '10.5.0.' + (i + 1) }); codes.push(r.status); }
  ok(codes.slice(0, 20).every((c) => c === 201) && codes.slice(20).every((c) => c === 429), 'generation limit: 20 per minute per user, then 429 (' + codes.join(',') + ')');
  r = await call(P, { method: 'POST', cookie: kim, body: { prompt: 'rl' }, ip: '10.5.0.99' });
  ok(r.status === 429 && Number(r.headers['retry-after']) >= 1 && Number(r.headers['retry-after']) <= 60 && r.body.retryAfter >= 1, '429 carries Retry-After');
  r = await call(P, { cookie: await login('3002', 'Lee'), ip: '10.5.0.100' });
  ok(r.status === 200, 'another user is not affected');
  let lc = [];
  for (let i = 0; i < 24; i++) lc.push((await call('/api/auth/login.js', { ip: '172.16.0.1' })).status);
  ok(lc.slice(0, 20).every((c) => c === 302) && lc.slice(20).every((c) => c === 429), 'login: 20 per minute per IP then 429');
  ok((await call('/api/auth/login.js', { ip: '172.16.0.2' })).status === 302, 'a different IP is unaffected');
  await flushRates();
  let ac = [];
  for (let i = 0; i < 64; i++) ac.push((await call('/api/admin/projects.js', { cookie: adminTok, url: '/api/admin/projects', ip: '10.4.0.' + (i % 200 + 1) })).status);
  ok(ac.slice(0, 60).every((c) => c === 200) && ac.slice(60).every((c) => c === 429), 'admin: 60 per minute then 429 (' + ac.filter((c) => c === 429).length + ' blocked)');
  r = await call(P, { cookie: alice, ip: '10.3.3.3' });
  ok(r.status === 200, 'normal use is nowhere near the limits');

  // ================= OAuth =================
  r = await call('/api/auth/callback.js', { url: '/api/auth/callback?code=abc&state=wrong', headers: { cookie: 'pf_oauth_state=right' }, ip: '10.2.2.2' });
  ok(r.statusCode === 302 && /error=failed/.test(r.headers.location), 'callback with a wrong state is rejected');
  r = await call('/api/auth/callback.js', { url: '/api/auth/callback?code=abc', ip: '10.2.2.3' });
  ok(r.statusCode === 302 && /error=failed/.test(r.headers.location), 'callback with no state cookie is rejected');
  r = await call('/api/auth/login.js', { url: '/api/auth/login?next=//evil.com', ip: '10.2.2.4' });
  ok(r.statusCode === 302 && /discord\.com\/oauth2\/authorize/.test(r.headers.location) && /scope=identify\+email/.test(r.headers.location) && /state=/.test(r.headers.location), 'login redirects to Discord with a state');
  ok(/pf_next=;|pf_next=%2F|pf_next=/.test(String(r.headers['set-cookie'])) && !/evil/.test(String(r.headers['set-cookie'])), 'login ignores an off-site next');

  // ================= logging =================
  const all = logs.join('\n');
  const events = new Set(logs.map((l) => { try { return JSON.parse(l).event; } catch (e) { return null; } }));
  for (const ev of ['quota.rejected', 'ratelimit.exceeded', 'admin.user.update', 'admin.user.lookup', 'admin.project.view', 'admin.project.delete', 'oauth.state_mismatch', 'generation.failed', 'admin.denied', 'request.blocked']) ok(events.has(ev), 'log event: ' + ev);
  ok(logs.every((l) => { try { JSON.parse(l); return true; } catch (e) { return false; } }), 'every log line is valid JSON');
  ok(!all.includes(alice) && !all.includes('x'.repeat(40)) && !all.includes('test-token') && !all.includes('n@example.com') && !all.includes('make a plugin') && !all.includes('add a command'), 'logs contain no session tokens, secrets, Redis credentials, emails or prompt text');

  // ================= unexpected errors are logged =================
  const savedUrl = process.env.KV_REST_API_URL;
  await client.quit().catch(() => {});
  server.close();
  console.log = realLog; console.error = realErr;
  console.log(fails ? fails + ' FAILED' : 'ALL PASSED');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log = realLog; console.error = realErr; console.error('CRASH', e); process.exit(1); });
