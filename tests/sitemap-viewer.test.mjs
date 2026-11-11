import {test} from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/index.ts';

test('only successful XML sitemap responses permit native viewer inline styles', async () => {
 const host = 'carriegabaree.com';
 for (const [path, type, status, allowed] of [
  ['/sitemap.xml', 'application/xml', 200, true],
  ['/sitemap.xml', 'application/xml', 304, true],
  ['/sitemap.xml?view=1', 'application/xml; charset=utf-8', 200, true],
  ['/', 'text/html', 200, false],
  ['/other.xml', 'application/xml', 200, false],
  ['/sitemap.xml', 'text/html', 200, false],
  ['/sitemap.xml', 'application/xml', 404, false],
 ]) {
  const response = await worker.fetch(new Request('https://' + host + path), {
   ENVIRONMENT: 'production', PRODUCTION_ENABLED: 'true', SITE_HOST: host, CONTACT_MODE: 'resend', RESEND_API_KEY: 'synthetic-test-key', CONTACT_FROM: 'website@example.com', CONTACT_TO: 'editor@example.com',
   ASSETS: {fetch: async () => new Response(status === 304 ? null : '<urlset/>', {status, headers: {'Content-Type': type}})},
  });
  const policy = response.headers.get('Content-Security-Policy');
  assert.equal(policy.includes("style-src 'self' 'unsafe-inline'"), allowed, path + ' ' + type + ' ' + status);
  assert.doesNotMatch(policy, /script-src[^;]*'unsafe-inline'/);
  assert.match(policy, /object-src 'none'/);
 }
});
