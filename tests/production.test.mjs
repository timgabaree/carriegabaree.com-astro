import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/index.ts';
import { sendMail } from '../worker/contact.ts';

function environment(overrides = {}) {
  return {
    ENVIRONMENT: 'production', PRODUCTION_ENABLED: 'true', CONTACT_MODE: 'resend',
    RESEND_API_KEY: 'synthetic-test-key', CONTACT_FROM: 'website@forms.carriegabaree.com',
    CONTACT_TO: 'carrie@carriegabaree.com',
    ASSETS: { fetch: async () => new Response('<h1>Page</h1>', { headers: { 'Content-Type': 'text/html' } }) },
    CONTACT_STATE: { idFromName() { throw new Error('Unexpected form state access'); } },
    ...overrides,
  };
}

test('CSP permits both analytics providers without allowing arbitrary scripts', async () => {
  const response = await worker.fetch(new Request('https://carriegabaree.com/'), environment());
  const csp = response.headers.get('Content-Security-Policy');
  const scripts = csp.split(';').find(part => part.trim().startsWith('script-src '));
  const connections = csp.split(';').find(part => part.trim().startsWith('connect-src '));
  assert.match(scripts, /https:\/\/static\.cloudflareinsights\.com/);
  assert.match(scripts, /https:\/\/www\.googletagmanager\.com/);
  assert.doesNotMatch(scripts, /unsafe-inline|unsafe-eval|\*/);
  assert.match(connections, /https:\/\/cloudflareinsights\.com/);
  assert.match(connections, /https:\/\/www\.google-analytics\.com/);
});
test('public archive routes work; WASM is limited to search and private source stays blocked',async()=>{
 for(const path of ['/search','/search/PUB-WEB-great-war','/archive-index/pagefind.js','/archive-index/pagefind-worker.js']){
  const response=await worker.fetch(new Request('https://carriegabaree.com'+path),environment());
  assert.equal(response.status,200);
  const policy=response.headers.get('Content-Security-Policy');
  assert.equal(policy.includes("'wasm-unsafe-eval'"),['/search','/archive-index/pagefind-worker.js'].includes(path));
  assert.ok(!policy.includes("'unsafe-eval'"));assert.ok(!policy.includes("'unsafe-inline'"));
 }
 for(const path of ['/src/data/archive-approved.json','/.local/archive-approved.json','/worker/index.ts']){
  assert.equal((await worker.fetch(new Request('https://carriegabaree.com'+path),environment())).status,404);
 }
 const redirect=await worker.fetch(new Request('https://carriegabaree.com/search/?q=bomb'),environment());
 assert.equal(redirect.status,301);assert.equal(redirect.headers.get('location'),'/search?q=bomb');
});

test('old archive bookmarks redirect to search without losing the query',async()=>{
 for(const [oldPath,newPath] of [['/archive','/search'],['/archive/','/search'],['/archive.html','/search'],['/archive/PUB-WEB-great-war','/search/PUB-WEB-great-war'],['/archive/AOBJ-0001.html','/search/AOBJ-0001']]){
  const query='?q=bomb&match=bombing&type=Publication';
  const response=await worker.fetch(new Request('https://carriegabaree.com'+oldPath+query),environment());
  assert.equal(response.status,301);assert.equal(response.headers.get('location'),newPath+query);
 }
});

test('production preparation is locked, including pages, assets and contact endpoints', async () => {
  for (const override of [{ PRODUCTION_ENABLED: undefined }, { PRODUCTION_ENABLED: 'false' },
    { PRODUCTION_ENABLED: 'TRUE' }, { RESEND_API_KEY: undefined }, { CONTACT_FROM: '' },
    { CONTACT_TO: '' }, { CONTACT_MODE: 'dry-run' }]) {
    for (const path of ['/', '/robots.txt', '/css/style.css', '/contact-token', '/contact-submit']) {
      const response = await worker.fetch(new Request(`https://carriegabaree.com${path}`), environment(override));
      assert.equal(response.status, 503);
      assert.match(response.headers.get('X-Robots-Tag'), /noindex/);
      assert.match(response.headers.get('Cache-Control'), /no-store/);
    }
  }
});

test('production redirects HTTP and www, retaining path, query and POST semantics', async () => {
  for (const origin of ['http://carriegabaree.com', 'http://www.carriegabaree.com', 'https://www.carriegabaree.com']) {
    for (const method of ['GET', 'HEAD', 'POST']) {
      const response = await worker.fetch(new Request(`${origin}/contact?topic=board%20advisory&x=1`, { method }), environment());
      assert.equal(response.status, 308);
      assert.equal(response.headers.get('Location'), 'https://carriegabaree.com/contact?topic=board%20advisory&x=1');
    }
  }
  const response = await worker.fetch(new Request('https://www.carriegabaree.com//outside.invalid/path'), environment());
  assert.equal(new URL(response.headers.get('Location')).origin, 'https://carriegabaree.com');
});

test('production rejects alternate hosts and ignores forwarded-host spoofing', async () => {
  for (const host of ['preview.example.invalid', 'rgesol-com-astro-production.workers.dev', 'carriegabaree.com.attacker.invalid']) {
    const response = await worker.fetch(new Request(`https://${host}/`, { headers: { 'X-Forwarded-Host': 'carriegabaree.com' } }), environment());
    assert.equal(response.status, 404);
    assert.match(response.headers.get('X-Robots-Tag'), /noindex/);
  }
  const response = await worker.fetch(new Request('https://carriegabaree.com/', { headers: { 'X-Forwarded-Host': 'attacker.invalid' } }), environment());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Location'), null);
  assert.equal(response.headers.get('WWW-Authenticate'), null);
  assert.equal(response.headers.get('X-Robots-Tag'), null);
  assert.equal(response.headers.get('Cache-Control'), 'no-cache');
  assert.match(response.headers.get('Strict-Transport-Security'), /max-age=/);
});

test('production retains legacy links and protects error and thank-you responses', async () => {
  for (const [path, target] of [['/index.php?x=1', '/?x=1'], ['/publications.html?x=1', '/publications?x=1'],
    ['/contact.html', '/contact'], ['/privacy/', '/privacy']]) {
    const response = await worker.fetch(new Request(`https://carriegabaree.com${path}`), environment());
    assert.equal(response.status, 301);
    assert.equal(response.headers.get('Location'), target);
  }
  for (const path of ['/thank-you', '/.env', '/includes/config.php', '/worker/index.ts']) {
    const response = await worker.fetch(new Request(`https://carriegabaree.com${path}`), environment());
    assert.equal(response.status, path === '/thank-you' ? 200 : 404);
    assert.match(response.headers.get('X-Robots-Tag'), /noindex/);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
  }
  const failure = await worker.fetch(new Request('https://carriegabaree.com/'), environment({ ASSETS: { fetch() { throw new Error('Synthetic outage'); } } }));
  assert.equal(failure.status, 503);
  assert.equal(failure.headers.get('Cache-Control'), 'no-store');
});

test('production email uses the fixed recipient and has no staging subject prefix', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, 'https://api.resend.com/emails');
    const payload = JSON.parse(options.body);
    assert.equal(payload.subject, 'Website inquiry: Other');
    assert.deepEqual(payload.to, ['carrie@carriegabaree.com']);
    assert.equal(payload.reply_to, 'synthetic@example.invalid');
    assert.equal(payload.from, 'website@forms.carriegabaree.com');
    assert.equal(payload.html, undefined);
    return Response.json({ id: 'synthetic-only' });
  });
  assert.equal(await sendMail({ name: 'Test', email: 'synthetic@example.invalid', topic: 'other',
    message: 'Synthetic only', csrf_token: 'a'.repeat(64) }, environment()), true);
});
