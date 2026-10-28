// No names, email addresses, message bodies, or raw IP addresses are stored here.
// Sessions and rate counters live in distinct Durable Objects and expire by alarm.
export class ContactState {
  private ctx: DurableObjectState;

  constructor(ctx: DurableObjectState) {
    this.ctx = ctx;
  }

  async fetch(request: Request): Promise<Response> {
    const operation = new URL(request.url).pathname;
    const input = await request.json<{ token?: string; limit?: number; window?: number }>();
    const now = Date.now();
    const result = await this.ctx.storage.transaction(async (storage) => {
      if (operation === '/rate') {
        const window = input.window ?? 600_000;
        const attempts = (await storage.get<number[]>('attempts') ?? [])
          .filter((time) => time > now - window);
        if (attempts.length >= (input.limit ?? 5)) return { allowed: false };
        attempts.push(now);
        await storage.put('attempts', attempts);
        await storage.setAlarm(now + window);
        return { allowed: true };
      }

      if (operation === '/token') {
        const current = await storage.get<{ token: string; expires: number }>('csrf');
        // Reuse an unconsumed token so opening another tab does not break the first.
        if (current && current.expires > now) return { csrf_token: current.token };
        const token = randomToken();
        await storage.put('csrf', { token, expires: now + 3_600_000 });
        await storage.setAlarm(now + 3_600_000);
        return { csrf_token: token };
      }

      if (operation === '/consume') {
        const current = await storage.get<{ token: string; expires: number }>('csrf');
        if (!current || current.expires <= now || current.token !== input.token) {
          return { allowed: false, status: 'security-error' };
        }
        const last = await storage.get<number>('lastSubmission') ?? 0;
        if (now - last < 15_000) return { allowed: false, status: 'rate-limited' };
        await storage.delete('csrf');
        await storage.put('lastSubmission', now);
        return { allowed: true };
      }

      if (operation === '/delivered') {
        await storage.put('conversion', now + 3_600_000);
        await storage.setAlarm(now + 3_600_000);
        return { ok: true };
      }

      if (operation === '/conversion') {
        const expires = await storage.get<number>('conversion') ?? 0;
        await storage.delete('conversion');
        return { converted: expires > now };
      }

      return { error: 'Unknown operation' };
    });
    return Response.json(result);
  }

  async alarm(): Promise<void> {
    await this.ctx.storage.deleteAll();
  }
}

export function randomToken(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)),
    (byte) => byte.toString(16).padStart(2, '0')).join('');
}
