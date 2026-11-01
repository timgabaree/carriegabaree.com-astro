import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {join,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
const mode=process.argv[2]??'local';assert.ok(['local','staging','production'].includes(mode));
const base=mode==='local'?'http://127.0.0.1:8803':mode==='staging'?'https://carriegabaree-com-astro-staging.timgabaree-com-astro.workers.dev':'https://carriegabaree.com';
const headers={};let checks=0;
if(mode==='staging'){
 for(const p of ['/','/contact','/favicon.ico','/contact-token','/robots.txt']){assert.equal((await fetch(base+p)).status,401);checks++;}
 const password=execFileSync('/usr/bin/security',['find-generic-password','-s','carriegabaree.com-astro-staging-basic-auth','-a','review','-w'],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();headers.Authorization='Basic '+Buffer.from('review:'+password).toString('base64');
}
const get=async(p,init={})=>{
 for(let attempt=0;attempt<3;attempt++){
  try{const r=await fetch(base+p,{...init,redirect:'manual',signal:AbortSignal.timeout(30000),headers:{...headers,...init.headers}});const bytes=await r.arrayBuffer();return new Response(bytes,{status:r.status,headers:r.headers});}
  catch(error){if(attempt===2)throw new Error('Read-only verification failed at '+p,{cause:error});}
 }
};
const pages=JSON.parse(fs.readFileSync(new URL('../src/data/pages.json',import.meta.url)));
const archive=JSON.parse(fs.readFileSync(new URL('../src/data/archive-approved.json',import.meta.url)));
for(const p of [...pages,{slug:'sitemap'},{slug:'archive'},...archive.records.map(r=>({slug:'archive/'+r.id}))]){
 const r=await get('/'+p.slug);assert.equal(r.status,200,p.slug);assert.ok(r.headers.get('content-security-policy'));assert.equal(r.headers.get('x-content-type-options'),'nosniff');
 const html=await r.text();assert.match(html,/<main/);assert.match(html,new RegExp('data-analytics-enabled="'+(mode==='production'?'true':'false')+'"'));
 if(mode!=='production')assert.match(r.headers.get('x-robots-tag'),/noindex/);checks+=6;
}
for(const [from,to] of Object.entries(JSON.parse(fs.readFileSync(new URL('../src/data/legacy-redirects.json',import.meta.url))))){const r=await get(from+'?test=1');assert.equal(r.status,301);assert.equal(r.headers.get('location'),to+'?test=1');checks+=2;}
for(const p of pages){const from=p.slug?'/'+p.slug+'.html':'/index.html';const r=await get(from);assert.equal(r.status,301,from);assert.equal(r.headers.get('location'),'/'+p.slug);checks+=2;}
for(const p of ['/.git/config','/.env','/worker/index.ts','/includes/config.php','/archive/not-a-record','/archive/archive.sqlite','/src/data/archive-approved.json','/api/public-preview','/random.php','/not-a-page']){assert.equal((await get(p)).status,404,p);checks++;}
assert.equal((await get('/archive/')).headers.get('location'),'/archive');checks++;
const xml=await(await get('/sitemap.xml')).text();assert.doesNotMatch(xml,/xml-stylesheet|\.xsl/);assert.match(xml,/<image:loc>/);checks+=2;
for(const r of archive.records){assert.ok(xml.includes('<loc>https://carriegabaree.com/archive/'+r.id+'</loc>'));checks++;}
if(mode==='production'){
 const root=new URL('../dist-production/archive-index/',import.meta.url);
 const files=fs.readdirSync(root,{recursive:true,withFileTypes:true}).filter(e=>e.isFile());
 for(const file of files){
  const local=join(file.parentPath,file.name);
  const assetPath=relative(fileURLToPath(root),local).split('\\').join('/');
  const r=await get('/archive-index/'+assetPath);assert.equal(r.status,200,assetPath);
  const hash=b=>createHash('sha256').update(b).digest('hex');
  assert.equal(hash(Buffer.from(await r.arrayBuffer())),hash(fs.readFileSync(local)),assetPath+' search asset differs');checks++;
 }
}
assert.equal((await get('/contact-submit')).status,405);assert.equal((await get('/contact-token',{headers:{Origin:'https://attacker.invalid'}})).status,403);checks+=2;
for(const p of ['AH104W.pdf','AH104(W).pdf','AH106W.pdf','AH106(W).pdf','cmhPub_70-128.pdf']){const r=await get('/portfolio/armypubs/'+p);assert.equal(r.status,200,p);const bytes=Buffer.from(await r.arrayBuffer());const hash=b=>createHash('sha256').update(b).digest('hex');assert.equal(hash(bytes),hash(fs.readFileSync(new URL('../public/portfolio/armypubs/'+p,import.meta.url))),p+' download hash');checks+=2;}
const report={checkedAt:new Date().toISOString(),mode,checks,pages:pages.length+1,emailSent:false};fs.mkdirSync(new URL('../.local/',import.meta.url),{recursive:true});fs.writeFileSync(new URL('../.local/'+mode+'-verification.json',import.meta.url),JSON.stringify(report,null,2));console.log(report);
