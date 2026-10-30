// Deliberately accept only fixed operational codes, never request data or exceptions.
export type MailIssue = 'send_configuration' | 'send_rejected' | 'send_response_invalid' |
  'send_timeout_or_network' | 'contact_runtime_error' | 'email.failed' | 'email.bounced' |
  'email.delivery_delayed' | 'email.suppressed' | 'email.complained' | 'monitor_runtime_error' | 'monitor_self_test';

export const mailIssues = new Set<string>(['send_configuration', 'send_rejected', 'send_response_invalid',
  'send_timeout_or_network', 'contact_runtime_error', 'email.failed', 'email.bounced',
  'email.delivery_delayed', 'email.suppressed', 'email.complained', 'monitor_runtime_error', 'monitor_self_test']);

// Separate object identities: a transient primary-object failure must not be the
// only place where evidence of that failure is stored. Both are checked publicly.
export const deliveryStatusNames = ['contact-delivery', 'contact-delivery-fallback'] as const;

export async function recordIssue(namespace: DurableObjectNamespace, name: string,
  data: { key: string; environment: string; issue: MailIssue }): Promise<{ fresh: boolean }> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      // Obtain a fresh stub on retry; reuse the key if a write committed but its
      // response was lost. A bounded timeout prevents a stuck incident write.
      const response = await namespace.get(namespace.idFromName(name)).fetch('https://status.internal/record', {
        method: 'POST', body: JSON.stringify(data), signal: AbortSignal.timeout(3000),
      });
      if (!response.ok) throw new Error('Status write failed');
      const result = await response.json<{ fresh: boolean }>();
      if (typeof result.fresh !== 'boolean') throw new Error('Invalid status write response');
      return result;
    } catch { /* Retry only sanitized, idempotent operational data. */ }
  }
  throw new Error('Failure monitoring unavailable');
}

export type Incident = { revision: string; issue: string; environment: string; detectedAt: string };
export async function readDeliveryIncidents(namespace: DurableObjectNamespace) {
  const groups = await Promise.all(deliveryStatusNames.map(async name => {
    const result = await statusOperation(namespace, name, '/status') as { incident: Incident | null; incidents?: Incident[] };
    if (!Object.hasOwn(result, 'incident') || (result.incident !== null &&
        (typeof result.incident !== 'object' || typeof result.incident.revision !== 'string')) ||
        (result.incidents !== undefined && (!Array.isArray(result.incidents) ||
          result.incidents.some(i => !i || typeof i.revision !== 'string')))) throw Error('Invalid status response');
    const incidents = result.incidents ?? (result.incident ? [result.incident] : []);
    return incidents.length ? incidents.map(incident => ({ name, incident: incident as Incident | null })) : [{ name, incident: null as Incident | null }];
  }));
  return groups.flat();
}

// Internal binding only. Never expose recovery controls as public HTTP routes.
export async function statusOperation(namespace: DurableObjectNamespace, name: string, path: string, body?: unknown): Promise<unknown> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await namespace.get(namespace.idFromName(name)).fetch('https://status.internal' + path, {
        method: body === undefined ? 'GET' : 'POST',
        ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(3000),
      });
      if (!response.ok) throw Error('Status operation failed');
      return response.status === 204 ? null : await response.json();
    } catch { /* Retry sanitized, idempotent binding operations with a fresh stub. */ }
  }
  throw Error('Status operation unavailable');
}

export async function recoverDelivery(namespace: DurableObjectNamespace, environment: string, occurredAt: number) {
  for (const name of deliveryStatusNames) await statusOperation(namespace, name, '/delivered', { environment, occurredAt });
}

// All stores must pass both reads and writes before any runtime recovery advances.
export async function checkMonitorRecovery(namespace: DurableObjectNamespace, names: readonly string[], statuses: { name: string; incident: Incident | null }[]) {
  for (const name of names) await statusOperation(namespace, name, '/probe', {});
  for (const { name, incident } of statuses) {
    if (incident?.issue === 'monitor_runtime_error') await statusOperation(namespace, name, '/recover-runtime', { revision: incident.revision });
  }
}

export function reportMailIssue(environment: string, issue: MailIssue): void {
  if (environment !== 'production' && environment !== 'staging') return;
  console.error({ message: 'FLEET_CONTACT_ALERT', environment, issue });
}

export async function persistMailIssue(env: {
  ENVIRONMENT: string; DELIVERY_STATUS?: DurableObjectNamespace;
}, issue: MailIssue): Promise<void> {
  reportMailIssue(env.ENVIRONMENT, issue);
  if (!['staging', 'production'].includes(env.ENVIRONMENT)) return;
  if (!env.DELIVERY_STATUS) throw new Error('Failure monitoring is not configured');
  const key = crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '');
  const data = { key, environment: env.ENVIRONMENT, issue };
  try { await recordIssue(env.DELIVERY_STATUS, deliveryStatusNames[0], data); }
  catch { await recordIssue(env.DELIVERY_STATUS, deliveryStatusNames[1], data); }
}

// Fixed site prefixes isolate incidents without storing message or recipient data.
export function scopedStatus(namespace: DurableObjectNamespace, site: string): DurableObjectNamespace {
  return { idFromName: (name: string) => namespace.idFromName(site + '/' + name),
    get: (id: DurableObjectId) => namespace.get(id) } as DurableObjectNamespace;
}
