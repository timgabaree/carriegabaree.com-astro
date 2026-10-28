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

export async function readDeliveryIncidents(namespace: DurableObjectNamespace) {
  return Promise.all(deliveryStatusNames.map(async name => {
    const response = await namespace.get(namespace.idFromName(name)).fetch('https://status.internal/status', {
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) throw new Error('Status unavailable');
    const result = await response.json<{ incident: { revision: string; issue: string; environment: string; detectedAt: string } | null }>();
    if (!Object.hasOwn(result, 'incident') || (result.incident !== null &&
        (typeof result.incident !== 'object' || typeof result.incident.revision !== 'string'))) {
      throw new Error('Invalid status response');
    }
    return { name, incident: result.incident };
  }));
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
