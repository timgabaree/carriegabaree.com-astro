import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const analytics = await readFile(new URL('../public/js/analytics.js', import.meta.url), 'utf8');
const key = 'rge-analytics-choice-v1';
const saved = choice => JSON.stringify({ choice, expires: Date.now() + 86400000 });

function element() {
  return {
    hidden: true, handlers: {}, children: [], dataset: {}, textContent: '',
    addEventListener(name, fn) { this.handlers[name] = fn; },
    focus() { this.focused = true; },
    setAttribute(name, value) { this[name] = value; },
    replaceChildren(...children) { this.children = children; },
    click(event = {}) { this.handlers.click?.(event); },
  };
}
function analyticsHarness({ stored, dismissed = false, hostname = 'carriegabaree.com', enabled = 'true', blocked = false, cookies = '' } = {}) {
  const nodes = Object.fromEntries(['panel', 'status', 'open', 'reject', 'accept', 'close', 'settings'].map(name => [`[data-analytics-${name}]`, element()]));
  nodes['[data-analytics-panel]'].dataset.analyticsEnabled = enabled;
  const storage = new Map(stored === undefined ? [] : [[key, stored]]);
  const session = new Map(dismissed ? [['rge-analytics-dismissed-v1', '1']] : []);
  const sessionStorage = {
    getItem: k => session.get(k) ?? null,
    setItem(k, v) { if (blocked) throw Error('restricted'); session.set(k, v); },
  };
  const scripts = [], deletedCookies = [];
  const main = element();
  let reloads = 0;
  const document = {
    querySelector: selector => nodes[selector], getElementById: () => main,
    createElement: () => element(), head: { appendChild: node => scripts.push(node) },
    get cookie() { return cookies; }, set cookie(value) { deletedCookies.push(value); },
  };
  const localStorage = {
    getItem: k => storage.get(k) ?? null,
    setItem(k, v) { if (blocked) throw Error('restricted'); storage.set(k, v); },
    removeItem(k) { if (blocked) throw Error('restricted'); storage.delete(k); },
  };
  const window = { location: { hostname, reload() { reloads++; } }, handlers: {},
    addEventListener(name, fn) { this.handlers[name] = fn; } };
  vm.runInNewContext(analytics, { window, document, localStorage, sessionStorage });
  return { nodes, storage, session, scripts, deletedCookies, window, main, get reloads() { return reloads; },
    click: name => nodes[`[data-analytics-${name}]`].click() };
}

test('first visit shows a non-modal notice without taking focus or loading Google; decline persists', () => {
  const h = analyticsHarness();
  assert.equal(h.nodes['[data-analytics-panel]'].hidden, false);
  assert.equal(h.nodes['[data-analytics-settings]'].hidden, false);
  assert.equal(h.main.focused, undefined);
  assert.equal(h.nodes['[data-analytics-reject]'].focused, undefined);
  h.window.siteAnalytics.track({ event: 'pre_consent' });
  assert.equal(h.window.dataLayer, undefined);
  h.click('open');
  assert.equal(h.nodes['[data-analytics-panel]'].hidden, false);
  assert.equal(h.nodes['[data-analytics-open]']['aria-expanded'], 'true');
  h.click('reject');
  assert.equal(h.scripts.length, 0);
  assert.equal(JSON.parse(h.storage.get(key)).choice, 'declined');
  assert.equal(h.nodes['[data-analytics-panel]'].hidden, true);
  assert.equal(h.nodes['[data-analytics-open]'].focused, true);
  assert.equal(h.nodes['[data-analytics-open]']['aria-expanded'], 'false');
});

test('explicit consent loads once with analytics granted and advertising denied; no historical events', () => {
  const h = analyticsHarness();
  h.window.siteAnalytics.track({ event: 'old_event' });
  h.click('accept'); h.click('accept');
  assert.equal(h.scripts.length, 1);
  assert.match(h.scripts[0].src, /gtag\/js\?id=G-39QGYP8FPR$/);
  assert.equal(h.window.dataLayer[0][2].ad_storage, 'denied');
  assert.equal(h.window.dataLayer[0][2].ad_user_data, 'denied');
  assert.equal(h.window.dataLayer[1][2].analytics_storage, 'granted');
  assert.equal(h.window.dataLayer.some(value => value.event === 'old_event'), false);
  h.window.siteAnalytics.track({ event: 'new_event' });
  assert.equal(h.window.dataLayer.at(-1)[1], 'new_event');
});

test('saved accept and decline persist; expired, malformed and future-dated choices fail closed', () => {
  assert.equal(analyticsHarness({ stored: saved('accepted') }).scripts.length, 1);
  assert.equal(analyticsHarness({ stored: saved('declined') }).scripts.length, 0);
  for (const choice of ['accepted', 'declined']) {
    assert.equal(analyticsHarness({ stored: saved(choice) }).nodes['[data-analytics-panel]'].hidden, true);
  }
  for (const stored of ['bad JSON', 'null', saved('unknown'),
    JSON.stringify({ choice: 'accepted', expires: Date.now() - 1 }),
    JSON.stringify({ choice: 'accepted', expires: Date.now() + 999 * 86400000 })]) {
    const h = analyticsHarness({ stored });
    assert.equal(h.scripts.length, 0);
    assert.equal(h.nodes['[data-analytics-panel]'].hidden, false);
  }
});

test('withdrawal removes measurement cookies only, disables measurement and reloads to unload tags', () => {
  const h = analyticsHarness({ stored: saved('accepted'), cookies: '_ga=1; _ga_ABC=2; _gid=3; contact_session=keep' });
  h.click('open');
  assert.equal(h.nodes['[data-analytics-reject]'].focused, true);
  h.click('reject');
  assert.equal(h.reloads, 1);
  assert.equal(h.window['ga-disable-G-39QGYP8FPR'], true);
  assert.equal(JSON.parse(h.storage.get(key)).choice, 'declined');
  assert.equal(h.deletedCookies.length, 9);
  assert.equal(h.deletedCookies.some(value => value.includes('contact_session')), false);
  const count = h.window.dataLayer.length;
  h.window.siteAnalytics.track({ event: 'after_withdrawal' });
  assert.equal(h.window.dataLayer.length, count);
});

test('decline then accept enables measurement and settings restore focus', () => {
  const h = analyticsHarness();
  h.click('reject'); h.click('open'); h.click('accept');
  assert.equal(h.window['ga-disable-G-39QGYP8FPR'], false);
  assert.equal(h.nodes['[data-analytics-open]'].focused, true);
  assert.equal(h.scripts.length, 1);
});

test('storage unavailable fails closed even with a previously accepted choice', () => {
  const h = analyticsHarness({ blocked: true, stored: saved('accepted') });
  assert.equal(h.nodes['[data-analytics-panel]'].hidden, false);
  h.click('open');
  h.click('accept');
  assert.equal(h.scripts.length, 0);
  assert.match(h.nodes['[data-analytics-status]'].textContent, /cannot save/);
  h.click('reject');
  assert.equal(h.scripts.length, 0);
});

test('dismissal is not consent and suppresses the notice for this tab session only', () => {
  const h = analyticsHarness();
  h.click('close');
  assert.equal(h.nodes['[data-analytics-panel]'].hidden, true);
  assert.equal(h.storage.has(key), false);
  assert.equal(h.session.get('rge-analytics-dismissed-v1'), '1');
  assert.equal(h.scripts.length, 0);
  assert.equal(h.main.focused, true);
  const next = analyticsHarness({ dismissed: true });
  assert.equal(next.nodes['[data-analytics-panel]'].hidden, true);
  assert.equal(next.scripts.length, 0);
  next.click('open');
  assert.equal(next.nodes['[data-analytics-panel]'].hidden, false);
  assert.equal(analyticsHarness().nodes['[data-analytics-panel]'].hidden, false);
});

test('Close and Escape dismiss footer settings without requiring or changing consent', () => {
  for (const stored of [undefined, saved('accepted'), saved('declined')]) {
    const h = analyticsHarness({ stored });
    for (const method of ['close', 'escape']) {
      h.click('open');
      assert.equal(h.nodes['[data-analytics-panel]'].hidden, false);
      if (method === 'close') h.click('close');
      else h.nodes['[data-analytics-panel]'].handlers.keydown({ key: 'Escape', preventDefault() {} });
      assert.equal(h.nodes['[data-analytics-panel]'].hidden, true);
      assert.equal(h.nodes['[data-analytics-open]'].focused, true);
      assert.equal(h.storage.get(key), stored);
    }
  }
});

test('cross-tab preference removal never opens an unsolicited prompt', () => {
  const h = analyticsHarness({ stored: saved('declined') });
  h.storage.clear();
  h.window.handlers.storage({ key: null });
  assert.equal(h.nodes['[data-analytics-panel]'].hidden, true);
  assert.equal(h.scripts.length, 0);
});

test('local, staging and lookalike hosts never load Google even after acceptance', () => {
  for (const hostname of ['127.0.0.1', 'localhost', 'staging.workers.dev', 'carriegabaree.com.attacker.invalid']) {
    const h = analyticsHarness({ hostname }); h.click('accept');
    h.window.siteAnalytics.track({ event: 'test' });
    assert.equal(h.scripts.length, 0);
    assert.equal(h.window.dataLayer, undefined);
  }
});

test('withdrawal or preference deletion in another tab stops already loaded tags', () => {
  for (const cleared of [false, true]) {
    const h = analyticsHarness({ stored: saved('accepted') });
    if (cleared) h.storage.clear(); else h.storage.set(key, saved('declined'));
    h.window.handlers.storage({ key: cleared ? null : key });
    assert.equal(h.reloads, 1);
  }
});

test('preview build permits testing choices but cannot load Google even on the production hostname', () => {
  for (const enabled of ['false', undefined]) {
    const h = analyticsHarness({ enabled: enabled ?? '' });
    h.click('accept');
    assert.equal(JSON.parse(h.storage.get(key)).choice, 'accepted');
    assert.equal(h.scripts.length, 0);
    assert.equal(h.window.dataLayer, undefined);
    h.click('open'); h.click('reject');
    assert.equal(JSON.parse(h.storage.get(key)).choice, 'declined');
  }
});
