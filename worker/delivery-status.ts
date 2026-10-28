import { mailIssues } from './monitoring-core.ts';

const retention = 7 * 24 * 60 * 60 * 1000;
type Incident = { revision: string; environment: string; issue: string; detectedAt: string };

// Each account-private object commits dedupe and incident updates together.
// Its fetch handler is reachable through bindings only, never directly from the Internet.
export class DeliveryStatus {
  constructor(state: DurableObjectState) { this.state = state; }
  private state: DurableObjectState;

  async fetch(request: Request): Promise<Response> {
    const operation = new URL(request.url).pathname;
    if (operation === '/status' && request.method === 'GET') {
      return Response.json({ incident: await this.state.storage.get<Incident>('incident') ?? null });
    }
    if (request.method !== 'POST') return new Response(null, { status: 405 });
    const data = await request.json<Record<string, unknown>>();
    if (operation === '/record') {
      if (typeof data.key !== 'string' || !/^[a-f0-9]{64}$/.test(data.key) ||
          !['staging', 'production'].includes(String(data.environment)) ||
          !mailIssues.has(String(data.issue))) return new Response(null, { status: 400 });
      const key = `seen/${data.key}`;
      const fresh = await this.state.storage.transaction(async storage => {
        const now = Date.now();
        if ((await storage.get<number>(key) ?? 0) > now) return false;
        await storage.put(key, now + retention);
        await storage.put('incident', {
          revision: crypto.randomUUID(), environment: data.environment,
          issue: data.issue, detectedAt: new Date(now).toISOString(),
        });
        if (await storage.getAlarm() === null) await storage.setAlarm(now + retention);
        return true;
      });
      return Response.json({ fresh });
    }
    if (operation === '/acknowledge') {
      if (typeof data.revision !== 'string') return new Response(null, { status: 400 });
      const cleared = await this.state.storage.transaction(async storage => {
        const incident = await storage.get<Incident>('incident');
        // An acknowledgement cannot erase a newer, concurrent failure.
        if (!incident || incident.revision !== data.revision) return false;
        await storage.delete('incident');
        return true;
      });
      return new Response(null, { status: cleared ? 204 : 409 });
    }
    return new Response(null, { status: 404 });
  }

  async alarm(): Promise<void> {
    // Bounded cleanup batches. The incident itself never expires automatically.
    await this.state.storage.transaction(async storage => {
      const cursor = await storage.get<string>('cleanup-cursor');
      const entries = await storage.list<number>({ prefix: 'seen/', limit: 500, ...(cursor ? { startAfter: cursor } : {}) });
      const expired = [...entries].filter(([, expiry]) => expiry <= Date.now()).map(([key]) => key);
      if (expired.length) await storage.delete(expired);
      if (entries.size === 500) {
        await storage.put('cleanup-cursor', [...entries.keys()].at(-1)!);
        await storage.setAlarm(Date.now() + 1000);
      } else {
        await storage.delete('cleanup-cursor');
        // Hourly sweeps; dedupe expires logically after seven days.
        await storage.setAlarm(Date.now() + 3_600_000);
      }
    });
  }
}
