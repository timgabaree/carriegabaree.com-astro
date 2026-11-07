import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {readArchive} from '../scripts/archive-data.mjs';
import {archiveDisplay} from '../scripts/archive-display.mjs';
test('known interviews have distinct dates and correct public identifiers',()=>{
 const records=readArchive();
 assert.equal(records.find(r=>r.id==='AOBJ-0002').title,'Clark Welch and Ray Albin Oral History — August 10, 2007');
 assert.equal(records.find(r=>r.id==='AOBJ-0003').title,'Clark Welch and Ray Albin Oral History — October 1, 2008');
 assert.equal(records.find(r=>r.id==='AOBJ-0006').identifier,'CGDA-0001');
 assert.equal(records.find(r=>r.id==='AOBJ-0006').title,'Walter Mendygral Oral History - Sides A and B');
 assert.ok(records.every(r=>r.identifier));
 assert.deepEqual(archiveDisplay(records,JSON.parse(readFileSync('src/data/pages.json'))),records);
});
