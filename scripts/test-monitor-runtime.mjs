import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { Webhook } from 'svix';

// Local workerd/Durable Object test only; no remote bindings, notifications or mail.
const temp = await mkdtemp(join(tmpdir(), 'family-monitor-runtime-'));
const base = 'http://127.0.0.1:8796';
const secret = 'whsec_' + Buffer.from('synthetic-test-only-key-32-bytes!!').toString('base64');
let child, output = '', checks = 0;
const check = (actual, expected) => { assert.equal(actual, expected); checks++; };
const request = (path, init) => fetch(base + path, { ...init, signal: AbortSignal.timeout(30_000) });
const admin = (path, body) => request('/admin/' + path, {
  method: body ? 'POST' : 'GET', headers: { Authorization: 'Bearer local-test-only', 'Content-Type': 'application/json' },
  ...(body ? { body: JSON.stringify(body) } : {}),
});
async function start() {
  output = '';
  child = spawn(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'dev',
    '--config', 'wrangler.monitoring.jsonc', '--local', '--ip', '127.0.0.1', '--port', '8796',
    '--var', `RESEND_WEBHOOK_SECRET:${secret}`, '--var', 'MONITOR_ADMIN_KEY:local-test-only', '--persist-to', temp],
  { stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', data => { output += data; });
  child.stderr.on('data', data => { output += data; });
  for (let i = 0; i < 120 && !output.includes(`Ready on ${base}`); i++) {
    if (child.exitCode !== null) throw Error(output);
    await delay(250);
  }
  assert.ok(output.includes(`Ready on ${base}`), output);
}
async function stop() {
  if (child?.exitCode === null) {
    child.kill('SIGINT');
    await Promise.race([new Promise(resolve => child.once('exit', resolve)), delay(5000)]);
    if (child.exitCode === null) throw Error('Local monitor did not stop; preserve test directory: ' + temp);
  }
}
function signed(type = 'email.failed', id = 'msg_local_runtime') {
  const body = JSON.stringify({ type, created_at: new Date().toISOString(), data: { to: ['tim@timgabaree.com'],
    tags: { application: 'carrie-contact', environment: 'staging' } } });
  const date = new Date();
  return request('/resend', { method: 'POST', body, headers: {
    'Content-Type': 'application/json', 'svix-id': id,
    'svix-timestamp': String(Math.floor(date.getTime() / 1000)), 'svix-signature': new Webhook(secret).sign(id, date, body),
  } });
}
try {
  await start();
  check((await request('/health')).status, 200);
  check((await request('/delivery-status')).status, 200);
  check((await request('/monitor-status')).status, 200);
  check((await request('/delivery-status/carrie')).status, 200);
  check((await request('/delivery-status/rgesol')).status, 200);
  check((await request('/admin/test', { method: 'POST' })).status, 401);
  check((await admin('test', { scenario: 'primary-write-unavailable', site: 'carrie' })).status, 204);
  const failed = await request('/delivery-status');
  check(failed.status, 503); check(await failed.text(), ''); check(failed.headers.get('Cache-Control'), 'no-store');
  check((await request('/health')).status, 200);
  check((await request('/delivery-status/carrie')).status, 503);
  check((await request('/delivery-status/rgesol')).status, 200);
  check((await request('/monitor-status')).status, 200);
  let summary = await (await admin('status')).json();
  check(summary.incidents.length, 1); check(summary.incident.issue, 'monitor_self_test');
  const fallbackRevision = summary.incident.revision;
  await stop(); await start();
  check((await request('/delivery-status')).status, 503);
  check((await request('/delivery-status/carrie', { method: 'HEAD' })).status, 503);
  check((await request('/monitor-status')).status, 200);
  check((await admin('test', { scenario: 'primary-write-unavailable', site: 'carrie' })).status, 409);
  check((await signed()).status, 204); check((await signed()).status, 204);
  summary = await (await admin('status')).json();
  check(summary.incidents.length, 2);
  const primaryRevision = summary.incidents.find(i => i.issue === 'email.failed').revision;
  check((await admin('acknowledge', { revision: crypto.randomUUID() })).status, 409);
  check((await admin('acknowledge', { revision: fallbackRevision })).status, 204);
  check((await request('/delivery-status')).status, 503);
  check((await admin('acknowledge', { revision: primaryRevision })).status, 204);
  check((await signed()).status, 204);
  check((await request('/delivery-status')).status, 200);
  check((await request('/delivery-status/carrie')).status, 200);
  check((await request('/delivery-status/rgesol')).status, 200);
  check((await request('/monitor-status')).status, 200);
  check((await (await admin('status')).json()).incidents.length, 0);
  check((await signed('email.failed', 'msg_auto_failure')).status, 204);
  check((await request('/delivery-status')).status, 503);
  check((await signed('email.delivered', 'msg_auto_recovery')).status, 204);
  check((await request('/delivery-status')).status, 200);
  const history = await (await admin('history')).json();
  check(history.stores.some(s => s.history.some(i => i.resolution === 'verified_delivery')), true);
  await stop(); await start();
  check((await request('/delivery-status')).status, 200);
  console.log(`${checks} local monitoring runtime checks passed, including restart and fallback recovery. No email sent.`);
} finally {
  await stop();
  await rm(temp, { recursive: true, force: true });
}
