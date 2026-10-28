import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/index.ts';
import { ContactState } from '../worker/state.ts';
import { validateForm, sendMail } from '../worker/contact.ts';

// The HTTP integration suite additionally exercises the real Durable Object runtime.
function storage() {
  const values = new Map();
  let queue = Promise.resolve();
  const store = {
    get: async (key) => structuredClone(values.get(key)),
    put: async (key, value) => { values.set(key, structuredClone(value)); },
    delete: async (key) => values.delete(key),
    deleteAll: async () => values.clear(),
    setAlarm: async () => {},
    transaction: (callback) => {
      const next = queue.then(() => callback(store));
      queue = next.catch(() => {});
      return next;
    },
  };
  return store;
}

function environment(overrides = {}) {
  const objects = new Map();
  return {
    ENVIRONMENT: 'local', CONTACT_MODE: 'dry-run',
    ASSETS: { fetch: async () => new Response('<h1>Test page</h1>', { headers: { 'Content-Type': 'text/html' } }) },
    CONTACT_STATE: {
      idFromName: (name) => name,
      get: (name) => {
        if (!objects.has(name)) objects.set(name, new ContactState({ storage: storage() }));
        return { fetch: (url, init) => objects.get(name).fetch(new Request(url, init)) };
      },
    },
    ...overrides,
  };
}

const valid = {
  name: 'Staging Test', organization: 'Test Organization', email: 'test@example.invalid',
  phone: '', topic: 'other', message: 'Synthetic test. Do not send.', website: '', csrf_token: 'a'.repeat(64),
};

async function token(env) {
  const response = await worker.fetch(new Request('http://localhost/contact-token'), env);
  assert.equal(response.status, 200);
  const cookie = response.headers.get('Set-Cookie').split(';')[0];
  return { ...(await response.json()), cookie };
}

function submit(env, session, data = {}, headers = {}) {
  return worker.fetch(new Request('http://localhost/contact-submit', {
    method: 'POST', headers: {
      Origin: 'http://localhost', Cookie: session.cookie,
      'Content-Type': 'application/x-www-form-urlencoded', ...headers,
    }, body: new URLSearchParams({ ...valid, csrf_token: session.csrf_token, ...data }),
  }), env);
}

test('validates required fields, limits, email, duplicates, topics and header injection', () => {
  assert.equal(validateForm(new URLSearchParams(valid)).status, undefined);
  for (const [fields, expected] of [
    [{ name: '' }, 'missing'], [{ email: 'invalid' }, 'invalid-email'],
    [{ name: 'a'.repeat(101) }, 'invalid'], [{ organization: 'a'.repeat(151) }, 'invalid'],
    [{ phone: 'a'.repeat(41) }, 'invalid'], [{ message: 'a'.repeat(5001) }, 'invalid'],
    [{ topic: '__proto__' }, 'invalid'], [{ topic: 'constructor' }, 'invalid'],
    [{ name: 'Test\r\nBcc: other@example.invalid' }, 'invalid'],
    [{ email: 'test@example.invalid\nBcc: other@example.invalid' }, 'invalid'],
    [{ message: 'bad\u0000body' }, 'invalid'],
  ]) assert.equal(validateForm(new URLSearchParams({ ...valid, ...fields })).status, expected);
  const duplicate = new URLSearchParams(valid);
  duplicate.append('email', 'other@example.invalid');
  assert.equal(validateForm(duplicate).status, 'invalid');
});

test('staging is closed by default and protects pages, assets, and APIs', async () => {
  const env = environment({ ENVIRONMENT: 'staging' });
  for (const path of ['/', '/media/profile-pic-tim-gabaree-900x1200.webp', '/contact-token']) {
    const response = await worker.fetch(new Request(`https://staging.example.invalid${path}`), env);
    assert.equal(response.status, 503);
    assert.match(response.headers.get('X-Robots-Tag'), /noindex/);
    assert.match(response.headers.get('Cache-Control'), /no-store/);
  }
  env.STAGING_USER = 'review'; env.STAGING_PASSWORD = 'test-only-long-password-12345';
  assert.equal((await worker.fetch(new Request('https://staging.example.invalid/'), env)).status, 401);
  const response = await worker.fetch(new Request('https://staging.example.invalid/', {
    headers: { Authorization: `Basic ${btoa(`${env.STAGING_USER}:${env.STAGING_PASSWORD}`)}` },
  }), env);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('Vary'), /Authorization/);
});

test('local bypass cannot be used on a remote hostname; unknown environments fail closed', async () => {
  assert.equal((await worker.fetch(new Request('https://public.example.invalid/'), environment())).status, 503);
  assert.equal((await worker.fetch(new Request('http://localhost/'), environment({ ENVIRONMENT: 'typo' }))).status, 503);
});

test('legacy aliases preserve query strings and private files never reach assets', async () => {
  const env = environment();
  for (const [path, location] of [['/index.php?a=1', '/?a=1'], ['/publications.html', '/publications'], ['/contact.html', '/contact'], ['/privacy/', '/privacy'], ['/portfolio/citations/ah104wpp30-31.html?x=1', '/portfolio/citations/ah104wpp30-31?x=1']]) {
    const response = await worker.fetch(new Request(`http://localhost${path}`), env);
    assert.equal(response.status, 301); assert.equal(response.headers.get('Location'), location);
  }
  for (const path of ['/includes/config.php', '/.git/config', '/css/.htaccess', '/%2eenv', '/test.php', '/worker/index.ts']) {
    assert.equal((await worker.fetch(new Request(`http://localhost${path}`), env)).status, 404);
  }
  const robots = await worker.fetch(new Request('http://localhost/robots.txt'), env);
  assert.match(await robots.text(), /Disallow: \//);
});

test('security token, no-email success, replay rejection and false conversion', async () => {
  const env = environment();
  const session = await token(env);
  assert.match(session.csrf_token, /^[a-f0-9]{64}$/); assert.equal(session.test_mode, true);
  const response = await submit(env, session);
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('Location'), '/contact?status=test-success');
  assert.equal((await submit(env, session)).headers.get('Location'), '/contact?status=security-error');
  const conversion = await worker.fetch(new Request('http://localhost/contact-conversion?submitted=1', {
    method: 'POST', headers: { Origin: 'http://localhost', Cookie: session.cookie },
  }), env);
  assert.deepEqual(await conversion.json(), { converted: false });
});

test('cross-origin requests, wrong methods and absent or mismatched sessions fail', async () => {
  const env = environment(), session = await token(env);
  assert.equal((await submit(env, session, {}, { Origin: 'https://attacker.invalid' })).headers.get('Location'), '/contact?status=invalid');
  assert.equal((await submit(env, session, {}, { Origin: 'null' })).headers.get('Location'), '/contact?status=invalid');
  assert.equal((await submit(env, session, { csrf_token: 'b'.repeat(64) })).headers.get('Location'), '/contact?status=security-error');
  assert.equal((await submit(env, { ...session, cookie: '' })).headers.get('Location'), '/contact?status=security-error');
  assert.equal((await worker.fetch(new Request('http://localhost/contact-submit'), env)).status, 405);
  assert.equal((await worker.fetch(new Request('http://localhost/contact-conversion'), env)).status, 405);
  assert.equal((await worker.fetch(new Request('http://localhost/contact-token', { headers: { Origin: 'https://attacker.invalid' } }), env)).status, 403);
});

test('bounded request reading rejects oversized bodies and file upload content types', async () => {
  const env = environment(), session = await token(env);
  const oversized = await worker.fetch(new Request('http://localhost/contact-submit', {
    method: 'POST', headers: { Origin: 'http://localhost', Cookie: session.cookie, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `message=${'a'.repeat(52_000)}`,
  }), env);
  assert.equal(oversized.headers.get('Location'), '/contact?status=invalid');
  assert.equal((await submit(env, session, {}, { 'Content-Type': 'multipart/form-data' })).headers.get('Location'), '/contact?status=invalid');
});

test('per-address submission limit persists across new browser sessions', async () => {
  const env = environment();
  for (let i = 0; i < 5; i++) {
    const session = await token(env);
    assert.equal((await submit(env, session, { name: '' })).headers.get('Location'), '/contact?status=missing');
  }
  assert.equal((await submit(env, await token(env))).headers.get('Location'), '/contact?status=rate-limited');
});

test('token issuance is rate-limited and valid tokens remain stable across tabs', async () => {
  const env = environment(), session = await token(env);
  const repeat = await worker.fetch(new Request('http://localhost/contact-token', { headers: { Cookie: session.cookie } }), env);
  assert.equal((await repeat.json()).csrf_token, session.csrf_token);
  for (let i = 2; i < 30; i++) await token(env);
  assert.equal((await worker.fetch(new Request('http://localhost/contact-token'), env)).status, 429);
});

test('honeypot accepts without email or conversion; production cannot report dry-run success', async () => {
  const env = environment(), session = await token(env);
  assert.equal((await submit(env, session, { website: 'https://spam.invalid' })).headers.get('Location'), '/thank-you');
  const production = environment({ ENVIRONMENT: 'production', PRODUCTION_ENABLED: 'true' });
  const response = await worker.fetch(new Request('https://carriegabaree.com/contact-token'), production);
  assert.equal(response.status, 503, 'production rejects dry-run or missing delivery credentials');
});

test('provider path uses fixed recipient and reply-to; failure is not a success', async (t) => {
  const env = environment({ CONTACT_MODE: 'resend', RESEND_API_KEY: 'test-key', CONTACT_FROM: 'sender@example.invalid', CONTACT_TO: 'owner@example.invalid' });
  let calls = 0;
  const mocked = t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls++; assert.equal(url, 'https://api.resend.com/emails');
    const payload = JSON.parse(options.body);
    assert.deepEqual(payload.to, ['owner@example.invalid']);
    assert.equal(payload.reply_to, valid.email);
    assert.match(payload.subject, /^\[STAGING\]/);
    assert.equal(payload.html, undefined);
    return Response.json({ id: 'synthetic-message-id' });
  });
  assert.equal(await sendMail(valid, environment()), false); assert.equal(calls, 0);
  assert.equal(await sendMail(valid, env), true);
  mocked.mock.mockImplementation(async () => Response.json({ error: 'failure' }, { status: 500 }));
  assert.equal(await sendMail(valid, env), false);
  mocked.mock.mockImplementation(async () => { throw new Error('timeout'); });
  assert.equal(await sendMail(valid, env), false);
});

test('real success produces one conversion only, including concurrent reads', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ id: 'synthetic-message-id' }));
  const env = environment({ CONTACT_MODE: 'resend', RESEND_API_KEY: 'test-key', CONTACT_FROM: 'sender@example.invalid', CONTACT_TO: 'owner@example.invalid' });
  const session = await token(env);
  assert.equal((await submit(env, session)).headers.get('Location'), '/thank-you');
  const read = () => worker.fetch(new Request('http://localhost/contact-conversion', {
    method: 'POST', headers: { Origin: 'http://localhost', Cookie: session.cookie },
  }), env).then((response) => response.json());
  assert.deepEqual((await Promise.all([read(), read()])).map((item) => item.converted).sort(), [false, true]);
});

test('session state expires and simultaneous submissions consume a token once', async (t) => {
  const store = storage(), state = new ContactState({ storage: store });
  const call = (path, body = {}) => state.fetch(new Request(`https://state.internal/${path}`, { method: 'POST', body: JSON.stringify(body) })).then((r) => r.json());
  let now = Date.now();
  t.mock.method(Date, 'now', () => now);
  const token = (await call('token')).csrf_token;
  now += 3_600_001;
  assert.equal((await call('consume', { token })).allowed, false);
  const fresh = (await call('token')).csrf_token;
  const results = await Promise.all([call('consume', { token: fresh }), call('consume', { token: fresh })]);
  assert.equal(results.filter((result) => result.allowed).length, 1);
  await call('delivered');
  await state.alarm();
  assert.equal((await call('conversion')).converted, false);
});
