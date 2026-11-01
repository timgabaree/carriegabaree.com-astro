// Private maintenance client. Credentials are read from Keychain into memory only.
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {hash} from './search-scan.mjs';
import {validateArchive} from './archive-data.mjs';

const identifier = name => {
  if(!/^[a-z][a-z0-9_]*$/i.test(name)) throw Error('Unexpected database identifier.');
  return '"'+name+'"';
};
export class RemoteArchive {
  constructor(config) {
    if(!/^[a-f0-9]{32}$/.test(config.account) || !/^[a-f0-9-]{36}$/.test(config.database)) throw Error('Invalid archive database configuration.');
    this.config=config;this.token=null;
  }
  async batch(batch) {
    if(!this.token) {
      try {this.token=execFileSync('/usr/bin/security',['find-generic-password','-s',this.config.keychainService,'-a','api-token','-w'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();}
      catch {throw Error('Archive setup credential is unavailable in Keychain. No credential is stored in the project.');}
    }
    const response=await fetch(`https://api.cloudflare.com/client/v4/accounts/${this.config.account}/d1/database/${this.config.database}/query`,{
      method:'POST',headers:{Authorization:'Bearer '+this.token,'Content-Type':'application/json'},body:JSON.stringify({batch}),signal:AbortSignal.timeout(90000)
    });
    let data;try{data=await response.json();}catch{throw Error('Database response was unreadable. Stop and inspect state before retrying.');}
    if(!response.ok || !data.success || !Array.isArray(data.result) || data.result.length!==batch.length || data.result.some(r=>r.success!==true)) {
      throw Error('Database request failed (HTTP '+response.status+'). Details withheld to protect private data. Stop and rescan before retrying.');
    }
    return data.result.map(r=>r.results);
  }
}
export async function readSnapshot(db) {
  const [schema]=await db.batch([{sql:"SELECT type,name,tbl_name,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name NOT LIKE 'd1_%' ORDER BY type,name"}]);
  const tables=schema.filter(s=>s.type==='table');
  if(!tables.some(t=>t.name==='records') || !tables.some(t=>t.name==='text_segments') || tables.length>40) throw Error('Unexpected archive schema.');
  const rows=await db.batch(tables.map(t=>({sql:'SELECT * FROM '+identifier(t.name)+' ORDER BY rowid'})));
  const snapshot={schema};tables.forEach((t,i)=>{snapshot[t.name]=rows[i];});
  return snapshot;
}
export function saveBackup(snapshot,dir) {
  fs.mkdirSync(dir,{recursive:true,mode:0o700});
  const json=JSON.stringify(snapshot);
  fs.writeFileSync(path.join(dir,'database-before.json'),json+'\n',{mode:0o600,flag:'wx'});
  const destination=path.join(dir,'database-before.sqlite');
  if(fs.existsSync(destination)) throw Error('Backup destination exists.');
  fs.writeFileSync(destination,'',{mode:0o600,flag:'wx'});
  const restored=new DatabaseSync(destination);
  try {
    restored.exec('PRAGMA foreign_keys=OFF; BEGIN');
    for(const table of snapshot.schema.filter(s=>s.type==='table')) {
      restored.exec(table.sql);
      const rows=snapshot[table.name];if(!rows.length)continue;
      const columns=Object.keys(rows[0]);
      const insert=restored.prepare('INSERT INTO '+identifier(table.name)+' ('+columns.map(identifier).join(',')+') VALUES('+columns.map(()=>'?').join(',')+')');
      for(const row of rows)insert.run(...columns.map(c=>row[c]));
    }
    for(const entry of snapshot.schema.filter(s=>s.type!=='table'))restored.exec(entry.sql);
    restored.exec('COMMIT; PRAGMA foreign_keys=ON;');
    if(restored.prepare('PRAGMA integrity_check').get().integrity_check!=='ok' || restored.prepare('PRAGMA foreign_key_check').all().length)throw Error('Backup restoration check failed.');
    for(const table of snapshot.schema.filter(s=>s.type==='table')) {
      const actual=restored.prepare('SELECT * FROM '+identifier(table.name)+' ORDER BY rowid').all();
      if(hash(actual)!==hash(snapshot[table.name]))throw Error('Backup row comparison failed.');
    }
  } finally {restored.close();}
  fs.writeFileSync(path.join(dir,'backup-verification.json'),JSON.stringify({restored:true,sha256:hash(json)},null,2)+'\n',{mode:0o600,flag:'wx'});
  return destination;
}
function guard(table,rows,where,params=[]) {
  // A failed guard aborts the complete D1 batch. Zero-row UPDATE alone is not enough.
  const columns=rows.length?Object.keys(rows[0]):[];
  if(!rows.length)return {sql:`SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM ${identifier(table)} WHERE ${where}) THEN 1 ELSE abs(-9223372036854775808) END`,params};
  const expression='json_object('+columns.map(c=>"'"+c+"',"+identifier(c)).join(',')+')';
  return {sql:`SELECT CASE WHEN (SELECT json_group_array(${expression}) FROM (SELECT * FROM ${identifier(table)} WHERE ${where} ORDER BY rowid))=? THEN 1 ELSE abs(-9223372036854775808) END`,params:[...params,JSON.stringify(rows)]};
}
export function buildChangeBatch(snapshot,change,actor,now=new Date().toISOString()) {
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(actor))throw Error('An editor email is required for the audit trail.');
  if(!['add','update','withdraw'].includes(change.action))throw Error('Unknown catalog action.');
  const id=change.id;
  const record=snapshot.records.find(r=>r.id===id);
  if(change.action==='add' ? !!record : !record)throw Error('Record state no longer matches the reviewed plan.');
  if(record?.rights_review==='restricted')throw Error('Restricted records cannot be approved by the scanner.');
  const docs=snapshot.documents.filter(d=>d.record_id===id);
  const segments=snapshot.text_segments.filter(t=>docs.some(d=>d.id===t.document_id));
  const batch=[guard('records',record?[record]:[],'id=?',[id]),guard('documents',docs,'record_id=?',[id]),guard('text_segments',segments,'document_id IN (SELECT id FROM documents WHERE record_id=?)',[id])];
  if(change.action==='withdraw') {
    batch.push({sql:"UPDATE records SET state='draft',rights_review='pending',revision=revision+1,updated_at=?,updated_by=? WHERE id=?",params:[now,actor,id]});
    return batch;
  }
  const source=change.source;
  if(!source?.segments?.length || Buffer.byteLength(JSON.stringify(source.segments))>1500000)throw Error('Invalid or oversized extracted text.');
  if(change.action==='add')batch.push({sql:"INSERT INTO records(id,kind,title,summary,public_url,state,rights_review,updated_at,updated_by,source_json) VALUES(?,?,?,'',?,'ready','approved',?,?,?)",params:[id,source.kind,change.title,source.url,now,actor,JSON.stringify({created_via:'reviewed-website-scan',source_url:source.url,created_at:now,created_by:actor})]});
  else batch.push({sql:"UPDATE records SET public_url=COALESCE(NULLIF(public_url,''),?),state='ready',rights_review='approved',revision=revision+1,updated_at=?,updated_by=? WHERE id=?",params:[source.url,now,actor,id]});
  const document=change.document;
  if(document && (document.record_id!==id || !docs.some(d=>d.id===document.id)))throw Error('Document does not belong to the reviewed record.');
  const docId=document?.id || id+'-website-text';
  if(document) {
    batch.push({sql:'DELETE FROM text_segments WHERE document_id=?',params:[docId]});
    batch.push({sql:'UPDATE documents SET sha256=?,review_note=?,source_page_count=? WHERE id=?',params:[source.sha256,'Website scan reviewed by '+actor+' at '+now,String(source.pageCount),docId]});
  } else batch.push({sql:'INSERT INTO documents(id,record_id,kind,source_url,sha256,review_note,source_page_count) VALUES(?,?,?,?,?,?,?)',params:[docId,id,source.documentKind,source.url,source.sha256,'Website scan reviewed by '+actor+' at '+now,String(source.pageCount)]});
  batch.push({sql:"INSERT INTO text_segments(document_id,ordinal,locator,content) SELECT ?,CAST(key AS INTEGER)+1,json_extract(value,'$.locator'),json_extract(value,'$.content') FROM json_each(?)",params:[docId,JSON.stringify(source.segments)]});
  return batch;
}
export function approvedExport(snapshot) {
  const records=snapshot.records.filter(r=>r.state==='ready' && r.rights_review==='approved').sort((a,b)=>a.id.localeCompare(b.id)).map(({id,title,kind,summary,public_url,state,rights_review})=>({id,title,kind,summary,public_url,state,rights_review}));
  const ids=new Set(records.map(r=>r.id));const documents=snapshot.documents.filter(d=>ids.has(d.record_id)).sort((a,b)=>a.id.localeCompare(b.id));
  const segments=documents.flatMap(d=>snapshot.text_segments.filter(t=>t.document_id===d.id).sort((a,b)=>a.ordinal-b.ordinal).map(({locator,content})=>({record_id:d.record_id,locator,content})));
  const subjects=snapshot.record_subjects.filter(r=>ids.has(r.record_id)).map(r=>({record_id:r.record_id,label:snapshot.subjects.find(s=>s.id===r.subject_id)?.label})).sort((a,b)=>a.record_id.localeCompare(b.record_id)||a.label.localeCompare(b.label));
  const data={schema_version:2,records,segments,subjects};validateArchive(data);return data;
}
