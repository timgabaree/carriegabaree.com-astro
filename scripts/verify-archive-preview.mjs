import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {parse} from 'node-html-parser';
import {readArchive} from './archive-data.mjs';
import {sourceLink} from '../public/js/archive-matches.js';

const production=process.argv.includes('--production');
if(production)delete process.env.ARCHIVE_PREVIEW;else process.env.ARCHIVE_PREVIEW='1';
const records=readArchive();
const root=new URL(production?'../dist-production/':'../dist-archive-preview/',import.meta.url);
const search=parse(await readFile(new URL('archive.html',root),'utf8'));
assert.equal(search.querySelectorAll('h1').length,1);
assert.match(search.querySelector('meta[name="robots"]').getAttribute('content'),production?/^index, follow/:/noindex/);
if(production)assert.ok(!search.querySelector('.archive-preview-note'));
const browse=search.querySelectorAll('.archive-record-list a');
assert.equal(browse.length,records.length,'Search page must contain every approved record');
for(const r of records){
 assert.ok(browse.some(a=>a.getAttribute('href')==='/archive/'+r.id));
 const html=parse(await readFile(new URL('archive/'+r.id+'.html',root),'utf8'));
 assert.equal(html.querySelector('h1').textContent,r.title);
 assert.deepEqual(html.querySelectorAll('.archive-passage p').map(p=>p.textContent),r.segments.map(s=>s.content),'Full text must survive rendering exactly');
 assert.ok(html.querySelector('#search-matches'),'Matching passages must have a stable focus target');
 assert.equal(html.querySelector('#archive-back').textContent,'← Back to search results');
 assert.equal(html.querySelector('#archive-show-full').getAttribute('aria-controls'),'archive-source-text');
 assert.ok(html.querySelector('#archive-source-text'),'Source text must have a view-toggle target');
 if(production){
  assert.match(html.querySelector('meta[name="robots"]').getAttribute('content'),/^index, follow/);
  assert.ok(!html.querySelector('.archive-preview-note'));
  assert.equal(html.querySelector('link[rel="canonical"]').getAttribute('href'),'https://carriegabaree.com/archive/'+r.id);
 }
 r.segments.forEach((segment,i)=>{
  const section=html.querySelector('#passage-'+(i+1)),source=sourceLink(r.sourceUrl,segment.locator);
  if(source)assert.equal(section.querySelector('.archive-source-link').getAttribute('href'),source.href);
 });
}
if(production){
 const xml=await readFile(new URL('sitemap.xml',root),'utf8');
 for(const route of ['/archive',...records.map(r=>'/archive/'+r.id)])assert.ok(xml.includes('<loc>https://carriegabaree.com'+route+'</loc>'));
}
if(records.length){
 const entry=JSON.parse(await readFile(new URL('archive-index/pagefind-entry.json',root),'utf8'));
 assert.equal(entry.languages.en.page_count,records.length);
 const files=await readdir(new URL('archive-index/fragment/',root));
 const fragments=await Promise.all(files.map(async file=>JSON.parse(gunzipSync(await readFile(new URL('archive-index/fragment/'+file,root))).toString().replace(/^pagefind_dcd/,'').trim())));
 assert.deepEqual(fragments.map(f=>f.url).sort(),records.map(r=>'/archive/'+r.id).sort());
}
console.log(`Verified ${records.length} approved pages, exact full-text rendering, browse links, ${production?'production indexing and sitemap':'noindex'}, and matching search-index records.`);
