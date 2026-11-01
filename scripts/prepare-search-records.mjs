// Local-only preparation. No network, database writes, Git commands or deployment.
import {readFile,stat,mkdir,writeFile,rename,rm} from 'node:fs/promises';
import {resolve,isAbsolute,join} from 'node:path';
import {homedir} from 'node:os';
import {randomUUID,createHash} from 'node:crypto';
import {validateArchive} from './archive-data.mjs';

export const searchInstructions=`SEARCH RECORDS ONLY — optional preparation, not a live update

Use this only when adding, changing or removing records in website Search.
Skip it for normal website wording, design or code changes.

1. In the private editor, approve new/changed records, or withdraw website approval.
2. Click “Download approved website data” AFTER your changes. Use the newest download.
3. Paste that file's full path below. Quoted paths and spaces are supported.
   Use the complete approved collection, not a database backup or individual record.
4. Review the additions, changes and removals, then confirm preparation.

This replaces the local website snapshot and prepares the same data for preview.
It does NOT change the database, commit, upload, publish, or change DNS.
Blank input or an incorrect confirmation cancels without changing either snapshot.
If this Run console cannot accept typing, use WebStorm Terminal:
  nvm use
  npm run site:search-records
`;

export function exportPath(input){
 let value=input.trim();
 if((value.startsWith('"')&&value.endsWith('"'))||(value.startsWith("'")&&value.endsWith("'")))value=value.slice(1,-1);
 // Accept the escaped spaces produced by dragging a file into a terminal. Never evaluate shell input.
 value=value.replace(/\\([ ()])/g,'$1');
 if(value.startsWith('~/'))value=join(homedir(),value.slice(2));
 if(!isAbsolute(value)||!value.endsWith('.json'))throw Error('Paste the full path to the downloaded .json file.');
 return resolve(value);
}

export function summarizeChanges(before,after){
 const old=new Map(before.map(r=>[r.id,r])),next=new Map(after.map(r=>[r.id,r]));
 return {
  added:after.filter(r=>!old.has(r.id)),
  removed:before.filter(r=>!next.has(r.id)),
  changed:after.filter(r=>old.has(r.id)&&JSON.stringify(old.get(r.id))!==JSON.stringify(r)),
  unchanged:after.filter(r=>old.has(r.id)&&JSON.stringify(old.get(r.id))===JSON.stringify(r)).length,
 };
}
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
async function atomicWrite(file,content){
 const temporary=file+'.'+randomUUID()+'.tmp';
 try{await writeFile(temporary,content,{mode:0o600,flag:'wx'});await rename(temporary,file);}
 finally{await rm(temporary,{force:true});}
}

export async function prepareSearchRecords(root,{ask,log=console.log}={}){
 log(searchInstructions);
 const input=await ask('Full path to the fresh approved website export (blank cancels):');
 if(!input.trim()){log('Cancelled. No files changed.');return {cancelled:true};}
 const source=exportPath(input),target=resolve(root,'src/data/archive-approved.json');
 if(source===target)throw Error('Choose the fresh download, not the website snapshot already in the project.');
 const info=await stat(source);
 if(!info.isFile()||info.size>64*1024*1024)throw Error('Choose an approved JSON export smaller than 64 MB.');
 const raw=await readFile(source,'utf8');
 let data;try{data=JSON.parse(raw);}catch{throw Error('The selected file is not valid JSON. Download approved website data again.');}
 const after=validateArchive(data),previous=await readFile(target,'utf8'),before=validateArchive(JSON.parse(previous));
 const changes=summarizeChanges(before,after);
 log(`\nExport file modified: ${info.mtime.toLocaleString()} (confirm this is your fresh download).`);
 log(`Current website snapshot: ${before.length} records. New snapshot: ${after.length} records.`);
 for(const [label,records] of [['Add',changes.added],['Change',changes.changed],['Remove from website',changes.removed]]){
  log(`${label}: ${records.length}`);
  for(const r of records.slice(0,20))log('  '+r.id+' — '+r.title.replace(/[\r\n\t\x1b]/g,' '));
  if(records.length>20)log(`  …and ${records.length-20} more. Review the snapshot diff before committing.`);
 }
 log(`Unchanged: ${changes.unchanged}`);
 log('Removals take effect only after publishing. Private database records are not deleted.');
 const phrase=after.length===0?'REMOVE ALL SEARCH RECORDS':'PREPARE SEARCH CHANGES';
 if(after.length===0)log('WARNING: This export is empty. Publishing it will remove EVERY record from website Search.');
 if((await ask(`Type exactly "${phrase}" to prepare these local changes (anything else cancels):`)).trim()!==phrase){
  log('Cancelled. No files changed.');return {cancelled:true};
 }
 if(digest(await readFile(target))!==digest(previous)||digest(await readFile(source))!==digest(raw))throw Error('A file changed during review. Run this step again with the latest export.');
 const local=resolve(root,'.local');await mkdir(local,{recursive:true,mode:0o700});
 const content=JSON.stringify(data)+'\n';
 // Write preview first: a failure cannot silently promote unpreviewable content.
 await atomicWrite(join(local,'archive-approved.json'),content);
 await atomicWrite(target,content);
 log(`\nPrepared ${after.length} approved records locally. THE LIVE WEBSITE HAS NOT CHANGED.`);
 log('Optional: run 10 - Preview approved archive search (local only), then open /search.');
 log('Next: 02 Check → 03 Commit → 04 Push → 05 Upload → 06 Publish → 07 Verify.');
 log('Stop if any step fails. Only 06 publishes. Review all files listed by 03 before committing.');
 return {cancelled:false,records:after.length,changes};
}
