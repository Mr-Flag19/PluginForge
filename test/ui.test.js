// Browser tests of the built pages under the real CSP from vercel.json, against the real API + real Redis.
const path = require('path');
const { execSync } = require('child_process');
const { chromium } = (() => { try { return require('playwright'); } catch (e) { return require(execSync('npm root -g').toString().trim() + '/playwright'); } })();
const { start: startRedis } = require('./redis_shim');
const { start: startSite } = require('./devserver');
const SITE = path.resolve(__dirname, '..');
process.env.KV_REST_API_URL = 'http://127.0.0.1:8799'; process.env.KV_REST_API_TOKEN = 'test-token';
process.env.DISCORD_CLIENT_ID = '1'; process.env.DISCORD_CLIENT_SECRET = 's'; process.env.SESSION_SECRET = 'x'.repeat(40);
process.env.SITE_URL = 'http://127.0.0.1:8801'; process.env.ADMIN_ACCOUNTS = '999';
const realLog = console.log; console.log = () => {}; console.error = () => {};
const out = (...a) => realLog(...a);
let fails = 0; const ok = (c, m) => { if (!c) { fails++; out('FAIL', m); } else out('ok  ', m); };
const BASE = 'http://127.0.0.1:8801';

(async () => {
  const { server: rs, client } = await startRedis(8799, Number(process.env.REDIS_PORT || 6391)); await client.flushall();
  const site = await startSite(8801);
  const L = require(SITE + '/api/_lib.js');
  const browser = await chromium.launch();
  const mk = async (id, name) => {
    const tok = await L.createSession({ id, name, username: name.toLowerCase(), avatar: '' }, name + '@example.com');
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    if (id) await ctx.addCookies([{ name: 'pf_session', value: tok, url: BASE }]);
    return ctx;
  };
  const watch = (page, bag) => {
    page.on('console', (m) => { if (/Content Security Policy|Refused to/i.test(m.text())) bag.csp.push(m.text().slice(0, 160)); if (m.type() === 'error' && !/Content Security|Failed to load resource|fonts/i.test(m.text())) bag.err.push(m.text().slice(0, 160)); });
    page.on('pageerror', (e) => bag.err.push('pageerror ' + e.message.slice(0, 160)));
    page.route('**/*', (r) => { const u = r.request().url(); if (u.startsWith(BASE)) return r.continue(); if (/fonts\.googleapis\.com/.test(u)) return r.fulfill({ status: 200, contentType: 'text/css', body: '' }); bag.external.push(u.slice(0, 100)); return r.abort(); });
  };
  const bag = () => ({ csp: [], err: [], external: [] });

  // ---- headers on every page ----
  for (const p of ['/', '/code/', '/admin/', '/code/abcdefghij012345', '/api/auth/me']) {
    const r = await fetch(BASE + p); const h = r.headers; const csp = h.get('content-security-policy') || '';
    ok(/frame-ancestors 'none'/.test(csp) && /script-src 'self'(;|$)/.test(csp) && !/unsafe-/.test(csp) && h.get('x-frame-options') === 'DENY' && h.get('x-content-type-options') === 'nosniff' && h.get('referrer-policy') && h.get('permissions-policy') && /max-age/.test(h.get('strict-transport-security') || ''), 'security headers present on ' + p + ' (no unsafe-inline / unsafe-eval)');
  }
  ok(/noindex/.test((await fetch(BASE + '/admin/')).headers.get('x-robots-tag') || ''), '/admin/ is noindex');
  ok((await fetch(BASE + '/code/abcdefghij012345')).status === 200, 'project URL rewrite still serves the chat page');

  // ---- no Babel/CDN left in the HTML ----
  for (const f of ['index.html', 'code/index.html', 'admin/index.html']) {
    const t = require('fs').readFileSync(SITE + '/' + f, 'utf8');
    ok(!/babel|unpkg|cdn\.tailwindcss|text\/babel/i.test(t) && !/<script(?![^>]*\bsrc=)[^>]*>[^<]/.test(t) && !/<style/.test(t) && !/ style=/.test(t) && !/\son[a-z]+=/.test(t), f + ': no Babel, no CDN scripts, no inline script/style/handlers');
  }

  // ---- landing ----
  let ctx = await mk('', 'x'); let page = await ctx.newPage(); let b = bag(); watch(page, b);
  await page.goto(BASE + '/'); await page.waitForSelector('#root *', { timeout: 8000 });
  ok((await page.locator('#root').innerText()).length > 200 && b.csp.length === 0 && b.err.length === 0 && b.external.length === 0, 'landing renders under CSP, no violations/errors/external loads ' + JSON.stringify(b));
  await page.close(); await ctx.close();

  // ---- chat signed out ----
  ctx = await mk('', 'x'); page = await ctx.newPage(); b = bag(); watch(page, b);
  await page.goto(BASE + '/code/'); await page.waitForSelector('#root *', { timeout: 8000 });
  ok(/Discord/i.test(await page.locator('#root').innerText()) && b.csp.length === 0 && b.err.length === 0, 'chat shows Discord sign-in when signed out, no CSP violations ' + JSON.stringify(b));
  await page.close(); await ctx.close();

  // ---- chat signed in: create, send, quota, delete ----
  ctx = await mk('500100000000000001', 'Tester'); page = await ctx.newPage(); b = bag(); watch(page, b);
  await page.goto(BASE + '/code/'); await page.waitForSelector('textarea', { timeout: 8000 });
  ok(/5\s*\/\s*5|5 .*left/i.test(await page.locator('body').innerText()), 'meter shows 5 prompts at the start');
  await page.fill('textarea', 'first prompt'); await page.keyboard.press('Enter');
  await page.waitForFunction(() => /isn't connected|not connected|generation/i.test(document.body.innerText), null, { timeout: 8000 });
  await page.waitForURL(/\/code\/[a-z0-9]{16}/, { timeout: 8000 });
  const stored = await client.keys('project:*');
  ok(stored.length === 1, 'sending the first prompt created one project on the server');
  ok((await L.getUsage('500100000000000001')).used === 1, 'server charged 1 prompt');
  await page.waitForFunction(() => /4\s*\/\s*5|4 .*left/i.test(document.body.innerText), null, { timeout: 8000 }).then(() => ok(true, 'meter updated to 4 without a reload'), () => ok(false, 'meter updated to 4 without a reload'));
  for (let i = 2; i <= 5; i++) { await page.fill('textarea', 'prompt ' + i); await page.keyboard.press('Enter'); await page.waitForFunction((n) => document.body.innerText.includes('prompt ' + n) , i); await page.waitForTimeout(250); }
  await page.waitForFunction(() => /0\s*\/\s*5|0 .*left|no prompts/i.test(document.body.innerText), null, { timeout: 8000 });
  ok((await L.getUsage('500100000000000001')).used === 5, 'five prompts used');
  await page.fill('textarea', 'sixth prompt'); await page.keyboard.press('Enter');
  await page.waitForFunction(() => /no prompts left/i.test(document.body.innerText), null, { timeout: 8000 }).then(() => ok(true, 'sixth prompt shows the no-prompts notice'), () => ok(false, 'sixth prompt shows the no-prompts notice'));
  ok((await page.inputValue('textarea')) === 'sixth prompt', 'the refused prompt is back in the box');
  ok((await L.getUsage('500100000000000001')).used === 5, 'refused prompt was not charged');
  const pid = (await client.keys('project:*'))[0].slice(8);
  const saved = JSON.parse(await client.get('project:' + pid));
  ok(saved.messages.length === 10 && !saved.messages.some((m) => m.text === 'sixth prompt'), 'saved conversation has the 5 accepted prompts + 5 replies and not the refused one');
  await page.reload(); await page.waitForFunction(() => document.body.innerText.includes('first prompt'), null, { timeout: 8000 });
  ok(true, 'conversation reloads from the server');
  ok(b.csp.length === 0 && b.err.length === 0 && b.external.length === 0, 'chat: no CSP violations, errors or external loads ' + JSON.stringify(b));
  // delete via API as owner
  const del = await page.evaluate(async (id) => (await fetch('/api/projects/' + id, { method: 'DELETE', headers: { 'x-pf-request': '1' } })).status, pid);
  ok(del === 200 || del === 204, 'owner can delete (' + del + ')');
  ok((await client.keys('project:*')).length === 0, 'project gone from Redis');
  await page.close(); await ctx.close();

  // ---- admin ----
  ctx = await mk('', 'x'); page = await ctx.newPage(); b = bag(); watch(page, b);
  await page.goto(BASE + '/admin/'); await page.waitForTimeout(1200);
  ok(/sign in|discord/i.test(await page.locator('body').innerText()) && b.csp.length === 0 && b.err.length === 0, 'admin signed out shows sign-in ' + JSON.stringify(b));
  await ctx.close();
  ctx = await mk('500200000000000002', 'Normal'); page = await ctx.newPage(); b = bag(); watch(page, b);
  await page.goto(BASE + '/admin/'); await page.waitForTimeout(1200);
  ok(/denied/i.test(await page.locator('body').innerText()), 'non-admin sees Access Denied');
  await ctx.close();
  ctx = await mk('999', 'Boss'); page = await ctx.newPage(); b = bag(); watch(page, b);
  await page.goto(BASE + '/admin/'); await page.waitForTimeout(1200);
  await page.click('#tab-users'); await page.fill('#u-id, input[placeholder*="Discord" i]', '500100000000000001').catch(() => {});
  const idBox = page.locator('#user-id'); await idBox.fill('500100000000000001'); await idBox.press('Enter');
  await page.waitForSelector('#user:not([hidden])', { timeout: 8000 }).catch(async () => { realLog('DEBUG', await page.locator('#user-error').innerText(), b.err.join('|')); });
  ok(/Stone/i.test(await page.locator('#user').innerText()), 'admin user lookup renders the plan');
  await page.click('#u-refill-now'); await page.waitForFunction(() => /Refilled/.test(document.body.innerText));
  ok(true, 'admin refill button works under CSP');
  await page.fill('#u-tier, #u-amount', '').catch(() => {});
  page.once('dialog', (d) => d.accept());
  await page.click('#u-revoke'); await page.waitForFunction(() => /Signed out everywhere/.test(document.body.innerText), null, { timeout: 8000 }).then(() => ok(true, 'sign out everywhere button works'), () => ok(false, 'sign out everywhere button works'));
  ok(b.csp.length === 0 && b.err.length === 0 && b.external.length === 0, 'admin: no CSP violations, errors or external loads ' + JSON.stringify(b));
  await ctx.close();

  // ---- clickjacking: another origin framing our pages ----
  const evil = require('http').createServer((q, r) => { r.setHeader('content-type', 'text/html'); r.end('<iframe id=a src="' + BASE + '/admin/"></iframe><iframe id=b src="' + BASE + '/code/"></iframe>'); }).listen(8802, '127.0.0.1');
  ctx = await browser.newContext(); page = await ctx.newPage();
  const framed = []; page.on('framenavigated', (f) => { if (f.url().startsWith(BASE)) framed.push(f.url()); });
  await page.goto('http://127.0.0.1:8802/'); await page.waitForTimeout(1500);
  const urls = page.frames().filter((f) => f !== page.mainFrame()).map((f) => f.url());
  ok(urls.length === 2 && urls.every((u) => !u.startsWith(BASE) && /chrome-error/.test(u)), 'both framed pages (/admin/, /code/) were refused by the browser: ' + urls.join(' '));
  evil.close(); await ctx.close();

  await browser.close(); site.close(); rs.close(); await client.quit().catch(() => {});
  console.log = realLog; console.log(fails ? fails + ' FAILED' : 'ALL PASSED'); process.exit(fails ? 1 : 0);
})().catch((e) => { console.log = realLog; realLog('CRASH', e.message, e.stack && e.stack.split('\n')[1]); process.exit(1); });
