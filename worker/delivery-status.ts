import { mailIssues } from './monitoring-core.ts';

const retention = 7 * 24 * 60 * 60 * 1000;
type Incident = { revision: string; environment: string; issue: string; detectedAt: string };
type History = Incident & { resolvedAt: string; resolution: string };
const category = (issue: string) => issue === 'monitor_runtime_error' ? 'runtime' : issue === 'monitor_self_test' ? 'test' : 'delivery';

export class DeliveryStatus {
  private state: DurableObjectState;
  constructor(state: DurableObjectState) { this.state = state; }

  private async active(storage: DurableObjectStorage | DurableObjectTransaction): Promise<Incident[]> {
    const active = await storage.get<Incident[]>('open-incidents');
    if (active) return active;
    const legacy = await storage.get<Incident>('incident');
    return legacy ? [legacy] : [];
  }
  private async save(storage: DurableObjectStorage | DurableObjectTransaction, active: Incident[]) {
    await storage.put('open-incidents', active);
    // Keep the legacy summary readable by old code during rollout/rollback.
    if (active.length) await storage.put('incident', active.at(-1)!);
    else await storage.delete('incident');
  }
  private async archive(storage: DurableObjectStorage | DurableObjectTransaction, items: Incident[], resolution: string) {
    if (!items.length) return;
    const history = await storage.get<History[]>('history') ?? [];
    history.push(...items.map(item => ({ ...item, resolvedAt: new Date().toISOString(), resolution })));
    await storage.put('history', history.slice(-100));
  }

  async fetch(request: Request): Promise<Response> {
    const operation = new URL(request.url).pathname;
    if (operation === '/status' && request.method === 'GET') {
      return this.state.storage.transaction(async storage => {
        const incidents = await this.active(storage);
        return Response.json({ incident: incidents.at(-1) ?? null, incidents });
      });
    }
    if (operation === '/history' && request.method === 'GET') {
      return Response.json({ history: await this.state.storage.get<History[]>('history') ?? [] });
    }
    if (request.method !== 'POST') return new Response(null, { status: 405 });
    const data = await request.json<Record<string, unknown>>();
    if (operation === '/probe') {
      const nonce = crypto.randomUUID();
      await this.state.storage.put('recovery-probe', nonce);
      if (await this.state.storage.get('recovery-probe') !== nonce) throw Error('Probe failed');
      return new Response(null, { status: 204 });
    }
    if (operation === '/record') {
      if (typeof data.key !== 'string' || !/^[a-f0-9]{64}$/.test(data.key) ||
          !['staging', 'production'].includes(String(data.environment)) ||
          !mailIssues.has(String(data.issue))) return new Response(null, { status: 400 });
      const key = 'seen/' + data.key;
      const fresh = await this.state.storage.transaction(async storage => {
        const now = Date.now();
        if ((await storage.get<number>(key) ?? 0) > now) return false;
        await storage.put(key, now + retention);
        const active = await this.active(storage);
        const same = (i: Incident) => i.environment === data.environment && category(i.issue) === category(String(data.issue));
        await this.archive(storage, active.filter(same), 'superseded');
        const incident = { revision: crypto.randomUUID(), environment: String(data.environment),
          issue: String(data.issue), detectedAt: new Date(now).toISOString() };
        await this.save(storage, [...active.filter(i => !same(i)), incident]);
        await storage.delete('recovery-streak');
        if (await storage.getAlarm() === null) await storage.setAlarm(now + retention);
        return true;
      });
      return Response.json({ fresh });
    }
    if (operation === '/acknowledge') {
      if (typeof data.revision !== 'string') return new Response(null, { status: 400 });
      const cleared = await this.state.storage.transaction(async storage => {
        const active = await this.active(storage);
        const found = active.filter(i => i.revision === data.revision);
        if (!found.length) return false;
        await this.archive(storage, found, 'manual');
        await this.save(storage, active.filter(i => i.revision !== data.revision));
        return true;
      });
      return new Response(null, { status: cleared ? 204 : 409 });
    }
    if (operation === '/delivered') {
      if (!['production', 'staging'].includes(String(data.environment)) ||
          typeof data.occurredAt !== 'number' || !Number.isFinite(data.occurredAt) ||
          data.occurredAt <= 0 || data.occurredAt > Date.now()) return new Response(null, { status: 400 });
      const occurredAt = data.occurredAt;
      const cleared = await this.state.storage.transaction(async storage => {
        const active = await this.active(storage);
        const matches = (i: Incident) => i.environment === data.environment && category(i.issue) === 'delivery' &&
          occurredAt > Date.parse(i.detectedAt);
        const found = active.filter(matches);
        await this.archive(storage, found, 'verified_delivery');
        await this.save(storage, active.filter(i => !matches(i)));
        return found.length;
      });
      return Response.json({ cleared });
    }
    if (operation === '/recover-runtime') {
      if (typeof data.revision !== 'string') return new Response(null, { status: 400 });
      const cleared = await this.state.storage.transaction(async storage => {
        const active = await this.active(storage);
        const incident = active.find(i => i.revision === data.revision && i.issue === 'monitor_runtime_error');
        if (!incident) return false;
        const now = Date.now();
        let streak = await storage.get<{ revision: string; last: number; first: number; count: number }>('recovery-streak');
        if (!streak || streak.revision !== incident.revision || now - streak.last > 150_000) {
          streak = { revision: incident.revision, last: now, first: now, count: 1 };
        } else if (now - streak.last >= 45_000) {
          streak = { ...streak, last: now, count: streak.count + 1 };
        }
        await storage.put('recovery-streak', streak);
        if (streak.count < 3 || now - streak.first < 120_000 || now - Date.parse(incident.detectedAt) < 180_000) return false;
        await this.archive(storage, [incident], 'healthy_storage_checks');
        await this.save(storage, active.filter(i => i.revision !== incident.revision));
        await storage.delete('recovery-streak');
        return true;
      });
      return Response.json({ cleared });
    }
    return new Response(null, { status: 404 });
  }

  async alarm(): Promise<void> {
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
        await storage.setAlarm(Date.now() + 3_600_000);
      }
    });
  }
}
