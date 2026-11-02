import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {parse} from 'node-html-parser';

const interviews=[
 ['0001-nicole-smith','Tarasuk'],
 ['0002-clark-welch-ray-albin','Tarasuk'],
 ['0003-clark-welch-ray-albin','Tarasuk'],
 ['0004-shannon-morgan','Gutierrez'],
 ['0005-erica-koelder','Gutierrez'],
];
test('transcript interviewer names retain the interview-specific surname',()=>{
 const data=JSON.parse(fs.readFileSync(new URL('../src/data/archive-approved.json',import.meta.url),'utf8'));
 for(const [id,surname] of interviews){
  const html=fs.readFileSync(new URL(`../src/content/pages/portfolio__oralhistories__CORHC-${id}-transcript.astro`,import.meta.url),'utf8');
  const doc=parse(html),speakers=doc.querySelectorAll('.speaker').map(e=>e.textContent).filter(s=>s.startsWith('Carrie'));
  assert.ok(speakers.length>0);assert.ok(speakers.every(s=>s===`Carrie Gabaree (${surname})`));
  const text=doc.querySelectorAll('.transcript-line').map(e=>e.textContent).join('\n');
  assert.ok(text.includes('Carrie '+surname));assert.doesNotMatch(text,/Carrie (?:Tarassi(?:c)?|Guterres)\b/);
  const searchText=data.segments.filter(s=>s.record_id==='AOBJ-'+id.slice(0,4)).map(s=>s.content).join('\n');
  assert.ok(searchText.includes('Carrie '+surname));assert.doesNotMatch(searchText,/Carrie (?:Tarassi(?:c)?|Guterres)\b/);
 }
});
