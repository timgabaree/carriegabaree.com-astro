import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Webhook } from 'svix';
import monitor, { DeliveryStatus } from '../worker/email-monitor.ts';
import { sendMail } from '../worker/contact.ts';
import { persistMailIssue } from '../worker/monitoring.ts';

const secret = 'whsec_' + Buffer.from('synthetic-test-only-key-32-bytes!!').toString('base64');
function fixture() {
  const values = new Map();
  let queue = Promise.resolve(), alarm = null;
  const storage = {
    get: async key => values.get(key), put: async (key, value) => values.set(key, value),
    delete: async key => { for (const item of Array.isArray(key) ? key : [key]) values.delete(item); },
    getAlarm: async () => alarm, setAlarm: async value => { alarm = value; },
    list: async ({ prefix = '', startAfter = '', limit = 1000 } = {}) => new Map([...values].filter(([k]) => k.startsWith(prefix) && k > startAfter).sort(([a], [b]) => a.localeCompare(b)).slice(0, limit)),
    transaction(callback) {
      const next = queue.then(() => callback(storage));
      queue = next.catch(() => {}); return next;
    },
  };
  let object = new DeliveryStatus({ storage });
  return { values, storage, alarm: () => object.alarm(), restart: () => { object = new DeliveryStatus({ storage }); },
    fetch: (url, options) => object.fetch(new Request(url, options)) };
}
function env() {
  const primary = fixture(), fallback = fixture();
  const objects = new Map([['carrie/contact-delivery', primary], ['carrie/contact-delivery-fallback', fallback]]);
  const getObject = name => { if (!objects.has(name)) objects.set(name, fixture()); return objects.get(name); };
  return {
    RESEND_WEBHOOK_SECRET: secret, MONITOR_ADMIN_KEY: 'test-only-admin-key',
    __values: primary.values, __fallback: fallback.values, __storage: primary.storage, __alarm: primary.alarm,
    __restart: () => { for (const object of objects.values()) object.restart(); },
    __monitor: () => getObject('monitor/contact-delivery').values,
    DELIVERY_STATUS: {
      idFromName: name => ({ name, equals: other => name === other.name }),
      get: id => ({ fetch: getObject(id.name).fetch }),
    },
  };
}
const event = (type = 'email.failed') => ({
  type, data: { to: ['carrie@carriegabaree.com'], tags: { application: 'carrie-contact', environment: 'production' },
    subject: 'PRIVATE SUBJECT', from: 'PRIVATE SENDER', failed: { reason: 'PRIVATE DETAILS' },
    text: 'PRIVATE MESSAGE', email_id: 'PRIVATE ID' },
});
function request(payload = event(), { date = new Date(), id = 'msg_test', signature, method = 'POST', contentType = 'application/json' } = {}) {
  const body = JSON.stringify(payload);
  return new Request('https://monitor.example/resend', {
    method, body, headers: {
      'Content-Type': contentType, 'svix-id': id,
      'svix-timestamp': String(Math.floor(date.getTime() / 1000)),
      'svix-signature': signature ?? new Webhook(secret).sign(id, date, body),
    },
  });
}

test('signed failure logs only fixed operational fields, and retries/concurrency are deduplicated', async (t) => {
  const logs = t.mock.method(console, 'error', () => {});
  const environment = env();
  const responses = await Promise.all([monitor.fetch(request(), environment), monitor.fetch(request(), environment)]);
  assert.deepEqual(responses.map(r => r.status), [204, 204]);
  assert.equal(logs.mock.calls.length, 1);
  assert.deepEqual(logs.mock.calls[0].arguments, [{ message: 'FLEET_CONTACT_ALERT', environment: 'production', issue: 'email.failed' }]);
  assert.doesNotMatch(JSON.stringify(logs.mock.calls[0].arguments), /PRIVATE|tim@/);
});

for (const type of ['email.bounced', 'email.delivery_delayed', 'email.suppressed', 'email.complained']) {
  test(`handles ${type}`, async (t) => {
    const logs = t.mock.method(console, 'error', () => {});
    assert.equal((await monitor.fetch(request(event(type)), env())).status, 204);
    assert.equal(logs.mock.calls[0].arguments[0].issue, type);
  });
}

test('rejects unsigned, modified, stale, future and wrong-secret events without logging attacker data', async (t) => {
  const logs = t.mock.method(console, 'error', () => {});
  for (const options of [
    { signature: '' }, { signature: 'v1,invalid' },
    { date: new Date(Date.now() - 600_000) }, { date: new Date(Date.now() + 600_000) },
  ]) assert.equal((await monitor.fetch(request(event(), options), env())).status, 400);
  const valid = request();
  assert.equal((await monitor.fetch(new Request(valid.url, { method: 'POST', headers: valid.headers, body: JSON.stringify(event('email.bounced')) }), env())).status, 400);
  assert.equal((await monitor.fetch(request(), { ...env(), RESEND_WEBHOOK_SECRET: 'whsec_' + Buffer.from('different').toString('base64') })).status, 400);
  assert.equal(logs.mock.calls.length, 0);
});

test('ignores signed events for unrelated applications, recipients and successes', async (t) => {
  const logs = t.mock.method(console, 'error', () => {});
  const cases = [event('email.delivered'), event('email.sent'), {}, { ...event(), data: {} }];
  for (const change of [
    { to: ['other@example.invalid'] }, { to: ['carrie@carriegabaree.com', 'other@example.invalid'] },
    { tags: { application: 'other', environment: 'production' } },
    { tags: { application: 'carrie-contact', environment: 'invalid' } },
  ]) cases.push({ ...event(), data: { ...event().data, ...change } });
  for (const payload of cases) assert.equal((await monitor.fetch(request(payload), env())).status, 204);
  assert.equal(logs.mock.calls.length, 0);
});

test('bounds request sizes, methods and public surface; health fails closed without configuration', async () => {
  assert.equal((await monitor.fetch(request({ data: 'x'.repeat(66_000) }), env())).status, 413);
  assert.equal((await monitor.fetch(request(event(), { contentType: 'text/plain' }), env())).status, 415);
  for (const path of ['/', '/resend?token=secret', '/private', '/health?x=1']) {
    assert.equal((await monitor.fetch(new Request('https://monitor.example' + path), env())).status, 404);
  }
  assert.equal((await monitor.fetch(new Request('https://monitor.example/resend'), env())).status, 405);
  for (const method of ['GET', 'HEAD']) {
    const response = await monitor.fetch(new Request('https://monitor.example/health', { method }), env());
    assert.equal(response.status, 200); assert.equal(await response.text(), '');
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.match(response.headers.get('X-Robots-Tag'), /noindex/);
  }
  assert.equal((await monitor.fetch(request(), { ...env(), RESEND_WEBHOOK_SECRET: undefined })).status, 503);
});

test('dedup failure is retryable and produces a sanitized infrastructure alert', async (t) => {
  const logs = t.mock.method(console, 'error', () => {});
  const broken = { ...env(), DELIVERY_STATUS: { idFromName: x => x, get: () => { throw new Error('PRIVATE FAILURE'); } } };
  assert.equal((await monitor.fetch(request(), broken)).status, 503);
  assert.deepEqual(logs.mock.calls[0].arguments, [{ message: 'FLEET_CONTACT_ALERT', environment: 'production', issue: 'monitor_runtime_error' }]);
});

test('send adapter tags messages and reports API errors, malformed responses and timeouts without private data', async (t) => {
  const logs = t.mock.method(console, 'error', () => {});
  const data = { name: 'PRIVATE NAME', email: 'PRIVATE EMAIL', message: 'PRIVATE MESSAGE', topic: 'other', csrf_token: 'PRIVATE TOKEN' };
  const environment = { ...env(), ENVIRONMENT: 'production', CONTACT_MODE: 'resend', CONTACT_FROM: 'PRIVATE FROM', CONTACT_TO: 'PRIVATE TO', RESEND_API_KEY: 'PRIVATE KEY' };
  const fetched = t.mock.method(globalThis, 'fetch', async (_url, options) => {
    assert.deepEqual(JSON.parse(options.body).tags, [{ name: 'application', value: 'carrie-contact' }, { name: 'environment', value: 'production' }]);
    return Response.json({ id: 'test-id' });
  });
  assert.equal(await sendMail(data, environment), true);
  assert.equal(logs.mock.calls.length, 0);
  fetched.mock.mockImplementation(async () => new Response('PRIVATE ERROR', { status: 429 }));
  assert.equal(await sendMail(data, environment), false);
  fetched.mock.mockImplementation(async () => Response.json({}));
  assert.equal(await sendMail(data, environment), false);
  fetched.mock.mockImplementation(async () => { throw new Error('PRIVATE NETWORK'); });
  assert.equal(await sendMail(data, environment), false);
  assert.deepEqual(logs.mock.calls.map(c => c.arguments[0].issue), ['send_rejected', 'send_response_invalid', 'send_timeout_or_network']);
  assert.doesNotMatch(JSON.stringify(logs.mock.calls.map(c => c.arguments)), /PRIVATE/);
  assert.equal(environment.__values.get('incident').issue, 'send_timeout_or_network');
});

const statusRequest = () => new Request('https://monitor.example/delivery-status');
const adminRequest = (path, body) => new Request('https://monitor.example/admin/' + path, {
  method: body ? 'POST' : 'GET', headers: { Authorization: 'Bearer test-only-admin-key', 'Content-Type': 'application/json' },
  ...(body ? { body: JSON.stringify(body) } : {}),
});

test('failure is latched across restarts, exposes no details, and needs authenticated acknowledgement', async t => {
  t.mock.method(console, 'error', () => {});
  const e = env();
  assert.equal((await monitor.fetch(statusRequest(), e)).status, 200);
  await monitor.fetch(request(), e);
  e.__restart();
  const failed = await monitor.fetch(statusRequest(), e);
  assert.equal(failed.status, 503); assert.equal(await failed.text(), '');
  assert.equal(failed.headers.get('Cache-Control'), 'no-store');
  assert.equal((await monitor.fetch(new Request('https://monitor.example/admin/status'), e)).status, 401);
  assert.equal((await monitor.fetch(new Request('https://monitor.example/admin/acknowledge', { method: 'POST' }), e)).status, 401);
  const { incident } = await (await monitor.fetch(adminRequest('status'), e)).json();
  assert.equal(incident.issue, 'email.failed');
  assert.doesNotMatch(JSON.stringify([...e.__values]), /PRIVATE|tim@|msg_test/);
  assert.equal((await monitor.fetch(adminRequest('acknowledge', { revision: incident.revision }), e)).status, 204);
  assert.equal((await monitor.fetch(statusRequest(), e)).status, 200);
  // A provider retry cannot re-open an acknowledged incident.
  await monitor.fetch(request(), e);
  assert.equal((await monitor.fetch(statusRequest(), e)).status, 200);
});

test('a stale acknowledgement cannot clear a newer failure; successes cannot clear failures', async t => {
  t.mock.method(console, 'error', () => {});
  const e = env(); await monitor.fetch(request(), e);
  const revision = e.__values.get('incident').revision;
  await monitor.fetch(request(event('email.bounced'), { id: 'msg_new' }), e);
  assert.equal((await monitor.fetch(adminRequest('acknowledge', { revision }), e)).status, 409);
  await monitor.fetch(request(event('email.delivered'), { id: 'msg_delivered' }), e);
  assert.equal((await monitor.fetch(statusRequest(), e)).status, 503);
});

test('persistent status fails closed on missing configuration or unavailable storage', async t => {
  t.mock.method(console, 'error', () => {});
  for (const property of ['MONITOR_ADMIN_KEY', 'RESEND_WEBHOOK_SECRET', 'DELIVERY_STATUS']) {
    assert.equal((await monitor.fetch(statusRequest(), { ...env(), [property]: undefined })).status, 503);
  }
  const broken = { ...env(), DELIVERY_STATUS: { idFromName: x => x, get: () => { throw new Error('PRIVATE'); } } };
  assert.equal((await monitor.fetch(statusRequest(), broken)).status, 503);
  assert.equal((await monitor.fetch(new Request('https://monitor.example/delivery-status', { method: 'POST' }), env())).status, 405);
});

test('failed storage does not consume event dedupe; retry records it', async t => {
  t.mock.method(console, 'error', () => {});
  const e = env(), binding = e.DELIVERY_STATUS;
  e.DELIVERY_STATUS = { idFromName: x => x, get: () => ({ fetch: async () => new Response(null, { status: 503 }) }) };
  assert.equal((await monitor.fetch(request(), e)).status, 503);
  e.DELIVERY_STATUS = binding;
  assert.equal((await monitor.fetch(request(), e)).status, 204);
  assert.equal((await monitor.fetch(statusRequest(), e)).status, 503);
});

test('cleanup removes expired hashes without clearing the incident and paginates', async t => {
  t.mock.method(console, 'error', () => {});
  const e = env(); await monitor.fetch(request(), e);
  for (let n = 0; n < 501; n++) e.__values.set('seen/' + n.toString(16).padStart(64, '0'), Date.now() - 1);
  await e.__alarm(); await e.__alarm();
  assert.equal([...e.__values.keys()].filter(k => k.startsWith('seen/')).length, 1);
  assert.equal((await monitor.fetch(statusRequest(), e)).status, 503);
});

test('malformed status fails closed without exposing upstream redirects', async t => {
  t.mock.method(console, 'error', () => {});
  const e = { ...env(), DELIVERY_STATUS: { idFromName: x => x, get: () => ({
    fetch: async () => Response.redirect('https://example.invalid/'),
  }) } };
  const response = await monitor.fetch(adminRequest('status'), e);
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
});

test('a transient status-read exception is durably latched after recovery and restart', async t => {
  t.mock.method(console, 'error', () => {});
  const e = env(), original = e.DELIVERY_STATUS.get;
  let fail = true;
  e.DELIVERY_STATUS.get = id => ({ fetch: async (url, options) => {
    if (fail && new URL(url).pathname === '/status') { fail = false; throw Error('PRIVATE'); }
    return original(id).fetch(url, options);
  } });
  assert.equal((await monitor.fetch(statusRequest(), e)).status, 503);
  e.__restart();
  assert.equal((await monitor.fetch(statusRequest(), e)).status, 503);
  assert.equal(e.__monitor().get('incident').issue, 'monitor_runtime_error');
  const revision = e.__monitor().get('incident').revision;
  assert.equal((await monitor.fetch(adminRequest('acknowledge', { revision }), e)).status, 204);
  assert.equal((await monitor.fetch(statusRequest(), e)).status, 200);
});

test('primary write outage persists on separate fallback and survives recovered primary and restart', async t => {
  t.mock.method(console, 'error', () => {});
  const e = env(), original = e.DELIVERY_STATUS.get;
  let writes = 0;
  e.DELIVERY_STATUS.get = id => ({ fetch: async (url, options) => {
    if (id.name === 'carrie/contact-delivery' && new URL(url).pathname === '/record') {
      writes++; return new Response(null, { status: 503 });
    }
    return original(id).fetch(url, options);
  } });
  await persistMailIssue({ ...e, ENVIRONMENT: 'production' }, 'send_rejected');
  assert.equal(writes, 3);
  assert.equal(e.__values.get('incident'), undefined);
  assert.equal(e.__fallback.get('incident').issue, 'send_rejected');
  e.DELIVERY_STATUS.get = original; e.__restart();
  assert.equal((await monitor.fetch(statusRequest(), e)).status, 503);
  const revision = e.__fallback.get('incident').revision;
  assert.equal((await monitor.fetch(adminRequest('acknowledge', { revision }), e)).status, 204);
  assert.equal((await monitor.fetch(statusRequest(), e)).status, 200);
});

test('lost write response retries with the same key and does not create a second incident', async t => {
  t.mock.method(console, 'error', () => {});
  const e = env(), original = e.DELIVERY_STATUS.get;
  let firstRevision, writes = 0;
  e.DELIVERY_STATUS.get = id => ({ fetch: async (url, options) => {
    const result = await original(id).fetch(url, options);
    if (new URL(url).pathname === '/record' && ++writes === 1) {
      firstRevision = e.__values.get('incident').revision;
      throw Error('lost response');
    }
    return result;
  } });
  await persistMailIssue({ ...e, ENVIRONMENT: 'production' }, 'send_rejected');
  assert.equal(writes, 2);
  assert.equal(e.__values.get('incident').revision, firstRevision);
  assert.equal(e.__fallback.get('incident'), undefined);
});

test('two-store acknowledgement never clears the other or a newer incident', async t => {
  t.mock.method(console, 'error', () => {});
  const e = env();
  const test = await monitor.fetch(adminRequest('test', { scenario: 'primary-write-unavailable', site: 'carrie' }), e);
  assert.equal(test.status, 204);
  const fallbackRevision = e.__fallback.get('incident').revision;
  await monitor.fetch(request(), e);
  const summary = await (await monitor.fetch(adminRequest('status'), e)).json();
  assert.equal(summary.incidents.length, 2);
  assert.equal((await monitor.fetch(adminRequest('acknowledge', { revision: fallbackRevision }), e)).status, 204);
  assert.equal((await monitor.fetch(statusRequest(), e)).status, 503);
  assert.equal(e.__values.get('incident').issue, 'email.failed');
});

test('diagnostic test requires existing admin credentials, exact POST scenario, and healthy baseline', async t => {
  t.mock.method(console, 'error', () => {});
  const e = env();
  assert.equal((await monitor.fetch(new Request('https://monitor.example/admin/test', { method: 'POST' }), e)).status, 401);
  assert.equal((await monitor.fetch(adminRequest('test'), e)).status, 405);
  assert.equal((await monitor.fetch(adminRequest('test', { scenario: 'arbitrary' }), e)).status, 400);
  assert.equal((await monitor.fetch(adminRequest('test', { scenario: 'primary-write-unavailable', site: 'carrie' }), e)).status, 204);
  assert.equal(e.__fallback.get('incident').issue, 'monitor_self_test');
  assert.equal((await monitor.fetch(adminRequest('test', { scenario: 'primary-write-unavailable', site: 'carrie' }), e)).status, 409);
  assert.equal((await monitor.fetch(statusRequest(), e)).status, 503);
});

for (const site of ['rgesol', 'carrie']) {
  test(site + ' signed events have strict environment and recipient matching', async t => {
    t.mock.method(console, 'error', () => {});
    for (const environment of ['production', 'staging']) {
      const e = env();
      const payload = {type:'email.failed', data:{tags:{application:site+'-contact',environment},to:[site==='rgesol'?'timgabaree@rgesol.com':environment==='staging'?'tim@timgabaree.com':'carrie@carriegabaree.com']}};
      assert.equal((await monitor.fetch(request(payload),e)).status,204);
      const summary=await(await monitor.fetch(adminRequest('status'),e)).json();
      assert.equal(summary.incident.site,site);
      assert.equal(summary.incident.environment,environment);
      assert.equal(summary.incidents.length,1);
    }
  });
}
test('independent site failures cannot overwrite or acknowledge each other',async t=>{
  t.mock.method(console,'error',()=>{});const e=env();
  await monitor.fetch(request(),e);
  await monitor.fetch(request({type:'email.bounced',data:{to:['timgabaree@rgesol.com'],tags:{application:'rgesol-contact',environment:'production'}}},{id:'msg_rge'}),e);
  const s=await(await monitor.fetch(adminRequest('status'),e)).json();
  assert.equal(s.incidents.length,2);
  await monitor.fetch(adminRequest('acknowledge',{revision:s.incidents.find(i=>i.site==='carrie').revision}),e);
  assert.equal((await monitor.fetch(statusRequest(),e)).status,503);
  const remaining=await(await monitor.fetch(adminRequest('status'),e)).json();
  assert.equal(remaining.incident.site,'rgesol');
});
