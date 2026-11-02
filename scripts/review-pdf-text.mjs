import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {RemoteArchive,readSnapshot,saveBackup,guard,approvedExport} from './search-database.mjs';
import {loadSettings,selectChanges} from './sync-search-records.mjs';
import {download,hash} from './search-scan.mjs';
import {rawSegments,effectiveSegments,validateReadingText,proposeReadingText} from './reviewed-text.mjs';
import {prepareSearchRecords} from './prepare-search-records.mjs';

export function reviewBatch(snapshot,document,cleaned,actor,now=new Date().toISOString()) {
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(actor))throw Error('An editor email is required.');
  const record=snapshot.records.find(r=>r.id===document.record_id);
  if(!record || !['publication','transcript'].includes(document.kind))throw Error('Choose an existing publication or transcript.');
  const raw=rawSegments(snapshot,document.id);validateReadingText(raw,cleaned);
  const previous=snapshot.text_reviews?.filter(r=>r.document_id===document.id)||[];
  return [
    guard('records',[record],'id=?',[record.id]),
    guard('documents',[document],'id=?',[document.id]),
    guard('text_segments',snapshot.text_segments.filter(t=>t.document_id===document.id),'document_id=?',[document.id]),
    guard('text_reviews',previous,'document_id=?',[document.id]),
    {sql:`INSERT INTO text_reviews(document_id,source_sha256,raw_json,cleaned_json,revision,reviewed_at,reviewed_by) VALUES(?,?,?,?,1,?,?)
      ON CONFLICT(document_id) DO UPDATE SET source_sha256=excluded.source_sha256,raw_json=excluded.raw_json,cleaned_json=excluded.cleaned_json,revision=text_reviews.revision+1,reviewed_at=excluded.reviewed_at,reviewed_by=excluded.reviewed_by`,params:[document.id,document.sha256,JSON.stringify(raw),JSON.stringify(cleaned),now,actor]},
    {sql:'UPDATE records SET revision=revision+1,updated_at=?,updated_by=? WHERE id=?',params:[now,actor,record.id]},
  ];
}
export async function installReviewSchema(db,_root,snapshot) {
  if(snapshot.text_reviews)return;
  const sql=fs.readFileSync(fileURLToPath(new URL('./reviewed-text-schema.sql',import.meta.url)),'utf8');
  await db.batch(sql.split(/\n(?=CREATE (?:TABLE|TRIGGER|VIEW) )/).filter(sql=>/CREATE (?:TABLE|TRIGGER|VIEW) /.test(sql)).map(sql=>({sql})));
}
export async function reviewPDFText(root,{ask,log=console.log,db,settings}={}) {
  settings??=loadSettings(root);db??=new RemoteArchive(settings);
  const snapshot=await readSnapshot(db);
  const docs=snapshot.documents.filter(d=>d.kind==='publication' && rawSegments(snapshot,d.id).length);
  log('PDF TEXT ONLY — proposes reading text, keeps original extraction/PDFs, and never publishes.\nReview each page against its PDF. Paragraph detection is conservative; hyphenated line endings need human review.\nExisting reviewed text is retained as the starting point. Edit only content in the candidate JSON.');
  docs.forEach((d,i)=>log(`${i+1}. ${snapshot.records.find(r=>r.id===d.record_id)?.title} [${d.id}]`));
  const selected=selectChanges({changes:docs},await ask('Choose publication numbers, separated by commas. Blank cancels.'));
  if(!selected.length)return {cancelled:true};
  const dir=path.join(root,'.local/pdf-text-review',new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomUUID().slice(0,8));
  fs.mkdirSync(dir,{recursive:true,mode:0o700});
  const candidates=[];
  for(const document of selected) {
    const source=await download(document.source_url);
    if(source.status!==200 || hash(source.bytes)!==document.sha256)throw Error('Source PDF changed. Do not apply old text corrections; reconcile its raw extraction first.');
    const raw=rawSegments(snapshot,document.id);
    const previous=snapshot.text_reviews?.some(e=>e.document_id===document.id);
    const proposed=previous?{segments:effectiveSegments(snapshot,document),joined:0,hyphenBreaks:0}:proposeReadingText(raw,source.bytes,settings.python);
    const file=path.join(dir,document.id+'.json');
    fs.writeFileSync(file,JSON.stringify(proposed.segments,null,2)+'\n',{mode:0o600,flag:'wx'});
    fs.writeFileSync(path.join(dir,document.id+'-review.txt'),raw.map((s,i)=>`${s.locator}\nORIGINAL EXTRACTION\n${s.content}\n\nPROPOSED READING TEXT\n${proposed.segments[i].content}\n`).join('\n'),{mode:0o600,flag:'wx'});
    candidates.push({document,file});
    log(`${document.id}: ${proposed.joined} printed line breaks joined; ${proposed.hyphenBreaks} ambiguous hyphen breaks retained. ${previous?'Starting from the existing reviewed edition.':''}\nEdit/review: ${file}\nOriginal PDF: ${document.source_url}`);
  }
  const actor=(await ask('Your configured editor email for the review history:')).trim().toLowerCase();
  if(!settings.editors.includes(actor))throw Error('Email is not a configured editor.');
  if((await ask('Compare the complete candidate with the PDF; edit its content if needed. Type SAVE REVIEWED PDF TEXT to save the separate reading edition. Blank cancels. This does not approve private records or publish the site.')).trim()!=='SAVE REVIEWED PDF TEXT')return {cancelled:true,dir};
  // Read edits only after confirmation. Validate all candidates before any writes.
  const edits=candidates.map(c=>({...c,cleaned:validateReadingText(rawSegments(snapshot,c.document.id),JSON.parse(fs.readFileSync(c.file,'utf8')))}));
  for(const {document} of edits) {
    const fresh=await download(document.source_url);
    if(fresh.status!==200 || hash(fresh.bytes)!==document.sha256)throw Error('PDF changed during review. Cancelled before writes.');
  }
  const backup=saveBackup(await readSnapshot(db),dir);log('Private backup restored and verified: '+backup);
  await installReviewSchema(db,root,snapshot);
  // One batch for all selections: either every reviewed edition is saved or none is.
  await db.batch(edits.flatMap(c=>reviewBatch(snapshot,c.document,c.cleaned,actor)));
  const data=approvedExport(await readSnapshot(db));
  const file=path.join(dir,'approved-export.json');fs.writeFileSync(file,JSON.stringify(data)+'\n',{mode:0o600,flag:'wx'});
  let first=true;
  await prepareSearchRecords(root,{ask:async q=>{if(first){first=false;return file;}return ask(q);},log});
  log('Reviewed database text saved. Original PDFs/raw text preserved. Local Search files require preview/checks and steps 03–07 to release. Nothing was published.');
  return {dir};
}
