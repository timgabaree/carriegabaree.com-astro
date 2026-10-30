// Explicit, idempotent UptimeRobot configuration for the five approved sites.
// Credentials stay in macOS Keychain. Never reset/delete monitors or their history.
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const mode = process.argv[2] ?? 'inspect';
const alertContactId = 8977973;
const alertEmail = 'tim@timgabaree.com';
assert.ok(['inspect', 'sync', 'retire', 'verify'].includes(mode));
const key = execFileSync('/usr/bin/security', ['find-generic-password', '-s', 'uptimerobot-fleet-monitoring', '-a', 'main', '-w'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
export async function api(path, method = 'GET', body) {
  const response = await fetch('https://api.uptimerobot.com/v3' + path, {
    method, headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30_000),
  });
  const data = await response.json();
  if (!response.ok) throw Error(`${method} ${path}: HTTP ${response.status} ${JSON.stringify(data).replaceAll(key, '[REDACTED]')}`);
  return data;
}
const domains = [
  ['timgabaree.com', 804450928, 'Tim Gabaree | CIO &amp; Technology Executive'],
  ['rgesol.com', 804464221, 'RGE Solutions | Really Good Engineering Solutions'],
  ['carriegabaree.com', 804464246, 'Carrie Gabaree | Museum Curator and Public Historian'],
  ['finngabaree.com', 804464232, 'Finn Gabaree | Creativity | Technology | Learning | Adventure'],
  ['clintgabaree.com', 804464241, 'Clint Gabaree | Technology | Chess | Soccer | Creativity'],
];
const fleetBase = 'https://family-sites-email-monitor.timgabaree-com-astro.workers.dev';
const timBase = 'https://timgabaree-com-astro-email-monitor.timgabaree-com-astro.workers.dev';
const definitions = [];
function add(group, label, url, options = {}) {
  definitions.push({ group, id: options.id, body: {
    friendlyName: `${group} | ${label}`, type: 'HTTP', url, interval: 60, timeout: 30,
    httpMethodType: 'GET', authType: 'NONE', followRedirections: false,
    successHttpResponseCodes: ['200'], checkSSLErrors: true,
    sslExpirationReminder: false, domainExpirationReminder: false,
    config: { applicationErrorRetries: 2 },
    assignedAlertContacts: [{ alertContactId, threshold: 0, recurrence: 60 }],
    tagNames: ['production', label.startsWith('Email') || group === 'Shared services' ? 'email' : 'website'],
    customFields: { purpose: options.purpose ?? label, runbook: 'carriegabaree.com-astro/MONITORING.md' },
    ...Object.fromEntries(Object.entries(options).filter(([k]) => !['id', 'purpose'].includes(k))),
  } });
}
for (const [domain, id, title] of domains) {
  add(domain, 'Website content + TLS', `https://${domain}/`, {
    id, type: 'KEYWORD', keywordType: 'ALERT_NOT_EXISTS', keywordCaseType: 'CaseSensitive', keywordValue: `<title>${title}</title>`,
    sslExpirationReminder: true, domainExpirationReminder: true,
    config: { applicationErrorRetries: 2, sslExpirationPeriodDays: [30, 14, 7, 0] },
    purpose: 'Homepage 200 with expected title; TLS validity; certificate/domain expiry. Check DNS, Worker and deployment if down.',
  });
  add(domain, 'WWW redirect + TLS', `https://www.${domain}/`, {
    type: 'API', interval: 300, successHttpResponseCodes: ['308'], sslExpirationReminder: true,
    config: { applicationErrorRetries: 2, sslExpirationPeriodDays: [30, 14, 7, 0], apiAssertions: { logic: 'AND', checks: [
      { property: 'status_code', comparison: 'equals', target: 308 },
      { property: 'headers.location', comparison: 'equals', target: `https://${domain}/` },
    ] } },
    purpose: 'WWW must redirect to the exact HTTPS apex, not an arbitrary redirect. Includes WWW TLS expiry.',
  });
}
for (const domain of domains.slice(0, 3).map(d => d[0])) {
  add(domain, 'Contact page', `https://${domain}/contact`, {
    ...(domain === 'timgabaree.com' ? { id: 804450934 } : {}),
    type: 'KEYWORD', interval: 300, keywordType: 'ALERT_NOT_EXISTS', keywordCaseType: 'CaseSensitive', keywordValue: 'name="csrf_token"',
    purpose: 'Contact page and form markup are available. A green result does not prove email sending or inbox delivery.',
  });
  add(domain, 'Contact form readiness', `https://${domain}/contact-token`, {
    type: 'API', interval: 300,
    config: { applicationErrorRetries: 2, apiAssertions: { logic: 'AND', checks: [
      { property: '$.csrf_token', comparison: 'is_string' },
      { property: '$.csrf_token', comparison: 'not_equals', target: '' },
      { property: '$.test_mode', comparison: 'equals', target: false },
    ] } },
    purpose: 'GET-only CSRF/session readiness and production mode. Never submits the form or sends email. Check Worker/session storage if down.',
  });
}
add('timgabaree.com', 'Email delivery failures', timBase + '/delivery-status', { id: 804451162,
  purpose: 'Latched Tim send/provider failures; also fails closed if status storage is unreadable. Investigate before exact-revision acknowledgement.' });
add('timgabaree.com', 'Email receiver health', timBase + '/health', { id: 804451011, sslExpirationReminder: true,
  config: { applicationErrorRetries: 2, sslExpirationPeriodDays: [30, 14, 7, 0] },
  purpose: 'Tim webhook receiver reachability/configuration. Different from the delivery-failure latch.' });
add('timgabaree.com', 'PDF download', 'https://timgabaree.com/armypubs/cmhPub_70-128.pdf', { id: 804450935, interval: 900, httpMethodType: 'HEAD',
  purpose: 'Representative preserved PDF is reachable. HEAD avoids repeatedly downloading the large file; not a full archive integrity check.' });
add('carriegabaree.com', 'Publication PDF download', 'https://carriegabaree.com/portfolio/armypubs/cmhPub_70-128.pdf', { interval: 900, httpMethodType: 'HEAD',
  purpose: 'Representative publication download is reachable. HEAD avoids downloading the large PDF repeatedly; not a full archive integrity check.' });
add('rgesol.com', 'Email delivery failures', fleetBase + '/delivery-status/rgesol', {
  purpose: 'RGE-only primary/fallback send and provider incidents. No Carrie incident mixing. Investigate then acknowledge exact revision.' });
add('carriegabaree.com', 'Email delivery failures', fleetBase + '/delivery-status/carrie', {
  purpose: 'Carrie-only primary/fallback send and provider incidents. Cannot detect mail accepted then quarantined downstream.' });
add('Shared services', 'RGE + Carrie email monitor health', fleetBase + '/monitor-status', { id: 804464267,
  sslExpirationReminder: true, config: { applicationErrorRetries: 2, sslExpirationPeriodDays: [30, 14, 7, 0] },
  purpose: 'Shared receiver configuration, all status stores readable, and unresolved infrastructure incidents. Site delivery incidents alert separately.' });
assert.equal(definitions.length, 23);

async function list() {
  let path = '/monitors', items = [];
  do {
    const page = await api(path); items.push(...page.data);
    path = page.nextLink ? new URL(page.nextLink, 'https://api.uptimerobot.com/v3/').pathname.replace(/^\/v3/, '') + new URL(page.nextLink, 'https://api.uptimerobot.com/v3/').search : null;
  } while (path);
  return items;
}
const existing = await list();
const contactPage = await api('/alert-contacts?limit=200');
assert.ok(!contactPage.nextLink, 'Paginate alert contacts before continuing');
const contacts = contactPage.data;
const email = contacts.find(c => c.id === alertContactId);
assert.equal(email?.value, alertEmail); assert.equal(email?.status, 'Active');
assert.equal(email?.enableNotificationsFor, 'UpAndDown');
const fields = ['id', 'friendlyName', 'type', 'url', 'interval', 'timeout', 'httpMethodType', 'successHttpResponseCodes', 'followRedirections', 'keywordType', 'keywordCaseType', 'keywordValue', 'checkSSLErrors', 'sslExpirationReminder', 'domainExpirationReminder', 'config', 'assignedAlertContacts', 'groupId', 'tags', 'customFields', 'status', 'lastIncidentId'];
const safe = m => Object.fromEntries(fields.map(k => [k, m[k]]));
if (mode === 'inspect') {
  console.log(JSON.stringify({ email: { id: email.id, address: email.value, certificateAlerts: email.sslExpirationReminder }, monitors: existing.map(safe) }, null, 2));
} else if (mode === 'sync') {
  await mkdir('.local/monitoring', { recursive: true });
  // Time-stamped snapshots are output evidence, not credentials or repository data.
  await writeFile(`.local/monitoring/before-${Date.now()}.json`, JSON.stringify(existing.map(safe), null, 2), { mode: 0o600, flag: 'wx' });
  if (!email.sslExpirationReminder) await api('/alert-contacts/' + email.id, 'PATCH', { sslExpirationReminder: true });
  const groups = (await api('/monitor-groups')).data;
  for (const group of new Set(definitions.map(d => d.group))) {
    assert.equal(groups.filter(g => g.name === group).length, 1, `Expected exactly one established group: ${group}; inspect before creating groups`);
  }
  for (const definition of definitions) {
    const { body } = definition;
    body.groupId = groups.find(g => g.name === definition.group).id;
    const historical = definition.id ? existing.find(m => m.id === definition.id) : undefined;
    if (definition.id) assert.ok(historical, `Missing expected monitor ${definition.id}; do not duplicate`);
    const old = existing.find(m => m.friendlyName === body.friendlyName && m.type === body.type)
      ?? (historical?.type === body.type ? historical : undefined);
    // Preserve previously assigned SMS/voice channels on Tim's homepage only.
    if (definition.id === 804450928) body.assignedAlertContacts.push(...historical.assignedAlertContacts.filter(c => contacts.some(contact => contact.id === c.alertContactId && ['ProSms', 'Voice'].includes(contact.type))));
    if (old && body.type === 'KEYWORD') body.keywordCaseType = 1;
    const result = await api(old ? '/monitors/' + old.id : '/monitors', old ? 'PATCH' : 'POST', body);
    console.log(JSON.stringify({ operation: old ? 'updated' : 'created', id: result.id, name: result.friendlyName, status: result.status }));
    if (!old) existing.push(result);
  }
} else if (mode === 'retire') {
  const groups = (await api('/monitor-groups')).data;
  let archive = groups.find(g => g.name === 'Retired - history only');
  for (const definition of definitions.filter(d => d.id)) {
    const old = existing.find(m => m.id === definition.id);
    if (old.type === definition.body.type) continue;
    const replacement = existing.find(m => m.friendlyName === definition.body.friendlyName && m.type === definition.body.type);
    assert.equal(replacement?.status, 'UP', 'Replacement must be UP before retiring ' + old.id);
    if (!archive) archive = await api('/monitor-groups', 'POST', { name: 'Retired - history only' });
    await api('/monitors/' + old.id, 'PATCH', { friendlyName: 'RETIRED | ' + definition.body.friendlyName + ' | old basic check', groupId: archive.id });
    await api('/monitors/' + old.id + '/pause', 'POST');
    console.log('Paused superseded check ' + old.id + '; history retained; replacement ' + replacement.id + ' UP.');
  }
} else {
  let checks = 0;
  const liveGroups = (await api('/monitor-groups')).data;
  assert.equal(liveGroups.length, 7, 'Expected five sites, shared service, and historical group');
  assert.equal(new Set(liveGroups.map(g => g.name)).size, 7, 'Duplicate group names');
  for (const definition of definitions) {
    const m = existing.find(m => m.friendlyName === definition.body.friendlyName);
    assert.ok(m, definition.body.friendlyName + ' missing');
    for (const field of ['url', 'type', 'interval', 'httpMethodType', 'followRedirections', 'checkSSLErrors', 'sslExpirationReminder', 'domainExpirationReminder']) {
      assert.deepEqual(m[field], definition.body[field], m.friendlyName + ' ' + field); checks++;
    }
    for (const field of ['successHttpResponseCodes', 'config']) {
      assert.deepEqual(m[field], definition.body[field], m.friendlyName + ' ' + field); checks++;
    }
    assert.equal(liveGroups.find(g => g.id === m.groupId)?.name, definition.group);
    assert.ok(m.assignedAlertContacts.some(c => c.alertContactId === email.id && c.threshold === 0 && c.recurrence === 60)); checks += 2;
    if (m.type === 'KEYWORD') {
      assert.equal(m.keywordValue, definition.body.keywordValue);
      assert.equal(m.keywordType, definition.body.keywordType); checks += 2;
    }
    console.log(JSON.stringify({ id: m.id, name: m.friendlyName, status: m.status, lastIncidentId: m.lastIncidentId }));
  }
  assert.equal(email.sslExpirationReminder, true);
  for (const m of existing) {
    const emailAssignments = m.assignedAlertContacts.filter(c => contacts.some(contact => contact.id === c.alertContactId && contact.type === 'Email'));
    assert.deepEqual(emailAssignments.map(c => c.alertContactId), [email.id], m.friendlyName + ' must send email only to ' + alertEmail); checks++;
  }
  const active = existing.filter(m => m.status !== 'PAUSED');
  assert.equal(new Set(active.map(m => m.url)).size, active.length, 'Duplicate active endpoint checks');
  assert.equal(active.length, 23, 'Unexpected active monitor');
  assert.equal(existing.filter(m => m.status === 'PAUSED').length, 6, 'Expected six retained historical checks');
  await mkdir('.local/monitoring', { recursive: true });
  await writeFile('.local/monitoring/verified.json', JSON.stringify(existing.map(safe), null, 2), { mode: 0o600 });
  console.log(`${checks + 6} monitoring configuration checks passed; 23 active, 6 historical, ${existing.length}/50 slots. State is reported separately above.`);
}
