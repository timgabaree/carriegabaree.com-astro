import { Webhook } from 'svix';
import { reportMailIssue, persistMailIssue, recordIssue, readDeliveryIncidents, deliveryStatusNames, scopedStatus } from './monitoring-core.ts';
import type { MailIssue } from './monitoring-core.ts';
export { DeliveryStatus } from './delivery-status.ts';

interface MonitorEnv {
  RESEND_WEBHOOK_SECRET?: string;
  DELIVERY_STATUS: DurableObjectNamespace;
  MONITOR_ADMIN_KEY?: string;
}

const sites = ['rgesol', 'carrie', 'monitor'] as const;
async function allStatuses(env: MonitorEnv) {
  return (await Promise.all(sites.map(async site => (await readDeliveryIncidents(scopedStatus(env.DELIVERY_STATUS, site)))
    .map(s => ({ ...s, name: site + '/' + s.name, incident: s.incident ? { ...s.incident, site } : null }))))).flat();
}
const failures = new Set(['email.failed', 'email.bounced', 'email.delivery_delayed', 'email.suppressed', 'email.complained']);
const maximumBody = 65_536;

async function boundedBody(request: Request): Promise<string> {
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > maximumBody) { await reader.cancel(); throw new Error('size'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes);
}

export class MonitorEvent {
  constructor(privateState: DurableObjectState) { this.state = privateState; }
  private state: DurableObjectState;

  async fetch(): Promise<Response> {
    const fresh = await this.state.storage.transaction(async (storage) => {
      if (await storage.get('seen')) return false;
      await storage.put('seen', true);
      await storage.setAlarm(Date.now() + 7 * 24 * 60 * 60 * 1000);
      return true;
    });
    return Response.json({ fresh });
  }

  async alarm(): Promise<void> { await this.state.storage.deleteAll(); }
}

async function handle(request: Request, env: MonitorEnv): Promise<Response> {
  const url = new URL(request.url);
  if (url.search || !['/health', '/resend', '/delivery-status', '/admin/status', '/admin/acknowledge', '/admin/test'].includes(url.pathname)) return new Response(null, { status: 404 });
  if (!env.RESEND_WEBHOOK_SECRET || !env.DELIVERY_STATUS || !env.MONITOR_ADMIN_KEY) return new Response(null, { status: 503 });
  if (url.pathname === '/delivery-status') {
    if (!['GET', 'HEAD'].includes(request.method)) return new Response(null, { status: 405 });
    const statuses = await allStatuses(env);
    return new Response(null, { status: statuses.some(s => s.incident) ? 503 : 200 });
  }
  if (url.pathname.startsWith('/admin/')) {
    // No secrets in URLs. Constant-time digest comparison; no CORS or browser UI.
    const digest = (text: string) => crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    const [actual, expected] = await Promise.all([
      digest(request.headers.get('Authorization') ?? ''), digest(`Bearer ${env.MONITOR_ADMIN_KEY}`),
    ]);
    let difference = 0;
    const a = new Uint8Array(actual), b = new Uint8Array(expected);
    for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i];
    if (difference) return new Response(null, { status: 401 });
    if (url.pathname === '/admin/status') {
      if (request.method !== 'GET') return new Response(null, { status: 405 });
      const incidents = (await allStatuses(env)).flatMap(s => s.incident ? [s.incident] : []);
      return Response.json({ incident: incidents[0] ?? null, incidents });
    }
    if (request.method !== 'POST') return new Response(null, { status: 405 });
    if (!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json')) return new Response(null, { status: 415 });
    let data: any;
    try { data = JSON.parse(await boundedBody(request)); } catch { return new Response(null, { status: 400 }); }
    if (url.pathname === '/admin/test') {
      // Existing administrator authorization only. No public fault switch, secret
      // changes, email submission, or shared/global fault state. The fixed test
      // exercises the actual retry/fallback writer, and is identifiable for review.
      if (data?.scenario !== 'primary-write-unavailable' || !['rgesol', 'carrie'].includes(data?.site)) return new Response(null, { status: 400 });
      if ((await allStatuses(env)).some(s => s.incident)) return new Response(null, { status: 409 });
      const namespace = scopedStatus(env.DELIVERY_STATUS, data.site);
      const testNamespace = {
        idFromName: (name: string) => namespace.idFromName(name),
        get: (id: DurableObjectId) => id.equals(namespace.idFromName(deliveryStatusNames[0]))
          ? { fetch: async () => new Response(null, { status: 503 }) }
          : namespace.get(id),
      } as DurableObjectNamespace;
      await persistMailIssue({ ENVIRONMENT: 'staging', DELIVERY_STATUS: testNamespace }, 'monitor_self_test');
      return new Response(null, { status: 204 });
    }
    if (typeof data?.revision !== 'string' || !/^[a-f0-9-]{36}$/.test(data.revision)) return new Response(null, { status: 400 });
    const found = (await allStatuses(env)).find(s => s.incident?.revision === data.revision);
    if (!found) return new Response(null, { status: 409 });
    return env.DELIVERY_STATUS.get(env.DELIVERY_STATUS.idFromName(found.name)).fetch('https://status.internal/acknowledge', {
      method: 'POST', body: JSON.stringify({ revision: data.revision }),
    });
  }
  if (url.pathname === '/health') {
    return new Response(null, { status: ['GET', 'HEAD'].includes(request.method) ? 200 : 405 });
  }
  if (request.method !== 'POST') return new Response(null, { status: 405 });
  if (!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json')) return new Response(null, { status: 415 });
  if (Number(request.headers.get('Content-Length')) > maximumBody) return new Response(null, { status: 413 });
  let body: string;
  try { body = await boundedBody(request); } catch { return new Response(null, { status: 413 }); }
  let event: any;
  const id = request.headers.get('svix-id') ?? '';
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(id)) return new Response(null, { status: 400 });
  try {
    // Svix verifies the exact raw body, HMAC, and timestamp (including future/stale requests).
    new Webhook(env.RESEND_WEBHOOK_SECRET).verify(body, {
      'svix-id': id,
      'svix-timestamp': request.headers.get('svix-timestamp') ?? '',
      'svix-signature': request.headers.get('svix-signature') ?? '',
    });
    event = JSON.parse(body);
  } catch { return new Response(null, { status: 400 }); }
  const environment = event?.data?.tags?.environment;
  const application = event?.data?.tags?.application;
  const site = application === 'rgesol-contact' ? 'rgesol' : application === 'carrie-contact' ? 'carrie' : null;
  const recipient = site === 'rgesol' ? 'timgabaree@rgesol.com' : environment === 'staging' ? 'tim@timgabaree.com' : 'carrie@carriegabaree.com';
  if (!failures.has(event?.type) || !site ||
      !['production', 'staging'].includes(environment) ||
      !Array.isArray(event?.data?.to) || event.data.to.length !== 1 ||
      typeof event.data.to[0] !== 'string' || event.data.to[0].toLowerCase() !== recipient) return new Response(null, { status: 204 });
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(id));
  const key = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  const { fresh } = await recordIssue(scopedStatus(env.DELIVERY_STATUS, site), deliveryStatusNames[0], { key, environment, issue: event.type });
  if (fresh) reportMailIssue(environment, event.type as MailIssue);
  return new Response(null, { status: 204 });
}

export default {
  async fetch(request: Request, env: MonitorEnv): Promise<Response> {
    let response: Response;
    try { response = await handle(request, env); }
    catch {
      // A short-lived error remains visible to the next external poll even after
      // recovery. If the primary object is unavailable, persist on the fallback.
      try { await persistMailIssue({ ENVIRONMENT: 'production', DELIVERY_STATUS: scopedStatus(env.DELIVERY_STATUS, 'monitor') }, 'monitor_runtime_error'); }
      catch { /* Both stores unavailable: preserve the error response and log. */ }
      response = new Response(null, { status: 503 });
    }
    // Responses returned from another Worker/DO have immutable headers in workerd.
    response = new Response(response.body, response);
    response.headers.set('Cache-Control', 'no-store');
    response.headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
    response.headers.set('X-Content-Type-Options', 'nosniff');
    return response;
  },
};
