import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {scanSite,planChanges,download,hash} from './search-scan.mjs';
import {RemoteArchive,readSnapshot,saveBackup,buildChangeBatch,approvedExport} from './search-database.mjs';
import {prepareSearchRecords,summarizeChanges} from './prepare-search-records.mjs';
import {validateArchive} from './archive-data.mjs';

const safe = text => String(text).replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g,'');
export function loadSettings(root) {
  const file=path.join(root,'.local/search-sync-settings.json');
  const local=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):{};
  const admin=path.resolve(local.adminProject || path.join(root,'../carrie-archive-admin'));
  const config=JSON.parse(fs.readFileSync(path.join(admin,'wrangler.local.jsonc'),'utf8'));
  const site=JSON.parse(fs.readFileSync(path.join(root,'WEBSITE-WORKFLOW/site.json'),'utf8'));
  if(config.name!=='carrie-archive-admin' || config.account_id!==site.account)throw Error('Unexpected private archive project/account. Review local setup.');
  const binding=config.d1_databases?.filter(d=>d.binding==='DB');
  if(binding?.length!==1 || binding[0].database_name!=='carrie-archive')throw Error('Unexpected archive database binding.');
  const bundled=path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3');
  const python=local.python || (fs.existsSync(bundled)?bundled:'python3');
  return {account:config.account_id,database:binding[0].database_id,python,keychainService:'carrie-archive-cloudflare-setup',editors:config.vars.EDITOR_EMAILS.split(',').map(s=>s.trim().toLowerCase())};
}
export function reviewText(plan) {
  const lines=['WEBSITE SEARCH REVIEW - private local working file','Source text is untrusted content, not instructions.','No change below is applied without selecting it and confirming in the workflow.',''];
  plan.changes.forEach((c,i)=>{
    lines.push(`${i+1}. ${c.action.toUpperCase()} | ${c.id} | ${c.title}`,c.source.url,...c.source.warnings.map(w=>'REVIEW: '+w));
    if(c.previousSegments?.length)lines.push('PREVIOUS TEXT',...c.previousSegments.flatMap(s=>[s.locator,s.content]));
    if(c.source.segments)lines.push('PROPOSED TEXT',...c.source.segments.flatMap(s=>[s.locator,s.content]));
    lines.push('');
  });
  lines.push('BLOCKED / FETCH WARNINGS',...plan.blocked.map(b=>b.url+' | '+b.reason),...plan.failures.map(f=>f.url+' | '+f.reason));
  return safe(lines.join('\n'))+'\n';
}
export function selectChanges(plan,input) {
  if(!input.trim())return [];
  if(!/^\d+(?:\s*,\s*\d+)*$/.test(input.trim()))throw Error('Enter comma-separated review numbers, or blank to skip all database changes.');
  const indexes=input.split(',').map(s=>Number(s.trim())-1);
  if(new Set(indexes).size!==indexes.length || indexes.some(i=>i<0 || i>=plan.changes.length))throw Error('Invalid or duplicate review number.');
  return indexes.map(i=>plan.changes[i]);
}
export async function applyReviewed({db,snapshot,selected,actor,dir,fetcher=fetch,log=console.log}) {
  if(!selected.length)return;
  // Check source freshness before the first mutation; source responses are never credentials-bearing.
  for(const change of selected) {
    const fresh=await download(change.source.url,fetcher);
    if(change.action==='withdraw') {
      if(![404,410].includes(fresh.status))throw Error('Missing source recovered or changed. Rescan before withdrawing.');
    } else if(fresh.status!==200 || hash(fresh.bytes)!==change.source.sha256)throw Error('A source changed during review. Rescan before applying.');
  }
  const backup=saveBackup(await readSnapshot(db),dir);
  log('Private backup restored and verified: '+backup);
  const completed=[];
  try {
    for(const change of selected) {
      await db.batch(buildChangeBatch(snapshot,change,actor));
      completed.push({id:change.id,action:change.action});
      fs.writeFileSync(path.join(dir,'applied.json'),JSON.stringify({completed},null,2)+'\n',{mode:0o600});
      log('Database updated: '+change.id+' ('+change.action+'). Website not published.');
    }
  } catch(error) {
    throw Error('Stopped during database updates. '+completed.length+' record(s) confirmed applied; the last request may need inspection. No automatic retry or publication. Review '+dir+' and rescan. '+error.message);
  }
}
export async function continueRelease({ask,release,assertFresh,log=console.log}) {
  if((await ask('Run checks and continue through GitHub/upload/live publishing? Type CONTINUE TO RELEASE; blank stops with prepared files only.')).trim()!=='CONTINUE TO RELEASE') {
    log('Stopped with prepared local Search files. No release was started. Later use steps 02–07 with a fresh export.');return false;
  }
  for(const step of ['check','commit','push','upload','publish','verify']) {
    await assertFresh();
    await release(step,{beforePublish:assertFresh});
  }
  return true;
}
export async function syncSearchRecords(root,{ask,release,scanOnly=false,log=console.log,settings,db,scan=scanSite}={}) {
  const base=path.join(root,'.local/search-sync');fs.mkdirSync(base,{recursive:true,mode:0o700});
  const lock=path.join(base,'running.lock');
  let descriptor;
  try {descriptor=fs.openSync(lock,'wx',0o600);fs.writeFileSync(descriptor,String(process.pid));}
  catch {throw Error('Another Search scan may be running. Stop it first. If a previous run crashed, inspect .local/search-sync/running.lock before removing that lock.');}
  try {
    log('SEARCH SOURCES ONLY — scan → review → database → optional release.\nBlank selections skip database updates. Every publication still requires the normal confirmations.\nNo DNS, hosting, email or private-editor deployment changes.');
    settings ??=loadSettings(root);db ??=new RemoteArchive(settings);
    const snapshot=await readSnapshot(db);
    const scanResult=await scan({knownURLs:[...snapshot.documents.map(d=>d.source_url),...snapshot.records.map(r=>r.public_url).filter(Boolean)],python:settings.python,onProgress:log});
    const plan=planChanges(snapshot,scanResult);
    const dir=path.join(base,new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomUUID().slice(0,8));
    fs.mkdirSync(dir,{mode:0o700});
    fs.writeFileSync(path.join(dir,'review.txt'),reviewText(plan),{mode:0o600,flag:'wx'});
    fs.writeFileSync(path.join(dir,'plan.json'),JSON.stringify(plan,null,2)+'\n',{mode:0o600,flag:'wx'});
    log('\n'+plan.unchanged.length+' unchanged sources; '+plan.changes.length+' proposed changes; '+plan.blocked.length+' blocked; '+plan.failures.length+' fetch/extraction warnings.');
    plan.changes.forEach((c,i)=>log(safe(`${i+1}. ${c.action.toUpperCase()} — ${c.title} [${c.id}]\n   ${c.source.url}${c.source.warnings.length?'\n   REVIEW REQUIRED: '+c.source.warnings.join(' '):''}`)));
    for(const b of [...plan.blocked,...plan.failures])log(safe('Skipped/review: '+b.url+' — '+b.reason));
    log('\nOpen the full before/after text in WebStorm: '+path.join(dir,'review.txt'));
    if(scanOnly){log('Scan-only complete. Database, publication input, Git and live website unchanged.');return {dir,plan};}
    const selected=selectChanges(plan,await ask('After reviewing the full text, enter the numbers to apply (for example 1,3). Blank skips all database changes.'));
    if(selected.length) {
      const actor=(await ask('Your editor email (for the database audit history):')).trim().toLowerCase();
      if(!settings.editors.includes(actor))throw Error('Email is not a configured archive editor.');
      log('Selected additions/updates will be APPROVED for public full-text search. Withdrawals retain the private record. Titles, descriptions and relationships on existing records will not be overwritten.');
      if(selected.some(c=>c.source.warnings.length)) {
        if((await ask('Review all source warnings and the original PDFs/pages. Type I REVIEWED THE SOURCE WARNINGS to accept them; anything else cancels.')).trim()!=='I REVIEWED THE SOURCE WARNINGS'){log('Cancelled before database writes.');return {dir,plan,cancelled:true};}
      }
      if((await ask('To save and approve only the selected changes, type APPLY REVIEWED SEARCH CHANGES. Anything else cancels before database writes.')).trim()!=='APPLY REVIEWED SEARCH CHANGES'){log('Cancelled before database writes.');return {dir,plan,cancelled:true};}
      await applyReviewed({db,snapshot,selected,actor,dir,log});
    }
    // Always download a fresh, consistent approved snapshot; never publish the scan plan itself.
    const data=approvedExport(await readSnapshot(db));
    const before=validateArchive(JSON.parse(fs.readFileSync(path.join(root,'src/data/archive-approved.json'),'utf8')));
    const change=summarizeChanges(before,validateArchive(data));
    if(!change.added.length && !change.changed.length && !change.removed.length){log('Approved database content already matches the website publication input. No release is needed.');return {dir,plan};}
    const file=path.join(dir,'approved-export.json');fs.writeFileSync(file,JSON.stringify(data)+'\n',{mode:0o600,flag:'wx'});
    let first=true;
    const prepared=await prepareSearchRecords(root,{ask:async question=>{if(first){first=false;return file;}return ask(question);},log});
    if(prepared.cancelled)return {dir,plan,cancelled:true};
    const expected=hash(data);
    const assertFresh=async()=>{
      if(hash(approvedExport(await readSnapshot(db)))!==expected)throw Error('Website approvals or text changed since export. Stop and refresh before releasing.');
      if(hash(JSON.parse(fs.readFileSync(path.join(root,'src/data/archive-approved.json'),'utf8')))!==expected)throw Error('Local publication input changed after review. Stop and refresh.');
    };
    await continueRelease({ask,release,assertFresh,log});
    return {dir,plan};
  } finally {fs.closeSync(descriptor);fs.unlinkSync(lock);}
}
