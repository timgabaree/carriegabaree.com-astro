import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {sourceURL,origin,download,extractHTML,planChanges,hash,scanSite} from '../scripts/search-scan.mjs';
import {readSnapshot,saveBackup,buildChangeBatch,approvedExport} from '../scripts/search-database.mjs';
import {selectChanges,applyReviewed,continueRelease,syncSearchRecords} from '../scripts/sync-search-records.mjs';

const schema=`
CREATE TABLE records(id TEXT PRIMARY KEY,kind TEXT NOT NULL,source_identifier TEXT UNIQUE,title TEXT NOT NULL,object_date TEXT,summary TEXT NOT NULL DEFAULT '',public_url TEXT,state TEXT DEFAULT 'draft',rights_review TEXT DEFAULT 'pending',revision INTEGER DEFAULT 1,updated_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_by TEXT DEFAULT 'import',source_json TEXT DEFAULT '{}');
CREATE TABLE documents(id TEXT PRIMARY KEY,record_id TEXT REFERENCES records(id),kind TEXT,source_url TEXT,sha256 TEXT,review_note TEXT,source_page_count INTEGER);
CREATE TABLE text_segments(document_id TEXT REFERENCES documents(id),ordinal INTEGER,locator TEXT,content TEXT,PRIMARY KEY(document_id,ordinal));
CREATE TABLE subjects(id TEXT PRIMARY KEY,label TEXT);
CREATE TABLE record_subjects(record_id TEXT REFERENCES records(id),subject_id TEXT REFERENCES subjects(id));
CREATE TABLE revisions(id INTEGER PRIMARY KEY,record_id TEXT,revision INTEGER,actor TEXT);
CREATE TRIGGER record_revision BEFORE UPDATE ON records BEGIN
 SELECT CASE WHEN NEW.revision!=OLD.revision+1 THEN RAISE(ABORT,'revision must increase') END;
 INSERT INTO revisions(record_id,revision,actor) VALUES(OLD.id,OLD.revision,NEW.updated_by);
END;`;
function fixture(t) {
  const raw=new DatabaseSync(':memory:');raw.exec(schema+' PRAGMA foreign_keys=ON;');
  raw.prepare("INSERT INTO records(id,kind,title,summary,public_url,state,rights_review) VALUES('ONE','publication','Editor title','Editor summary',?,'ready','approved')").run(origin+'/book.pdf');
  raw.prepare("INSERT INTO documents VALUES('DOC','ONE','publication',?,'old','Original note',1)").run(origin+'/book.pdf');
  raw.exec("INSERT INTO text_segments VALUES('DOC',1,'PDF page 1','Original source text'); INSERT INTO subjects VALUES('S','History'); INSERT INTO record_subjects VALUES('ONE','S');");
  const db={async batch(batch){raw.exec('BEGIN');try{const results=batch.map(({sql,params=[]})=>raw.prepare(sql).all(...params));raw.exec('COMMIT');return results;}catch(e){raw.exec('ROLLBACK');throw e;}}};
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'search-sync-test-'));
  t.after(()=>{raw.close();fs.rmSync(root,{recursive:true,force:true});});
  return {raw,db,root};
}
function source(url=origin+'/book.pdf',content='Updated source text') {
  return {url,title:'Fetched title',kind:'publication',documentKind:'publication',sha256:hash('bytes'),segments:[{locator:'PDF page 1',content}],pageCount:1,links:[],warnings:[]};
}
test('scan excludes other hosts, generated results, utilities, private endpoints and query links',()=>{
  assert.equal(sourceURL('/about#bio'),origin+'/about');
  for(const u of ['https://evil.test/x','http://carriegabaree.com/x','//carriegabaree.com.evil/x','/search/ONE','/archive/ONE','/api/a','/privacy','/sitemap.xml','/contact','/x?q=1','/photo.jpg','/%2fsearch','https://user:pass@carriegabaree.com/a'])assert.equal(sourceURL(u),null,u);
});
test('external redirects are refused before following; HTTP failure retains its status',async()=>{
  let calls=0;
  await assert.rejects(download(origin+'/a',async()=>{calls++;return new Response(null,{status:302,headers:{location:'https://evil.test'}});}),/scope/);
  assert.equal(calls,1);
  assert.equal((await download(origin+'/a',async()=>new Response(null,{status:404}))).status,404);
});
test('HTML extracts only content and transcript locators, not navigation, forms or scripts',()=>{
  const page=extractHTML(Buffer.from('<title>Title</title><nav>OUTSIDE</nav><main><h1>About</h1><p>Useful text</p><script>SECRET</script><form><p>FORM</p></form><nav><p>NAV</p></nav><a href="/book.pdf">Book</a></main>'),origin+'/about');
  assert.deepEqual(page.segments.map(s=>s.content),['About','Useful text']);assert.equal(page.links[0].url,origin+'/book.pdf');
  const transcript=extractHTML(Buffer.from('<main><h1>Interview</h1><div class="transcript-content"><b class="speaker">Jane</b><span class="timestamp">00:12</span><p class="transcript-line">Hello world.</p></div></main>'),origin+'/interview');
  assert.equal(transcript.kind,'oral_history');assert.deepEqual(transcript.segments,[{locator:'00:12',content:'Jane: Hello world.'}]);
});
test('discovery follows same-site content links but never generated search results',async()=>{
  const called=[];
  const fetcher=async url=>{called.push(url);if(url.endsWith('sitemap.xml'))return new Response('<urlset><url><loc>'+origin+'/about</loc></url><url><loc>'+origin+'/search/ONE</loc></url></urlset>',{headers:{'content-type':'application/xml'}});return new Response('<main><h1>Page</h1><p>Text</p><a href="/search/ONE">Search</a><a href="https://evil.test">External</a></main>',{headers:{'content-type':'text/html'}});};
  const result=await scanSite({fetcher});assert.equal(result.sources.length,2);assert.equal(result.failures.length,0);
  assert.deepEqual(called,[origin+'/sitemap.xml',origin+'/',origin+'/about']);
});
test('plan avoids duplicates, preserves editorial metadata, skips unchanged withdrawn records',async t=>{
  const f=fixture(t),snapshot=await readSnapshot(f.db);
  let plan=planChanges(snapshot,{sources:[source()],failures:[]});assert.equal(plan.changes.length,1);assert.equal(plan.changes[0].title,'Editor title');
  snapshot.records[0].state='draft';snapshot.records[0].rights_review='pending';
  plan=planChanges(snapshot,{sources:[source(origin+'/book.pdf','Original source text')],failures:[]});assert.equal(plan.changes.length,0);assert.equal(plan.unchanged.length,1);
  snapshot.records[0].rights_review='restricted';assert.equal(planChanges(snapshot,{sources:[source()],failures:[]}).blocked.length,1);
});
test('timeouts never propose withdrawals; explicit missing URLs require selected withdrawal',async t=>{
  const f=fixture(t),snapshot=await readSnapshot(f.db);
  for(const status of [0,403,429,500])assert.equal(planChanges(snapshot,{sources:[],failures:[{url:origin+'/book.pdf',status}]}).changes.length,0);
  const plan=planChanges(snapshot,{sources:[],failures:[{url:origin+'/book.pdf',status:404}]});assert.equal(plan.changes[0].action,'withdraw');
  assert.deepEqual(selectChanges(plan,''),[]);assert.throws(()=>selectChanges(plan,'all'));assert.throws(()=>selectChanges(plan,'1,1'));
});
test('redirect aliases and identical bytes never create a second record',async t=>{
  const f=fixture(t),snapshot=await readSnapshot(f.db);
  const redirected={...source(origin+'/new-location.pdf'),aliases:[origin+'/new-location.pdf',origin+'/book.pdf']};
  const plan=planChanges(snapshot,{sources:[redirected],failures:[]});assert.equal(plan.changes[0].id,'ONE');assert.equal(plan.changes[0].action,'update');
  const duplicate={...source(origin+'/copy.pdf'),sha256:'old'};
  assert.equal(planChanges(snapshot,{sources:[duplicate],failures:[]}).blocked.length,1);
});
test('live sources changing during the final confirmation block the release',async()=>{
  const calls=[];let count=0;
  await assert.rejects(continueRelease({ask:async()=>'CONTINUE TO RELEASE',log:()=>{},assertFresh:async()=>{if(++count===6)throw Error('Stale approved data');},release:async(step,hooks)=>{if(step==='publish')await hooks.beforePublish();calls.push(step);}}),/Stale approved data/);
  assert.ok(!calls.includes('publish'));assert.ok(!calls.includes('verify'));
});
test('approved update retains title, summary, relationships and records a revision; repeat scan is idempotent',async t=>{
  const f=fixture(t),snapshot=await readSnapshot(f.db);const scan={sources:[source()],failures:[]};
  const change=planChanges(snapshot,scan).changes[0];await f.db.batch(buildChangeBatch(snapshot,change,'editor@example.com'));
  const after=await readSnapshot(f.db);assert.equal(after.records[0].title,'Editor title');assert.equal(after.records[0].summary,'Editor summary');assert.equal(after.records[0].revision,2);assert.equal(after.revisions.length,1);
  assert.deepEqual(after.record_subjects,snapshot.record_subjects);assert.equal(after.text_segments[0].content,'Updated source text');
  assert.equal(planChanges(after,scan).changes.length,0);assert.equal(approvedExport(after).subjects[0].label,'History');
});
test('concurrent metadata or source changes abort complete transaction',async t=>{
  for(const edit of ["UPDATE records SET title='Concurrent',revision=revision+1 WHERE id='ONE'","UPDATE text_segments SET content='Concurrent' WHERE document_id='DOC'"]) {
    const f=fixture(t),snapshot=await readSnapshot(f.db),change=planChanges(snapshot,{sources:[source()],failures:[]}).changes[0];
    f.raw.exec(edit);const before=hash(await readSnapshot(f.db));
    await assert.rejects(f.db.batch(buildChangeBatch(snapshot,change,'editor@example.com')));
    assert.equal(hash(await readSnapshot(f.db)),before);
  }
});
test('failure after update rolls back text, approval and revision together',async t=>{
  const f=fixture(t),snapshot=await readSnapshot(f.db),change=planChanges(snapshot,{sources:[source()],failures:[]}).changes[0];
  const batch=buildChangeBatch(snapshot,change,'editor@example.com');batch.push({sql:"INSERT INTO records(id,kind,title) VALUES('ONE','publication','Duplicate')"});
  await assert.rejects(f.db.batch(batch));assert.equal(hash(await readSnapshot(f.db)),hash(snapshot));
});
test('new records can be approved and withdrawal keeps all private text',async t=>{
  const f=fixture(t),snapshot=await readSnapshot(f.db),change=planChanges(snapshot,{sources:[source(origin+'/new.pdf')],failures:[]}).changes[0];
  await f.db.batch(buildChangeBatch(snapshot,change,'editor@example.com'));
  let after=await readSnapshot(f.db);assert.equal(after.records.length,2);assert.equal(approvedExport(after).records.length,2);
  await f.db.batch(buildChangeBatch(after,{action:'withdraw',id:'ONE'},'editor@example.com'));
  after=await readSnapshot(f.db);assert.equal(after.records.length,2);assert.equal(after.documents.length,2);assert.equal(approvedExport(after).records.length,1);
});
test('backup restores all rows, relationships and triggers; cannot overwrite previous backup',async t=>{
  const f=fixture(t),snapshot=await readSnapshot(f.db);const backup=saveBackup(snapshot,path.join(f.root,'backup'));
  const restored=new DatabaseSync(backup);assert.equal(restored.prepare('SELECT count(*) n FROM text_segments').get().n,1);assert.throws(()=>restored.exec("UPDATE records SET title='Oops'"));restored.close();
  assert.throws(()=>saveBackup(snapshot,path.join(f.root,'backup')));
});
test('source freshness failure prevents any database write or backup',async t=>{
  const f=fixture(t),snapshot=await readSnapshot(f.db),selected=planChanges(snapshot,{sources:[source()],failures:[]}).changes;
  await assert.rejects(applyReviewed({db:f.db,snapshot,selected,actor:'editor@example.com',dir:path.join(f.root,'backup'),fetcher:async()=>new Response('different'),log:()=>{}}),/changed during review/);
  assert.equal(hash(await readSnapshot(f.db)),hash(snapshot));assert.ok(!fs.existsSync(path.join(f.root,'backup')));
});
test('release is optional and uses ordered established steps with a final freshness hook',async()=>{
  const calls=[];let checked=0;const options={ask:async()=>'',release:async step=>calls.push(step),assertFresh:async()=>{checked++;},log:()=>{}};
  assert.equal(await continueRelease(options),false);assert.deepEqual(calls,[]);
  options.ask=async()=>'CONTINUE TO RELEASE';options.release=async(step,hooks)=>{calls.push(step);if(step==='publish')await hooks.beforePublish();};
  assert.equal(await continueRelease(options),true);assert.deepEqual(calls,['check','commit','push','upload','publish','verify']);assert.equal(checked,7);
});
test('scan-only produces review files but never writes database or publication input',async t=>{
  const f=fixture(t),before=hash(await readSnapshot(f.db));let prompted=false;
  const result=await syncSearchRecords(f.root,{settings:{python:'unused'},db:f.db,scan:async()=>({sources:[source()],failures:[]}),scanOnly:true,ask:async()=>{prompted=true;throw Error('Unexpected prompt');},log:()=>{}});
  assert.equal(prompted,false);assert.equal(hash(await readSnapshot(f.db)),before);assert.ok(fs.existsSync(path.join(result.dir,'review.txt')));assert.ok(!fs.existsSync(path.join(f.root,'src/data/archive-approved.json')));assert.ok(!fs.existsSync(path.join(f.root,'.local/search-sync/running.lock')));
});
test('cancelled apply never writes a database or proceeds to release',async t=>{
  const f=fixture(t),before=hash(await readSnapshot(f.db));const answers=['1','editor@example.com','NO'];
  const result=await syncSearchRecords(f.root,{settings:{editors:['editor@example.com']},db:f.db,scan:async()=>({sources:[source()],failures:[]}),ask:async()=>answers.shift(),release:()=>{throw Error('Unexpected release');},log:()=>{}});
  assert.equal(result.cancelled,true);assert.equal(hash(await readSnapshot(f.db)),before);
});
