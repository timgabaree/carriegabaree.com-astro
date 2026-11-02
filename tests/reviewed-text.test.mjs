import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {reflowPage,rawSegments,effectiveSegments,validateReadingText} from '../scripts/reviewed-text.mjs';
import {reviewBatch,installReviewSchema} from '../scripts/review-pdf-text.mjs';
import {readSnapshot,approvedExport,buildChangeBatch} from '../scripts/search-database.mjs';
import {planChanges,origin} from '../scripts/search-scan.mjs';
function fixture(t) {
 const raw=new DatabaseSync(':memory:');t.after(()=>raw.close());
 raw.exec(`CREATE TABLE records(id TEXT PRIMARY KEY,kind TEXT,title TEXT,summary TEXT DEFAULT '',public_url TEXT,state TEXT,rights_review TEXT,revision INTEGER DEFAULT 1,updated_at TEXT,updated_by TEXT);
 CREATE TABLE documents(id TEXT PRIMARY KEY,record_id TEXT,kind TEXT,source_url TEXT,sha256 TEXT);
 CREATE TABLE text_segments(document_id TEXT,ordinal INTEGER,locator TEXT,content TEXT,PRIMARY KEY(document_id,ordinal));
 CREATE TABLE subjects(id TEXT,label TEXT); CREATE TABLE record_subjects(record_id TEXT,subject_id TEXT);
 INSERT INTO records(id,kind,title,public_url,state,rights_review) VALUES('R','publication','Book','${origin}/book.pdf','ready','approved');
 INSERT INTO documents VALUES('D','R','publication','${origin}/book.pdf','hash');
 INSERT INTO text_segments VALUES('D',1,'PDF page 1','b y  c arrie  g abarée');`);
 const db={async batch(batch){raw.exec('BEGIN');try{const out=batch.map(({sql,params=[]})=>raw.prepare(sql).all(...params));raw.exec('COMMIT');return out;}catch(e){raw.exec('ROLLBACK');throw e;}}};
 return {raw,db};
}
test('layout joins only adjacent same-size lines, preserving indentation and uncertain text',()=>{
 const lines=['A sentence whose first printed line is long enough to wrap','continues here in the same paragraph.','This is a new indented paragraph.','HEADING'];
 const layout=lines.map((text,i)=>({text,top:i*12,x:i===2?60:51,height:11}));
 const result=reflowPage(lines.join('\n'),layout);
 assert.equal(result.joined,1);assert.match(result.content,/wrap continues/);assert.match(result.content,/paragraph\.\n\nThis/);assert.match(result.content,/\n\nHEADING/);
 assert.equal(reflowPage(result.content).content,result.content);
});
test('verified name repair preserves the printed accent; ambiguous hyphens stay visible',()=>{
 assert.equal(reflowPage('b y  c arrie  Gabar Ée').content,'By Carrie Gabarée');
 const result=reflowPage('This line ends with a long ambiguous compound-\nword here',[]);
 assert.equal(result.hyphenBreaks,1);assert.match(result.content,/compound-\n\nword/);
 assert.equal(reflowPage('Jane García\nA heading').content,'Jane García\n\nA heading');
});
test('cannot remove segments or page locators in an edited candidate',()=>{
 const raw=[{ordinal:1,locator:'PDF page 1',content:'Original'}];
 for(const candidate of [[],[{...raw[0],locator:'PDF page 2'}],[{...raw[0],content:''}],[{...raw[0],private:'x'}]])assert.throws(()=>validateReadingText(raw,candidate));
});
test('schema installation, raw preservation, effective export, history, scanner protection and stale fail-closed',async t=>{
 const f=fixture(t);let snapshot=await readSnapshot(f.db);
 await installReviewSchema(f.db,'',snapshot);snapshot=await readSnapshot(f.db);
 const doc=snapshot.documents[0],original=rawSegments(snapshot,'D');
 const cleaned=original.map(s=>({...s,content:'By Carrie Gabarée'}));
 await f.db.batch(reviewBatch(snapshot,doc,cleaned,'editor@example.com'));
 let after=await readSnapshot(f.db);
 assert.deepEqual(rawSegments(after,'D'),original);assert.deepEqual(effectiveSegments(after,doc),cleaned);
 assert.equal(approvedExport(after).segments[0].content,'By Carrie Gabarée');
 assert.equal(f.raw.prepare('SELECT content FROM search_text_segments').get().content,'By Carrie Gabarée');
 const source={url:origin+'/book.pdf',sha256:'hash',segments:original.map(({locator,content})=>({locator,content}))};
 assert.equal(planChanges(after,{sources:[source],failures:[]}).unchanged.length,1);
 const correctedSource={...source,segments:cleaned.map(({locator,content})=>({locator,content}))};
 assert.equal(planChanges(after,{sources:[correctedSource],failures:[]}).unchanged.length,1);
 const changed={...source,segments:[{locator:'PDF page 1',content:'Changed'}]};
 assert.equal(planChanges(after,{sources:[changed],failures:[]}).blocked.length,1);
 assert.throws(()=>buildChangeBatch(after,{action:'update',id:'R',source:changed,document:doc},'editor@example.com'),/reviewed/);
 await f.db.batch(reviewBatch(after,doc,cleaned,'editor@example.com'));
 after=await readSnapshot(f.db);assert.equal(after.text_review_history.length,1);
 f.raw.exec("UPDATE text_segments SET content='Changed source'");
 assert.equal(f.raw.prepare('SELECT valid FROM text_review_status').get().valid,0);
 assert.equal(f.raw.prepare('SELECT count(*) n FROM search_text_segments').get().n,0);
 assert.throws(()=>approvedExport({...after,text_segments:[{document_id:'D',ordinal:1,locator:'PDF page 1',content:'Changed source'}]}),/stale/);
});
test('concurrent metadata, raw extraction or review edits abort without replacing prior review',async t=>{
 for(const sql of ["UPDATE records SET revision=revision+1","UPDATE text_segments SET content='Concurrent'","UPDATE documents SET sha256='new'"]) {
  const f=fixture(t);await installReviewSchema(f.db,'',await readSnapshot(f.db));const before=await readSnapshot(f.db);
  f.raw.exec(sql);await assert.rejects(f.db.batch(reviewBatch(before,before.documents[0],rawSegments(before,'D'),'editor@example.com')));
  assert.equal(f.raw.prepare('SELECT count(*) n FROM text_reviews').get().n,0);
 }
});
