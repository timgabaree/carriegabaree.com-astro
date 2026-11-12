import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {summarizeTraffic,recordTraffic,queueTraffic} from '../worker/geo-traffic.ts';
const ua='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36';
function req(headers={},cf={country:'US',region:'Illinois',regionCode:'IL',city:'Homer Glen'},url='https://finngabaree.com/?secret=not-stored',method='GET'){
 const r=new Request(url,{method,headers:{'user-agent':ua,'sec-fetch-mode':'navigate','sec-fetch-dest':'document',...headers}});Object.defineProperty(r,'cf',{value:cf});return r;
}
const res=(status=200,type='text/html')=>new Response(status===304?null:'page',{status,headers:{'Content-Type':type}});
test('aggregation projects only approved dimensions and classifies combinations',()=>{
 const v=summarizeTraffic(req({'cookie':'private','cf-connecting-ip':'192.0.2.1'}),res(),new Date('2026-11-12T12:00:00Z'));
 assert.deepEqual(Object.keys(v),['day','site','country','region','region_code','city','browser','device','category','signal']);
 assert.equal(v.category,'browser_like');assert.equal(v.browser,'Chrome');assert.equal(v.device,'Desktop');assert.equal(v.city,'Homer Glen');assert.equal(v.signal,'basic_signals');
 assert.equal(summarizeTraffic(req({'user-agent':'Googlebot'}),res()).category,'suspected_automation');
 assert.equal(summarizeTraffic(req({}, {botManagement:{verifiedBot:true,score:99}}),res()).category,'verified_bot');
 assert.equal(summarizeTraffic(req({}, {botManagement:{score:5}}),res()).category,'suspected_automation');
 assert.equal(summarizeTraffic(req({}, {botManagement:{score:0}}),res()).signal,'basic_signals');
 assert.equal(summarizeTraffic(req({'sec-fetch-mode':'','sec-fetch-dest':''}),res()).category,'unclassified');
 assert.equal(summarizeTraffic(req({'user-agent':'Mozilla/5.0 (iPad) Version/17.0 Safari/605.1.15'}),res()).device,'Tablet');
 assert.equal(summarizeTraffic(req({'user-agent':'Mozilla/5.0 (iPhone) Version/17.0 Mobile Safari/605.1.15'}),res()).browser,'Safari');
});
test('excludes private preferences, prefetches, non-pages, failures and noncanonical hosts',()=>{
 for(const h of [{'dnt':'1'},{'sec-gpc':'1'},{'sec-purpose':'prefetch'},{purpose:'prerender'}])assert.equal(summarizeTraffic(req(h),res()),null);
 for(const status of [301,404,500])assert.equal(summarizeTraffic(req(),res(status)),null);
 for(const type of ['application/json','application/xml','audio/mpeg','image/png'])assert.equal(summarizeTraffic(req(),res(200,type)),null);
 assert.equal(summarizeTraffic(req({},undefined,'https://evil.example/'),res()),null);
 assert.equal(summarizeTraffic(req({},undefined,'https://finngabaree.com/','HEAD'),res()),null);
 assert.equal(summarizeTraffic(req({},null),res()),null);
 assert.equal(summarizeTraffic(req(),res(304)).category,'browser_like');
});
test('SQL aggregates without storing individual events and scheduling fails open',async()=>{
 const raw=new DatabaseSync(':memory:');raw.exec('CREATE TABLE traffic_daily(day TEXT,site TEXT,country TEXT,region TEXT,region_code TEXT,city TEXT,browser TEXT,device TEXT,category TEXT,signal TEXT,requests INTEGER,PRIMARY KEY(day,site,country,region,region_code,city,browser,device,category,signal))');
 const db={prepare(sql){return {bind(...p){return {async run(){return raw.prepare(sql).run(...p);}};}};}};
 await recordTraffic(req(),res(),db);await recordTraffic(req(),res(),db);
 assert.equal(raw.prepare('SELECT requests FROM traffic_daily').get().requests,2);raw.close();
 const pending=[];const broken={prepare(){throw Error('private diagnostic');}};
 const error=console.error;const logged=[];console.error=x=>logged.push(x);
 try {queueTraffic(req(),res(),{ENVIRONMENT:'production',GEO_DB:broken},{waitUntil:p=>pending.push(p)});await Promise.all(pending);assert.deepEqual(logged,['{"event":"geo_aggregate_write_failed"}']);}finally{console.error=error;}
 const ignored=[];queueTraffic(req(),res(),{ENVIRONMENT:'staging',GEO_DB:db},{waitUntil:p=>ignored.push(p)});assert.equal(ignored.length,0);
});
