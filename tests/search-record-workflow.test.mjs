import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {prepareSearchRecords,exportPath,summarizeChanges} from '../scripts/prepare-search-records.mjs';
import {validateArchive} from '../scripts/archive-data.mjs';
const record=(id,title=id)=>({id,title,kind:'publication',summary:'',public_url:null,state:'ready',rights_review:'approved'});
const snapshot=records=>({schema_version:2,records,segments:[],subjects:[]});
async function fixture(fn){
 const root=await mkdtemp(join(tmpdir(),'search-workflow-'));
 const target=join(root,'src/data/archive-approved.json'),source=join(root,'fresh export (2).json'),preview=join(root,'.local/archive-approved.json');
 const original=JSON.stringify(snapshot([record('KEEP'),record('REMOVE')]));
 await mkdir(join(root,'src/data'),{recursive:true});await mkdir(join(root,'.local'));
 await writeFile(target,original);await writeFile(preview,original);
 try{await fn({root,target,source,preview,original});}finally{await rm(root,{recursive:true,force:true});}
}
test('export paths accept quotes and escaped spaces without shell evaluation',()=>{
 assert.equal(exportPath('"/tmp/fresh export (2).json"'),'/tmp/fresh export (2).json');
 assert.equal(exportPath('/tmp/fresh\\ export\\ (2).json'),'/tmp/fresh export (2).json');
 assert.equal(exportPath('/tmp/$(not-a-command).json'),'/tmp/$(not-a-command).json');
 assert.throws(()=>exportPath('relative.json'));assert.throws(()=>exportPath('/tmp/database.sql'));
});
test('change summary includes full-text changes, additions, removals and unchanged records',()=>{
 const before=snapshot([record('A'),record('B'),record('C')]),after=snapshot([record('A'),record('B'),record('D')]);
 after.segments.push({record_id:'B',locator:'PDF page 1',content:'New text.'});
 const change=summarizeChanges(validateArchive(before),validateArchive(after));
 assert.deepEqual(change.added.map(r=>r.id),['D']);assert.deepEqual(change.removed.map(r=>r.id),['C']);
 assert.deepEqual(change.changed.map(r=>r.id),['B']);assert.equal(change.unchanged,1);
});
test('confirmed preparation updates both local snapshots and explains the next steps',async()=>fixture(async f=>{
 const data=snapshot([record('KEEP','Updated title'),record('NEW')]);await writeFile(f.source,JSON.stringify(data));
 const answers=['"'+f.source+'"','PREPARE SEARCH CHANGES'],messages=[];
 const result=await prepareSearchRecords(f.root,{ask:async()=>answers.shift(),log:m=>messages.push(m)});
 assert.equal(result.cancelled,false);assert.equal(result.records,2);
 assert.deepEqual(JSON.parse(await readFile(f.target,'utf8')),data);
 assert.equal(await readFile(f.preview,'utf8'),await readFile(f.target,'utf8'));
 assert.ok(messages.some(m=>m.includes('Remove from website: 1')));
 assert.ok(messages.some(m=>m.includes('LIVE WEBSITE HAS NOT CHANGED')));
 assert.ok(messages.some(m=>m.includes('02 Check → 03 Commit')));
}));
test('blank input and rejected confirmation leave both files unchanged',async()=>fixture(async f=>{
 await writeFile(f.source,JSON.stringify(snapshot([record('NEW')])));
 for(const answers of [[''],[f.source,'no']]){
  const result=await prepareSearchRecords(f.root,{ask:async()=>answers.shift(),log:()=>{}});
  assert.equal(result.cancelled,true);
  assert.equal(await readFile(f.target,'utf8'),f.original);assert.equal(await readFile(f.preview,'utf8'),f.original);
 }
}));
test('unapproved records and backup/private fields are rejected before confirmation',async()=>fixture(async f=>{
 for(const invalid of [snapshot([{...record('BAD'),state:'draft'}]),{...snapshot([]),private_backup:'not allowed'}]){
  await writeFile(f.source,JSON.stringify(invalid));let prompts=0;
  await assert.rejects(prepareSearchRecords(f.root,{ask:async()=>{prompts++;return f.source;},log:()=>{}}));
  assert.equal(prompts,1);assert.equal(await readFile(f.target,'utf8'),f.original);
  assert.equal(await readFile(f.preview,'utf8'),f.original);
 }
}));
test('empty collection requires explicit remove-all confirmation',async()=>fixture(async f=>{
 await writeFile(f.source,JSON.stringify(snapshot([])));
 for(const phrase of ['PREPARE SEARCH CHANGES','REMOVE ALL SEARCH RECORDS']){
  const answers=[f.source,phrase];const result=await prepareSearchRecords(f.root,{ask:async()=>answers.shift(),log:()=>{}});
  assert.equal(result.cancelled,phrase!=='REMOVE ALL SEARCH RECORDS');
 }
 assert.deepEqual(JSON.parse(await readFile(f.target,'utf8')).records,[]);
}));
test('changes made during review abort preparation rather than overwrite newer data',async()=>fixture(async f=>{
 await writeFile(f.source,JSON.stringify(snapshot([record('NEW')])));let prompts=0;
 await assert.rejects(prepareSearchRecords(f.root,{ask:async()=>{
  if(++prompts===1)return f.source;
  await writeFile(f.source,JSON.stringify(snapshot([record('CHANGED-LATER')])));return 'PREPARE SEARCH CHANGES';
 },log:()=>{}}),/changed during review/);
 assert.equal(await readFile(f.target,'utf8'),f.original);assert.equal(await readFile(f.preview,'utf8'),f.original);
}));
