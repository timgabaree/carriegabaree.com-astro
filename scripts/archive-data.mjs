import {readFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
export const emptyArchive={schema_version:2,records:[],segments:[],subjects:[]};
function exact(value,keys){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join()!==[...keys].sort().join())throw Error('Unexpected archive fields. Use the approved-data export, not a database backup.');}
function text(value,max){if(typeof value!=='string'||value.length>max)throw Error('Invalid archive text.');return value;}
export function validateArchive(data){
 exact(data,['schema_version','records','segments','subjects']);
 if(data.schema_version!==2||![data.records,data.segments,data.subjects].every(Array.isArray)||data.records.length>10000)throw Error('Unsupported archive export.');
 const seen=new Map();
 const records=data.records.map(r=>{
  exact(r,['id','title','kind','summary','public_url','state','rights_review']);
  if(r.state!=='ready'||r.rights_review!=='approved')throw Error('Every exported record must be explicitly approved for the website.');
  if(typeof r.id!=='string'||!(/^[a-zA-Z0-9_-]{1,100}$/).test(r.id)||seen.has(r.id))throw Error('Invalid or duplicate record ID.');
  const title=text(r.title,500);if(!title.trim())throw Error('A title is required.');
  const kinds={'Oral History':'Oral history',oral_history:'Oral history',interview:'Oral history',publication:'Publication',archival_item:'Archival item'};
  const kind=Object.hasOwn(kinds,r.kind)?kinds[r.kind]:null;if(!kind)throw Error('Unrecognized archive record type.');
  let sourceUrl='';
  if(r.public_url){const u=new URL(text(r.public_url,2000));if(u.origin!=='https://carriegabaree.com'||u.username||u.password||u.search||u.hash||u.pathname.startsWith('/api/'))throw Error('Review the public source link before exporting. Only clean public website links are accepted.');sourceUrl=u.href;}
  else if(r.public_url!==null&&r.public_url!=='')throw Error('Invalid public source link.');
  const record={id:r.id,title,kind,summary:text(r.summary,10000),sourceUrl,subjects:[],segments:[]};seen.set(r.id,record);return record;
 });
 for(const s of data.subjects){exact(s,['record_id','label']);const r=seen.get(s.record_id);if(!r)throw Error('Subject belongs to an unapproved record.');r.subjects.push(text(s.label,500));}
 for(const s of data.segments){exact(s,['record_id','locator','content']);const r=seen.get(s.record_id);if(!r)throw Error('Text belongs to an unapproved record.');r.segments.push({locator:text(s.locator,500),content:text(s.content,20000)});}
 return records;
}
export function readPreviewArchive(){
 if(process.env.ARCHIVE_PREVIEW!=='1')return [];
 if(process.env.PUBLIC_SITE_ENV==='production')throw Error('Archive preview cannot be included in a production build.');
 // Astro bundles this module into a different directory during static rendering.
 // Both Astro and the preview command run from the project root.
 const file=resolve(process.cwd(),'.local/archive-approved.json');
 return validateArchive(existsSync(file)?JSON.parse(readFileSync(file,'utf8')):emptyArchive);
}
export function readArchive(){
 if(process.env.ARCHIVE_PREVIEW==='1')return readPreviewArchive();
 // Published input is versioned with the site. Missing input fails the build closed.
 return validateArchive(JSON.parse(readFileSync(resolve(process.cwd(),'src/data/archive-approved.json'),'utf8')));
}
