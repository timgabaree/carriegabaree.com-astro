import test from 'node:test';
import assert from 'node:assert/strict';
import {validateArchive,emptyArchive,readPreviewArchive,readArchive} from '../scripts/archive-data.mjs';
import {buildArchiveIndex} from '../scripts/archive-index.mjs';
import {mkdtemp,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {gunzipSync} from 'node:zlib';
import {searchTerms,matchRanges,excerptAround,sourceLink} from '../public/js/archive-matches.js';
const fixture=()=>({schema_version:2,records:[{id:'R1',title:'Title',kind:'publication',summary:'Summary',public_url:null,state:'ready',rights_review:'approved'}],subjects:[{record_id:'R1',label:'History'}],segments:[{record_id:'R1',locator:'Page 1',content:'A searchable telescope passage. <script>untrusted</script>'}]});
test('passage matching finds bomb word forms and builds excerpts around actual hits',()=>{
 const text='Introduction. '.repeat(80)+'The bomb exploded. Bombs and bombing followed.';
 const ranges=matchRanges(text,searchTerms('bomb'));
 assert.equal(ranges.length,3);assert.match(excerptAround(text,ranges),/bomb exploded/);assert.ok(excerptAround(text,ranges).startsWith('…'));
 assert.deepEqual(matchRanges('A different subject',searchTerms('bomb')),[]);
 assert.deepEqual(matchRanges('bomb',searchTerms('')),[]);
 assert.ok(searchTerms('x '.repeat(500)).length<=32);
 assert.doesNotThrow(()=>matchRanges('bomb',searchTerms('[(.*)]')));
 assert.equal(matchRanges('bombarding',searchTerms('bomb')).length,1);
});
test('original links use physical PDF page locators, never result positions',()=>{
 assert.deepEqual(sourceLink('https://carriegabaree.com/media/book.pdf','PDF page 7'),{href:'https://carriegabaree.com/media/book.pdf#page=7',label:'Open original PDF — page 7'});
 assert.equal(sourceLink('https://carriegabaree.com/transcript','00:19').href,'https://carriegabaree.com/transcript');
 assert.equal(sourceLink('javascript:alert(1)','PDF page 1'),null);
 assert.equal(sourceLink('https://evil.example/book.pdf','PDF page 1'),null);
 assert.equal(sourceLink('','PDF page 1'),null);
});
test('empty collection stays empty; approved fields and full text survive validation',()=>{
 assert.deepEqual(validateArchive(emptyArchive),[]);const records=validateArchive(fixture());assert.equal(records.length,1);assert.equal(records[0].subjects[0],'History');assert.match(records[0].segments[0].content,/telescope/);assert.ok(!('state' in records[0]));
});
test('drafts, restricted records, unknown fields and unsafe links fail closed',()=>{
 for(const patch of [{state:'draft'},{rights_review:'restricted'},{rights_review:'pending'},{source_json:'PRIVATE'},{updated_by:'private@example.com'},{id:'../private'},{kind:'__proto__'},{public_url:'javascript:alert(1)'},{public_url:'https://other.example/private'},{public_url:'https://user:secret@carriegabaree.com/contact'},{public_url:'https://carriegabaree.com/contact?private=token'}]){const f=fixture();Object.assign(f.records[0],patch);assert.throws(()=>validateArchive(f));}
 const duplicate=fixture();duplicate.records.push({...duplicate.records[0]});assert.throws(()=>validateArchive(duplicate));
});
test('orphan text and private raw data cannot enter an approved snapshot',()=>{
 for(const table of ['segments','subjects']){const f=fixture();f[table][0].record_id='PRIVATE';assert.throws(()=>validateArchive(f));}
 const f=fixture();f.source_rows=[];assert.throws(()=>validateArchive(f));
});
test('archive preview is off by default and forbidden in production',()=>{
 const old=process.env.ARCHIVE_PREVIEW,env=process.env.PUBLIC_SITE_ENV;
 try{delete process.env.ARCHIVE_PREVIEW;assert.deepEqual(readPreviewArchive(),[]);process.env.ARCHIVE_PREVIEW='1';process.env.PUBLIC_SITE_ENV='production';assert.throws(()=>readPreviewArchive(),/production/);}
 finally{if(old===undefined)delete process.env.ARCHIVE_PREVIEW;else process.env.ARCHIVE_PREVIEW=old;if(env===undefined)delete process.env.PUBLIC_SITE_ENV;else process.env.PUBLIC_SITE_ENV=env;}
});
test('normal builds use the versioned approved snapshot, never a private database',async()=>{
 const snapshot=JSON.parse(await readFile(new URL('../src/data/archive-approved.json',import.meta.url),'utf8'));
 assert.deepEqual(readArchive(),validateArchive(snapshot));
 assert.ok(readArchive().length>0);
});
test('search index builds full text and type filters in an isolated test directory',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'archive-index-test-'));
 try{
  await buildArchiveIndex(validateArchive(fixture()),dir);
  const entry=JSON.parse(await readFile(join(dir,'pagefind-entry.json'),'utf8'));assert.equal(entry.languages.en.page_count,1);
  const fragments=await readdir(join(dir,'fragment'));assert.equal(fragments.length,1);
  const data=JSON.parse(gunzipSync(await readFile(join(dir,'fragment',fragments[0]))).toString().replace(/^pagefind_dcd/,'').trim());
  assert.equal(data.url,'/archive/R1');assert.match(data.content,/telescope/);assert.equal(data.meta.kind,'Publication');
 }finally{await rm(dir,{recursive:true,force:true});}
});
