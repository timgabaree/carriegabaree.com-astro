import { test } from 'node:test';

test('scheduled handler automatically resolves runtime failure after sustained checks', async t => {
  t.mock.method(console, 'error', () => {});
  let now = Date.now(); t.mock.method(Date, 'now', () => now);
  const e = env(), get = e.DELIVERY_STATUS.get;
  e.DELIVERY_STATUS.get = id => ({ fetch: async (url, opts) => {
    if (new URL(url).pathname === '/probe') throw Error('simulated storage failure');
    return get(id).fetch(url, opts);
  } });
  await assert.rejects(monitor.scheduled({}, e));
  e.DELIVERY_STATUS.get = get;
  for (let i = 0; i < 3; i++) { now += 60000; await monitor.scheduled({}, e); }
  assert.equal((await (await monitor.fetch(adminRequest('status'), e)).json()).incidents.length, 0);
  assert.ok((await (await monitor.fetch(adminRequest('history'), e)).json()).stores.some(s =>
    s.history.some(i => i.resolution === 'healthy_storage_checks')));
});

test('RGE delivery recovers only RGE while Carrie remains down', async t => {
  t.mock.method(console, 'error', () => {});
  let now = Date.now(); t.mock.method(Date, 'now', () => now);
  const e = env(), rge = event();
  rge.data.tags.application = 'rgesol-contact'; rge.data.to = ['timgabaree@rgesol.com'];
  await monitor.fetch(request(), e);
  await monitor.fetch(request(rge, { id: 'msg_rge_failure' }), e);
  now += 1000;
  rge.type = 'email.delivered'; rge.created_at = new Date(now).toISOString();
  assert.equal((await monitor.fetch(request(rge, { id: 'msg_rge_delivered' }), e)).status, 204);
  assert.equal((await monitor.fetch(new Request('https://monitor.example/delivery-status/rgesol'), e)).status, 200);
  assert.equal((await monitor.fetch(new Request('https://monitor.example/delivery-status/carrie'), e)).status, 503);
});

test('new signed delivery clears only its environment; history survives restart and duplicate delivery', async t => {
  t.mock.method(console, 'error', () => {});
  let now = Date.now(); t.mock.method(Date, 'now', () => now);
  const e = env();
  await monitor.fetch(request(), e);
  const staging = event(); staging.data.tags.environment = 'staging'; staging.data.to = ['tim@timgabaree.com'];
  await monitor.fetch(request(staging, { id: 'msg_staging' }), e);
  assert.equal((await (await monitor.fetch(adminRequest('status'), e)).json()).incidents.length, 2);
  now += 1000;
  const delivered = { ...event('email.delivered'), created_at: new Date(now).toISOString() };
  assert.equal((await monitor.fetch(request(delivered, { id: 'msg_delivery' }), e)).status, 204);
  const remaining = (await (await monitor.fetch(adminRequest('status'), e)).json()).incidents;
  assert.equal(remaining.length, 1); assert.equal(remaining[0].environment, 'staging');
  e.__restart();
  const history = await (await monitor.fetch(adminRequest('history'), e)).json();
  assert.ok(history.stores.some(s => s.history.some(i => i.resolution === 'verified_delivery')));
  assert.doesNotMatch(JSON.stringify(history), /PRIVATE|@/);
  now += 1000;
  await monitor.fetch(request(event(), { id: 'msg_new_failure' }), e);
  await monitor.fetch(request(delivered, { id: 'msg_delivery_retry' }), e);
  assert.equal((await (await monitor.fetch(adminRequest('status'), e)).json()).incidents.length, 2);
});

test('stale, missing, future, unsigned and wrong-recipient delivery cannot clear an incident', async t => {
  t.mock.method(console, 'error', () => {});
  const e = env(); await monitor.fetch(request(), e);
  const dates = [undefined, 'invalid', new Date(Date.now() - 10000).toISOString(), new Date(Date.now() + 60000).toISOString()];
  for (const created_at of dates) {
    await monitor.fetch(request({ ...event('email.delivered'), created_at }), e);
    assert.equal((await monitor.fetch(statusRequest(), e)).status, 503);
  }
  const good = { ...event('email.delivered'), created_at: new Date().toISOString() };
  assert.equal((await monitor.fetch(request(good, { signature: '' }), e)).status, 400);
  good.data.to = ['other@example.invalid'];
  await monitor.fetch(request(good), e);
  assert.equal((await monitor.fetch(statusRequest(), e)).status, 503);
});

test('runtime recovery requires spaced healthy checks, preserves delivery incidents and rejects stale revision', async t => {
  let now = Date.now(); t.mock.method(Date, 'now', () => now);
  const f = fixture();
  const call = (path, body) => f.fetch('https://status.internal' + path, body ? { method: 'POST', body: JSON.stringify(body) } : {});
  const record = (issue, environment = 'production') => call('/record', { key: crypto.randomUUID().replaceAll('-', '').repeat(2), environment, issue });
  await record('monitor_runtime_error'); const revision = f.values.get('incident').revision;
  await record('send_rejected');
  const recover = () => call('/recover-runtime', { revision });
  await recover(); await recover(); await recover();
  assert.equal((await (await call('/status')).json()).incidents.length, 2);
  now += 60000; await recover(); f.restart();
  now += 60000; await recover();
  assert.equal((await (await call('/status')).json()).incidents.length, 2); // minimum incident age
  now += 60000; await recover();
  const left = (await (await call('/status')).json()).incidents;
  assert.equal(left.length, 1); assert.equal(left[0].issue, 'send_rejected');
  assert.ok(f.values.get('history').some(i => i.resolution === 'healthy_storage_checks'));
  await record('monitor_runtime_error'); await recover();
  assert.equal((await (await call('/status')).json()).incidents.length, 2);
});

test('legacy incident migrates; long check gaps reset recovery and manual test never auto-clears', async t => {
  let now = Date.now(); t.mock.method(Date, 'now', () => now);
  const f = fixture(), revision = crypto.randomUUID();
  f.values.set('incident', { revision, environment: 'production', issue: 'monitor_runtime_error', detectedAt: new Date(now - 300000).toISOString() });
  const recover = () => f.fetch('https://status.internal/recover-runtime', { method: 'POST', body: JSON.stringify({ revision }) });
  await recover(); now += 60000; await recover(); now += 180000; await recover();
  assert.ok(f.values.get('incident'));
  now += 60000; await recover(); now += 60000; await recover(); assert.equal(f.values.get('incident'), undefined);
  await f.fetch('https://status.internal/record', { method: 'POST', body: JSON.stringify({ key: 'b'.repeat(64), environment: 'staging', issue: 'monitor_self_test' }) });
  await f.fetch('https://status.internal/delivered', { method: 'POST', body: JSON.stringify({ environment: 'staging', occurredAt: now }) });
  assert.equal(f.values.get('incident').issue, 'monitor_self_test');
});

test('scheduled recovery fails closed on any failed storage probe and cannot be invoked over public HTTP', async t => {
  t.mock.method(console, 'error', () => {});
  const e = env(), get = e.DELIVERY_STATUS.get;
  e.DELIVERY_STATUS.get = id => ({ fetch: async (url, opts) => {
    if (new URL(url).pathname === '/probe') throw Error('PRIVATE');
    return get(id).fetch(url, opts);
  } });
  await assert.rejects(monitor.scheduled({}, e));
  const status = await (await monitor.fetch(adminRequest('status'), e)).json();
  assert.ok(status.incidents.some(i => i.issue === 'monitor_runtime_error'));
  for (const path of ['/probe', '/recover-runtime', '/delivered']) {
    assert.equal((await monitor.fetch(new Request('https://monitor.example' + path, { method: 'POST', body: '{}' }), e)).status, 404);
  }
  e.DELIVERY_STATUS.get = get;
  await monitor.scheduled({}, e);
  assert.ok((await (await monitor.fetch(adminRequest('status'), e)).json()).incidents.length);
});
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

test('stale acknowledgements and deliveries without event timestamps cannot clear failures', async t => {
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

test('a transient status-read exception retries without creating a false persistent incident', async t => {
  t.mock.method(console, 'error', () => {});
  const e = env(), original = e.DELIVERY_STATUS.get;
  let fail = true;
  e.DELIVERY_STATUS.get = id => ({ fetch: async (url, options) => {
    if (fail && new URL(url).pathname === '/status') { fail = false; throw Error('PRIVATE'); }
    return original(id).fetch(url, options);
  } });
  assert.equal((await monitor.fetch(statusRequest(), e)).status, 200);
  e.__restart();
  assert.equal(e.__monitor().get('incident'), undefined);
  assert.equal((await monitor.fetch(statusRequest(), e)).status, 200);
});

test('exhausted read retries remain latched as an infrastructure incident after recovery', async t => {
  t.mock.method(console, 'error', () => {});
  const e = env(), original = e.DELIVERY_STATUS.get;
  let reads = 0;
  e.DELIVERY_STATUS.get = id => ({ fetch: async (url, options) => {
    if (id.name === 'carrie/contact-delivery' && new URL(url).pathname === '/status' && ++reads <= 3) throw Error('PRIVATE');
    return original(id).fetch(url, options);
  } });
  assert.equal((await monitor.fetch(statusRequest(), e)).status, 503);
  assert.equal(reads, 3);
  e.DELIVERY_STATUS.get = original; e.__restart();
  assert.equal(e.__monitor().get('incident').issue, 'monitor_runtime_error');
  const probe = path => monitor.fetch(new Request('https://monitor.example' + path), e);
  assert.equal((await probe('/monitor-status')).status, 503);
  assert.equal((await probe('/delivery-status/carrie')).status, 200);
  assert.equal((await probe('/delivery-status/rgesol')).status, 200);
  assert.equal((await monitor.fetch(adminRequest('acknowledge', { revision: e.__monitor().get('incident').revision }), e)).status, 204);
  assert.equal((await probe('/monitor-status')).status, 200);
});

test('site probes isolate primary/fallback incidents; infrastructure health does not duplicate delivery alerts', async t => {
  t.mock.method(console, 'error', () => {});
  const e = env();
  const probe = (path, method = 'GET') => monitor.fetch(new Request('https://monitor.example' + path, { method }), e);
  await monitor.fetch(adminRequest('test', { scenario: 'primary-write-unavailable', site: 'carrie' }), e);
  for (const method of ['GET', 'HEAD']) {
    const response = await probe('/delivery-status/carrie', method);
    assert.equal(response.status, 503); assert.equal(await response.text(), '');
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.equal((await probe('/delivery-status/rgesol', method)).status, 200);
    assert.equal((await probe('/monitor-status', method)).status, 200);
  }
  for (const path of ['/delivery-status/carrie', '/delivery-status/rgesol', '/monitor-status']) {
    assert.equal((await probe(path, 'POST')).status, 405);
    assert.equal((await probe(path + '?site=private')).status, 404);
    assert.equal((await monitor.fetch(new Request('https://monitor.example' + path), { ...e, MONITOR_ADMIN_KEY: undefined })).status, 503);
  }
  assert.equal((await probe('/delivery-status/other')).status, 404);
  await monitor.fetch(request({type:'email.bounced',data:{to:['timgabaree@rgesol.com'],tags:{application:'rgesol-contact',environment:'production'}}},{id:'msg_rge_scoped'}),e);
  assert.equal((await probe('/delivery-status/rgesol')).status, 503);
  assert.equal((await probe('/monitor-status')).status, 200);
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
