import { handleContact } from './contact.ts';
import type { Env } from './contact.ts';
import { persistMailIssue } from './monitoring.ts';
import legacyRedirects from '../src/data/legacy-redirects.json' with { type: 'json' };
export { ContactState } from './state.ts';

const pages = 'publications|oral-histories|contact|privacy|sitemap|thank-you';
const legacyPage = new RegExp(`^/(${pages})(?:/index)?\\.(?:php|html)$`, 'i');
const trailingPage = new RegExp(`^/(${pages})/$`, 'i');
const csp = "default-src 'self'; object-src 'none'; script-src 'self' https://www.googletagmanager.com https://static.cloudflareinsights.com; style-src 'self'; img-src 'self' data: https://customer-txz6xqq5qm2ofi03.cloudflarestream.com; font-src 'self'; connect-src 'self' https://www.googletagmanager.com https://*.googletagmanager.com https://www.google-analytics.com https://*.google-analytics.com https://*.analytics.google.com https://cloudflareinsights.com; frame-src https://customer-txz6xqq5qm2ofi03.cloudflarestream.com; base-uri 'self'; form-action 'self'; frame-ancestors 'self'";

async function equalSecret(a: string, b: string): Promise<boolean> {
  const encode = (value: string) => crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  const [left, right] = await Promise.all([encode(a), encode(b)]);
  let difference = 0;
  const l = new Uint8Array(left), r = new Uint8Array(right);
  for (let i = 0; i < l.length; i++) difference |= l[i] ^ r[i];
  return difference === 0;
}

async function authorize(request: Request, env: Env): Promise<Response | undefined> {
  const url = new URL(request.url);
  if (env.ENVIRONMENT === 'local' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return;
  if (env.ENVIRONMENT === 'production') {
    // Preparation is not launch. Missing configuration must never expose a partial site.
    if (env.PRODUCTION_ENABLED !== 'true' || env.CONTACT_MODE !== 'resend' ||
        !env.RESEND_API_KEY || !env.CONTACT_FROM || !env.CONTACT_TO) {
      return new Response('Site not yet enabled.', { status: 503 });
    }
    if (!['carriegabaree.com', 'www.carriegabaree.com'].includes(url.hostname)) {
      return new Response('Not found', { status: 404 });
    }
    if (url.origin !== 'https://carriegabaree.com') {
      // Preserve paths, queries and POST bodies. Never trust forwarded-host headers.
      url.protocol = 'https:';
      url.hostname = 'carriegabaree.com';
      url.port = '';
      return Response.redirect(url.href, 308);
    }
    return;
  }
  if (env.ENVIRONMENT !== 'staging' || !env.STAGING_USER || !env.STAGING_PASSWORD || env.STAGING_PASSWORD.length < 20) {
    return new Response('Staging is locked until access is configured.', { status: 503 });
  }
  if (url.protocol !== 'https:') {
    url.protocol = 'https:';
    return Response.redirect(url.href, 308);
  }
  // Authenticate before serving HTML, downloads, assets, or any form endpoints.
  const expected = `Basic ${btoa(`${env.STAGING_USER}:${env.STAGING_PASSWORD}`)}`;
  if (!await equalSecret(request.headers.get('Authorization') ?? '', expected)) {
    return new Response('Private staging site', {
      status: 401, headers: { 'WWW-Authenticate': 'Basic realm="Astro staging", charset="UTF-8"' },
    });
  }
}

function secure(response: Response, request: Request, env: Env): Response {
  const result = new Response(response.body, response);
  result.headers.set('X-Content-Type-Options', 'nosniff');
  result.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  result.headers.set('X-Frame-Options', 'SAMEORIGIN');
  result.headers.set('Permissions-Policy', 'camera=(), geolocation=(), microphone=()');
  result.headers.set('Content-Security-Policy', csp);
  if (new URL(request.url).protocol === 'https:') result.headers.set('Strict-Transport-Security', 'max-age=31536000');
  if (env.ENVIRONMENT !== 'production') {
    result.headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
    result.headers.set('Cache-Control', 'private, no-store');
    result.headers.append('Vary', 'Authorization');
  } else if (result.status >= 400 || /^\/thank-you(?:[/.]|$)/.test(new URL(request.url).pathname)) {
    result.headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
    result.headers.set('Cache-Control', 'no-store');
  } else if (/^\/contact-(?:token|submit|conversion)/.test(new URL(request.url).pathname)) {
    result.headers.set('Cache-Control', 'no-store');
  } else if (/text\/html|text\/css|javascript/.test(result.headers.get('Content-Type') ?? '')) {
    result.headers.set('Cache-Control', 'no-cache');
  }
  return result;
}

async function route(request: Request, env: Env): Promise<Response> {
  const blocked = await authorize(request, env);
  if (blocked) return blocked;
  const url = new URL(request.url);
  let path: string;
  try { path = decodeURIComponent(url.pathname); }
  catch { return new Response('Bad request', { status: 400 }); }
  if (/(^|\/)(?:\.|_notes(?:\/|$)|error_log$)/i.test(path) ||
      /^\/(?:includes|server-php|worker|src|scripts|node_modules|tmp|archive)(?:\/|$)/i.test(path)) {
    return new Response('Not found', { status: 404 });
  }

  const endpoint = /^\/contact-(token|submit|conversion)(?:\.php|\/)?$/.exec(path);
  if (endpoint) return handleContact(request, env, endpoint[1]);
  if (!['GET', 'HEAD'].includes(request.method)) {
    return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
  }
  const page = legacyPage.exec(path) ?? trailingPage.exec(path);
  const alias=(legacyRedirects as Record<string,string>)[path];
  if(alias)return new Response(null,{status:301,headers:{Location:alias+url.search}});
  if(path==='/sitemap.xsl')return new Response(null,{status:301,headers:{Location:'/sitemap'+url.search}});
  const resource = /^\/(portfolio\/(?:citations|oralhistories)\/[A-Za-z0-9-]+)(?:\.html|\/)$/.exec(path);
  if (resource) return new Response(null, {status:301,headers:{Location:'/'+resource[1]+url.search}});
  if (page || /^\/index\.(php|html)$/i.test(path)) {
    return new Response(null, { status: 301, headers: { Location: `${page ? `/${page[1].toLowerCase()}` : '/'}${url.search}` } });
  }
  if (/\.php(?:\/|$)/i.test(path)) return new Response('Not found', { status: 404 });
  if (env.ENVIRONMENT !== 'production' && path === '/robots.txt') {
    return new Response('User-agent: *\nDisallow: /\n', { headers: { 'Content-Type': 'text/plain' } });
  }
  return env.ASSETS.fetch(request);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try { return secure(await route(request, env), request, env); }
    catch {
      if (/^\/contact-(token|submit|conversion)(?:\.php|\/)?$/.test(new URL(request.url).pathname)) {
        try { await persistMailIssue(env, 'contact_runtime_error'); } catch { /* Return failure, never fake success. */ }
      }
      return secure(new Response('Temporarily unavailable. Please try again later.', { status: 503 }), request, env);
    }
  },
};
