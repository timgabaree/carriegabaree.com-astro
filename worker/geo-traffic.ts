// Record successful public page requests without IPs, query strings,
// raw user agents, cookies, fingerprints, or visitor identifiers.
export const SITES = ['timgabaree.com','carriegabaree.com','rgesol.com','finngabaree.com','clintgabaree.com'];
type GeoCf = {country?: string; region?: string; regionCode?: string; city?: string; botManagement?: {score?: number; verifiedBot?: boolean}; verifiedBotCategory?: string};
type GeoRequest = Request & {cf?: GeoCf};
export function summarizeTraffic(request: GeoRequest, response: Response, now = new Date()) {
 const url = new URL(request.url);
 if (!SITES.includes(url.hostname) || request.method !== 'GET' || ![200,304].includes(response.status) || !/^text\/html(?:;|$)/i.test(response.headers.get('content-type') || '')) return null;
 if (request.headers.get('dnt') === '1' || request.headers.get('sec-gpc') === '1') return null;
 if (/prefetch|prerender/i.test([request.headers.get('purpose'),request.headers.get('sec-purpose')].join(' '))) return null;
 const cf = request.cf;
 if (!cf) return null;
 const ua = (request.headers.get('user-agent') || '').slice(0,1024);
 const bot = cf.botManagement;
 const hasScore = typeof bot?.score === 'number' && bot.score >= 1 && bot.score <= 99;
 const verified = bot?.verifiedBot === true || Boolean(cf.verifiedBotCategory);
 const automation = /bot\b|crawler|spider|headless|curl\/|wget\/|python|httpclient|go-http-client|facebookexternalhit|slackbot|preview|lighthouse|pagespeed|monitor|uptime|selenium|playwright|puppeteer/i.test(ua);
 const browser = /Edg(?:e|A|iOS)?\//.test(ua) ? 'Edge' : /OPR\/|Opera/.test(ua) ? 'Opera' : /SamsungBrowser\//.test(ua) ? 'Samsung Internet' : /Firefox\/|FxiOS\//.test(ua) ? 'Firefox' : /Chrome\/|CriOS\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) && /Version\//.test(ua) ? 'Safari' : 'Other / unknown';
 const device = /iPad|Tablet|Silk\//i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua)) ? 'Tablet' : /Mobile|iPhone|iPod/i.test(ua) ? 'Mobile' : browser !== 'Other / unknown' ? 'Desktop' : 'Unknown';
 const category = verified ? 'verified_bot' : automation || (hasScore && bot!.score! < 30) ? 'suspected_automation' : browser !== 'Other / unknown' ? 'browser_like' : 'unclassified';
 const clean = (v: unknown, size=80) => typeof v === 'string' ? v.normalize('NFC').replace(/[\u0000-\u001f\u007f]/g,'').trim().slice(0,size) || 'Unknown' : 'Unknown';
 return {day:now.toISOString().slice(0,10),site:url.hostname,country:clean(cf.country,2),region:clean(cf.region),region_code:clean(cf.regionCode,8),city:clean(cf.city),browser,device,category,signal:hasScore?'score_available':verified?'verified_only':'basic_signals'};
}
export async function recordTraffic(request: GeoRequest, response: Response, db: D1Database) {
 const now = new Date();
 const v = summarizeTraffic(request,response,now);
 if (!v) return;
 await db.batch([db.prepare(`INSERT INTO traffic_daily(day,site,country,region,region_code,city,browser,device,category,signal,requests)
 VALUES(?,?,?,?,?,?,?,?,?,?,1) ON CONFLICT(day,site,country,region,region_code,city,browser,device,category,signal)
 DO UPDATE SET requests=traffic_daily.requests+1`).bind(v.day,v.site,v.country,v.region,v.region_code,v.city,v.browser,v.device,v.category,v.signal),
 db.prepare(`INSERT INTO traffic_requests(occurred_at,day,site,path,country,region,city,browser,device,category,signal)
 VALUES(?,?,?,?,?,?,?,?,?,?,?)`).bind(now.toISOString(),v.day,v.site,new URL(request.url).pathname.slice(0,1000),v.country,v.region,v.city,v.browser,v.device,v.category,v.signal)
 ]);
}
export function queueTraffic(request: GeoRequest, response: Response, env: {ENVIRONMENT?:string; GEO_DB?:D1Database}, ctx?:ExecutionContext) {
 if (env.ENVIRONMENT !== 'production' || !env.GEO_DB || !ctx) return;
 ctx.waitUntil(recordTraffic(request,response,env.GEO_DB).catch(() => {console.error(JSON.stringify({event:'geo_aggregate_write_failed'}));}));
}
