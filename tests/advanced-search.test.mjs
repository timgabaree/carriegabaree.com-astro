import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {readAdvanced,advancedParams,hasPhrase,searchAdvanced} from '../public/js/advanced-search.js';
import {buildAdvancedSearch} from '../scripts/advanced-search-data.mjs';
const record=(id,texts,kind='Publication')=>({id,url:'/search/'+id,title:id,kind,summary:'',subjects:[],segments:texts.map(content=>({locator:'Page',content}))});
const query=patch=>({all:'',any:'',phrase:'',exclude:'',type:'',scope:'passage',...patch});
const ids=(records,q)=>searchAdvanced(records,query(q)).map(r=>r.id);
test('AND stays in one passage by default; document scope allows separate passages',()=>{
 const records=[record('split',['Bombs fell.','Armor was useful.']),record('together',['Bombing damaged armor.'])];
 assert.deepEqual(ids(records,{all:'bomb armor'}),['together']);
 assert.deepEqual(ids(records,{all:'bomb armor',scope:'document'}),['split','together']);
 assert.deepEqual(ids([record('bomb',['bomb']),record('armor',['armor'])],{all:'bomb armor',scope:'site'}),[]);
});
test('AND OR phrase and NOT combine, with scope-specific exclusion boundaries',()=>{
 const records=[record('A',['Bombs and body armor.','Training.']),record('B',['Bombs and helmets.']),record('C',['Body armor training.'])];
 assert.deepEqual(ids(records,{all:'bomb',any:'armor helmet',phrase:'body armor',exclude:'training'}),['A']);
 assert.deepEqual(ids(records,{all:'bomb',any:'armor helmet',phrase:'body armor',exclude:'training',scope:'document'}),[]);
 assert.deepEqual(ids(records,{any:'helmet armor',exclude:'bomb'}),['C']);
});
test('exact phrases ignore case and whitespace, not punctuation, boundaries or passage divisions',()=>{
 assert.ok(hasPhrase('BODY\n  ARMOR','body armor'));assert.equal(hasPhrase('embody armor','body armor'),false);
 assert.equal(hasPhrase('body armored','body armor'),false);assert.equal(hasPhrase('body, armor','body armor'),false);
 assert.deepEqual(ids([record('split',['body','armor'])],{phrase:'body armor',scope:'document'}),[]);
 assert.deepEqual(ids([record('unicode',['Musée Gabaree'])],{phrase:'musée gabaree'}),['unicode']);
});
test('site includes pages, preserves type filters and never combines different documents',()=>{
 const records=[record('archive',['museum']),record('home',['museum'],'Website page')];
 assert.deepEqual(ids(records,{all:'museum'}),['archive']);
 assert.deepEqual(ids(records,{all:'museum',scope:'site'}),['archive','home']);
 assert.deepEqual(ids(records,{all:'museum',scope:'site',type:'Publication'}),['archive']);
});
test('document metadata is searchable; passage matches and exclusions are accurately selected',()=>{
 const r=record('Museum',['armor only','bombing armor','training']);
 assert.deepEqual(ids([r],{all:'museum',scope:'passage'}),[]);assert.deepEqual(ids([r],{all:'museum',scope:'document'}),['Museum']);
 assert.deepEqual(searchAdvanced([r],query({all:'bomb armor'}))[0].matching,[1]);
 assert.deepEqual(ids([r],{exclude:'training',scope:'document'}),[]);
 assert.deepEqual(ids([r],{}),['Museum']);
});
test('advanced URL state roundtrips, clamps inputs and rejects unknown scopes',()=>{
 const q=query({all:'bomb',any:'armor helmet',phrase:'body armor',exclude:'training',scope:'site',type:'Publication'});
 assert.deepEqual(readAdvanced(advancedParams(q)),q);
 assert.equal(readAdvanced(new URLSearchParams({q:'a'.repeat(500),scope:'evil'})).all.length,200);
 assert.equal(readAdvanced(new URLSearchParams({scope:'evil'})).scope,'passage');
 assert.doesNotThrow(()=>ids([record('A',['<script> hello'])],{all:'[(.*)]'}));
});
test('advanced dataset includes approved public fields and content pages only, with no forms or private pages',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'advanced-search-test-'));
 try{
  await writeFile(join(dir,'index.html'),'<main><h1>Museum</h1><p>Public history</p><form>FORM SECRET</form><script>CODE</script><nav>NAV</nav></main>');
  const r={...record('approved',['Reviewed text']),private_note:'DO NOT EXPORT'};
  const result=await buildAdvancedSearch([r],dir,[{slug:'',title:'Home'},{slug:'thank-you'},{slug:'portfolio/transcript'},{slug:'private',noindex:true}]);
  assert.equal(result.length,2);assert.equal(result[0].segments[0].content,'Reviewed text');
  const json=await readFile(join(dir,'archive-index/advanced-search.json'),'utf8');
  assert.doesNotMatch(json,/DO NOT EXPORT|FORM SECRET|CODE|NAV|private_note/);
  assert.match(result[1].segments[0].content,/Museum Public history/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
