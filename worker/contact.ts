import { randomToken } from './state.ts';
import { persistMailIssue } from './monitoring.ts';
import contactTopics from '../src/data/contact-topics.json' with { type: 'json' };

export interface Env {
  ASSETS: Fetcher;
  DELIVERY_STATUS?: DurableObjectNamespace;
  CONTACT_STATE: DurableObjectNamespace;
  ENVIRONMENT: 'local' | 'staging' | 'production';
  CONTACT_MODE: 'dry-run' | 'resend';
  PRODUCTION_ENABLED?: string;
  STAGING_USER?: string;
  STAGING_PASSWORD?: string;
  RESEND_API_KEY?: string;
  CONTACT_FROM?: string;
  CONTACT_TO?: string;
}

export const TOPICS: Record<string, string> = contactTopics;

const MAX_BYTES = 51_200;
const limits: Record<string, number> = {
  name: 100, organization: 150, email: 254, phone: 40, topic: 80, message: 5_000,
  website: 200, csrf_token: 64,
};

export function validateForm(form: URLSearchParams): { status?: string; data: Record<string, string> } {
  const data: Record<string, string> = {};
  for (const [key, limit] of Object.entries(limits)) {
    const values = form.getAll(key);
    if (values.length > 1) return { status: 'invalid', data: {} };
    const value = (values[0] ?? '').trim();
    if ([...value].length > limit || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value) ||
        (key !== 'message' && /[\r\n]/.test(value))) {
      return { status: 'invalid', data: {} };
    }
    data[key] = value;
  }
  if (['name', 'email', 'topic', 'message'].some((key) => !data[key])) {
    return { status: 'missing', data };
  }
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(data.email)) {
    return { status: 'invalid-email', data };
  }
  if (!Object.hasOwn(TOPICS, data.topic)) return { status: 'invalid', data };
  return { data };
}

export function statusRedirect(status: string): Response {
  return new Response(null, { status: 303, headers: { Location: `/contact?status=${status}` } });
}

async function state<T>(env: Env, name: string, operation: string, body = {}): Promise<T> {
  const stub = env.CONTACT_STATE.get(env.CONTACT_STATE.idFromName(name));
  const response = await stub.fetch(`https://state.internal/${operation}`, {
    method: 'POST', body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error('Contact state unavailable');
  return response.json<T>();
}

async function ipKey(request: Request, env: Env): Promise<string> {
  // Cloudflare supplies this header; never trust client-provided X-Forwarded-For.
  const address = request.headers.get('CF-Connecting-IP');
  if (!address && env.ENVIRONMENT !== 'local') throw new Error('Client address unavailable');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(address ?? 'local'));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function cookieName(env: Env): string {
  return env.ENVIRONMENT === 'local' ? 'carrie-contact-local' : '__Host-carrie-contact';
}

function session(request: Request, env: Env): string | undefined {
  const values = (request.headers.get('Cookie') ?? '').split(';').map((value) => value.trim());
  const matches = values.filter((value) => value.startsWith(`${cookieName(env)}=`));
  if (matches.length !== 1) return;
  const value = matches[0].slice(cookieName(env).length + 1);
  return /^[a-f0-9]{64}$/.test(value) ? value : undefined;
}

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get('Origin');
  const site = request.headers.get('Sec-Fetch-Site');
  return origin === new URL(request.url).origin && (!site || site === 'same-origin');
}

async function readBody(request: Request): Promise<string> {
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BYTES) {
      await reader.cancel();
      throw new Error('Body too large');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes);
}

export async function sendMail(data: Record<string, string>, env: Env): Promise<boolean> {
  if (env.CONTACT_MODE !== 'resend' || !env.RESEND_API_KEY || !env.CONTACT_FROM || !env.CONTACT_TO) {
    await persistMailIssue(env, 'send_configuration');
    return false;
  }
  const text = [
    `Name: ${data.name}`, `Organization: ${data.organization || '(not provided)'}`,
    `Email: ${data.email}`, `Phone: ${data.phone || '(not provided)'}`,
    `Topic: ${TOPICS[data.topic]}`, '', data.message,
  ].join('\n');
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      signal: AbortSignal.timeout(10_000),
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': `contact-${data.csrf_token}`,
      },
      body: JSON.stringify({
        from: env.CONTACT_FROM, to: [env.CONTACT_TO], reply_to: data.email,
        subject: `${env.ENVIRONMENT === 'production' ? '' : '[STAGING] '}Website inquiry: ${TOPICS[data.topic]}`,
        tags: [{ name: 'application', value: 'carrie-contact' }, { name: 'environment', value: env.ENVIRONMENT }],
        text,
      }),
    });
    if (!response.ok) { await persistMailIssue(env, 'send_rejected'); return false; }
    const result = await response.json<{ id?: string }>();
    const accepted = typeof result.id === 'string' && result.id.length > 0;
    if (!accepted) await persistMailIssue(env, 'send_response_invalid');
    return accepted;
  } catch {
    // Never log submitted personal data, credentials, or provider response bodies.
    await persistMailIssue(env, 'send_timeout_or_network');
    return false;
  }
}

export async function handleContact(request: Request, env: Env, endpoint: string): Promise<Response> {
  const expectedMethod = endpoint === 'token' ? 'GET' : 'POST';
  if (request.method !== expectedMethod) {
    return new Response('Method not allowed', { status: 405, headers: { Allow: expectedMethod } });
  }
  if (endpoint !== 'token' && !sameOrigin(request)) return statusRedirect('invalid');
  if (endpoint === 'token' && (
    (request.headers.has('Origin') && request.headers.get('Origin') !== new URL(request.url).origin) ||
    ['cross-site', 'same-site'].includes(request.headers.get('Sec-Fetch-Site') ?? '')
  )) return new Response('Forbidden', { status: 403 });

  let id = session(request, env);
  if (endpoint === 'conversion') {
    if (!id) return Response.json({ converted: false });
    const result = await state<{ converted: boolean }>(env, `session:${id}`, 'conversion');
    return Response.json(result);
  }

  const key = await ipKey(request, env);
  if (endpoint === 'token') {
    const rate = await state<{ allowed: boolean }>(env, `token-rate:${key}`, 'rate', { limit: 30, window: 60_000 });
    if (!rate.allowed) return new Response('Please wait before trying again', { status: 429 });
    id ??= randomToken();
    const token = await state<{ csrf_token: string }>(env, `session:${id}`, 'token');
    const response = Response.json({ ...token, test_mode: env.CONTACT_MODE === 'dry-run' });
    response.headers.set('Set-Cookie', `${cookieName(env)}=${id}; Path=/; HttpOnly; SameSite=Strict; Max-Age=3600${env.ENVIRONMENT === 'local' ? '' : '; Secure'}`);
    return response;
  }

  const rate = await state<{ allowed: boolean }>(env, `submit-rate:${key}`, 'rate');
  if (!rate.allowed) return statusRedirect('rate-limited');
  if (!id) return statusRedirect('security-error');
  if (!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/x-www-form-urlencoded')) {
    return statusRedirect('invalid');
  }
  let form: URLSearchParams;
  try { form = new URLSearchParams(await readBody(request)); }
  catch { return statusRedirect('invalid'); }

  const { data, status } = validateForm(form);
  if (status) return statusRedirect(status);
  const consumed = await state<{ allowed: boolean; status?: string }>(env, `session:${id}`, 'consume', { token: data.csrf_token });
  if (!consumed.allowed) return statusRedirect(consumed.status ?? 'security-error');
  if (data.website) return new Response(null, { status: 303, headers: { Location: '/thank-you' } });

  if (env.CONTACT_MODE === 'dry-run' && env.ENVIRONMENT !== 'production') {
    return statusRedirect('test-success');
  }
  if (!await sendMail(data, env)) return statusRedirect('send-error');
  await state(env, `session:${id}`, 'delivered');
  return new Response(null, { status: 303, headers: { Location: '/thank-you' } });
}
