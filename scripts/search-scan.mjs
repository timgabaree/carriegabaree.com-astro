// Public-source discovery only. Never follows other hosts or generated search pages.
import {parse} from 'node-html-parser';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {effectiveSegments} from './reviewed-text.mjs';

export const origin = 'https://carriegabaree.com';
export const hash = value => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex');
const excluded = /^\/(?:search|archive|archive-index|api|cdn-cgi|sitemap|privacy|contact|thank-you|thankyou)(?:[/.]|$)/i;
export function sourceURL(value, base = origin) {
  try {
    if(typeof value!=='string' || !value.trim())return null;
    const u = new URL(value, base);
    if (u.origin !== origin || u.username || u.password || u.search || /%(?:2f|5c|2e)/i.test(u.pathname)) return null;
    u.hash = '';
    if (excluded.test(u.pathname) || /\.(?!pdf$|html$)[a-z0-9]{1,8}$/i.test(u.pathname)) return null;
    return u.href;
  } catch { return null; }
}
export async function download(url, fetcher = fetch) {
  if (!sourceURL(url) && url !== origin + '/sitemap.xml') throw Error('Source URL is outside the public scan scope.');
  let current = url;
  for (let redirects = 0; redirects <= 5; redirects++) {
    const response = await fetcher(current, {redirect:'manual', signal:AbortSignal.timeout(30000), headers:{'User-Agent':'CarrieArchiveSourceReview/1.0'}});
    if ([301,302,303,307,308].includes(response.status)) {
      const next = sourceURL(response.headers.get('location'), current);
      await response.body?.cancel();
      if (!next) throw Error('Redirect left the permitted public source scope.');
      current = next; continue;
    }
    if (!response.ok) { await response.body?.cancel(); return {status:response.status,url:current}; }
    const type = response.headers.get('content-type') || '';
    const chunks=[]; let size=0;
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > 25*1024*1024) throw Error('Source exceeds the 25 MB scan limit.');
      chunks.push(Buffer.from(chunk));
    }
    return {status:response.status,url:current,type,bytes:Buffer.concat(chunks)};
  }
  throw Error('Too many source redirects.');
}
export function splitSegments(parts) {
  return parts.flatMap(p => {
    const chars=Array.from(p.content); const rows=[];
    for(let i=0;i<chars.length;i+=8000) rows.push({locator:p.locator,content:chars.slice(i,i+8000).join('')});
    return rows;
  });
}
export function extractHTML(bytes, url) {
  const tree=parse(bytes.toString('utf8'));
  const links=tree.querySelectorAll('a[href]').map(a=>({url:sourceURL(a.getAttribute('href'),url),title:(a.getAttribute('aria-label') || a.textContent).replace(/\s+/g,' ').trim()})).filter(a=>a.url);
  const main=tree.querySelector('main');
  if (!main) throw Error('Page has no main content; manual review required.');
  const title=(main.querySelector('h1')?.textContent || tree.querySelector('title')?.textContent || '').trim();
  const transcript=main.querySelector('.transcript-content');
  let segments=[];
  if(transcript) {
    let speaker='',locator='';
    for(const e of transcript.querySelectorAll('.speaker, .timestamp, .transcript-line')) {
      const text=e.textContent.replace(/\s+/g,' ').trim();
      if(e.classList.contains('speaker')) speaker=text;
      if(e.classList.contains('timestamp')) locator=text;
      if(e.classList.contains('transcript-line') && text) segments.push({locator,content:speaker ? speaker+': '+text : text});
    }
  } else {
    for(const e of main.querySelectorAll('script,style,nav,form,button,[aria-hidden="true"]')) e.remove();
    let heading='Page text';
    for(const e of main.querySelectorAll('h1,h2,h3,h4,p,li,blockquote,td')) {
      // Avoid repeating nested list/paragraph content.
      if(e.querySelector('p,li,blockquote')) continue;
      const content=e.textContent.replace(/\s+/g,' ').trim();
      if(/^H[1-4]$/.test(e.tagName)) heading=content || heading;
      if(content) segments.push({locator:heading.slice(0,500),content});
    }
  }
  if(!title || !segments.length) throw Error('Title or usable main text missing.');
  return {url,title:title.slice(0,500),kind:transcript?'oral_history':'archival_item',documentKind:transcript?'transcript':'web_page',segments:splitSegments(segments),pageCount:1,links,warnings:[],sha256:hash(bytes)};
}
export function extractPDF(bytes, url, title, python) {
  const result=spawnSync(python,[fileURLToPath(new URL('./extract-search-pdf.py',import.meta.url))],{input:bytes,maxBuffer:24*1024*1024,timeout:120000});
  if(result.error || result.status!==0) throw Error('PDF extraction failed. Check the configured Python/pypdf installation or review this PDF manually.');
  const {pages}=JSON.parse(result.stdout.toString());
  const sparse=pages.filter(p=>p.content.trim().length<30).map(p=>p.locator);
  const filename=decodeURIComponent(new URL(url).pathname.split('/').pop());
  return {url,title:(title?title+' — '+filename:filename).slice(0,500),kind:'publication',documentKind:'publication',segments:splitSegments(pages),pageCount:pages.length,links:[],warnings:sparse.length?['Little or no text on '+sparse.join(', ')+'. Inspect the PDF for image-only pages or missing OCR.']:[],sha256:hash(bytes)};
}
export async function scanSite({knownURLs=[],python,fetcher=fetch,onProgress=()=>{}}={}) {
  const queue=new Map([[origin+'/', 'Home']]);
  for(const u of knownURLs) if(sourceURL(u)) queue.set(sourceURL(u),'');
  const sitemap=await download(origin+'/sitemap.xml',fetcher);
  if(sitemap.status!==200) throw Error('Sitemap could not be read. No scan plan will be applied.');
  for(const loc of parse(sitemap.bytes.toString(),{lowerCaseTagName:false}).querySelectorAll('loc')) {
    const u=sourceURL(loc.textContent.trim());if(u) queue.set(u,queue.get(u)||'');
  }
  const sources=[],failures=[],seen=new Set(),aliases=new Map();let totalBytes=0;
  for(const [url,title] of queue) {
    if(seen.has(url)) continue;
    if(seen.size>=150) throw Error('Scan exceeded 150 sources. Narrow scope before continuing.');
    seen.add(url);onProgress('Reading '+url);
    try {
      const response=await download(url,fetcher);
      if(response.status!==200){failures.push({url,status:response.status,reason:'HTTP '+response.status});continue;}
      if(!aliases.has(response.url))aliases.set(response.url,new Set([response.url]));
      aliases.get(response.url).add(url);
      totalBytes+=response.bytes.length;if(totalBytes>150*1024*1024) throw Error('Total scan size limit exceeded.');
      if(seen.has(response.url) && response.url!==url) continue;
      seen.add(response.url);
      let item;
      if(response.type.includes('application/pdf') && response.bytes.subarray(0,5).toString()==='%PDF-') item=extractPDF(response.bytes,response.url,title,python);
      else if(response.type.includes('text/html')) item=extractHTML(response.bytes,response.url);
      else throw Error('Unsupported source content type.');
      if(!item.segments.some(s=>s.content.trim())) throw Error('No searchable text extracted.');
      if(Buffer.byteLength(JSON.stringify(item.segments))>1500000) throw Error('Source text exceeds the safe per-document update limit.');
      for(const link of item.links) if(!queue.has(link.url)) queue.set(link.url,link.title);
      sources.push(item);
    } catch(error) {failures.push({url,status:0,reason:error.message});}
  }
  for(const item of sources)item.aliases=[...aliases.get(item.url)];
  return {sources,failures};
}

export function planChanges(snapshot,scan) {
  const changes=[],unchanged=[],blocked=[];const used=new Set();
  for(const source of scan.sources) {
    const aliases=new Set(source.aliases || [source.url]);
    const documents=snapshot.documents.filter(d=>aliases.has(sourceURL(d.source_url)));
    let records=snapshot.records.filter(r=>aliases.has(sourceURL(r.public_url)) || documents.some(d=>d.record_id===r.id));
    if(!records.length && snapshot.documents.some(d=>d.sha256===source.sha256)) {
      blocked.push({url:source.url,reason:'Identical source bytes already belong to a catalog record. Alternate link not imported as a duplicate.'});continue;
    }
    // Match newly linked transcripts to original workbook identities, not a second catalog row.
    const identifier=new URL(source.url).pathname.match(/CORHC-\d+/)?.[0];
    if(!records.length && identifier) records=snapshot.records.filter(r=>r.source_identifier===identifier);
    if(records.length>1 || documents.length>1){blocked.push({url:source.url,reason:'Ambiguous existing source mapping; resolve duplicates in the catalog first.'});continue;}
    const record=records[0],doc=documents[0];
    if(record?.rights_review==='restricted'){blocked.push({url:source.url,reason:'Record is restricted. Review permissions in the private editor.'});continue;}
    if(record && !doc && snapshot.documents.some(d=>d.record_id===record.id)){blocked.push({url:source.url,reason:'Record already has a different text source. Manual reconciliation required.'});continue;}
    const old=doc?snapshot.text_segments.filter(s=>s.document_id===doc.id).sort((a,b)=>a.ordinal-b.ordinal).map(({locator,content})=>({locator,content})):[];
    // Formatting-only source changes do not overwrite text or renew approvals.
    if(doc && hash(old)===hash(source.segments)){unchanged.push(source.url);continue;}
    if(doc && snapshot.text_reviews?.some(e=>e.document_id===doc.id)){
      try {
        const reviewed=effectiveSegments(snapshot,doc).map(({locator,content})=>({locator,content}));
        if(hash(reviewed)===hash(source.segments)){unchanged.push(source.url);continue;}
      } catch { /* A stale review must not be replaced by a scan. */ }
      blocked.push({url:source.url,reason:'Changed source has reviewed reading text. Review it separately; the scan cannot overwrite corrections.'});continue;
    }
    const id=record?.id || 'WEB-'+hash(source.url).slice(0,24);
    if(used.has(id) || (!record && snapshot.records.some(r=>r.id===id))){blocked.push({url:source.url,reason:'Conflicting record mapping.'});continue;}
    used.add(id);
    if(!record && source.documentKind==='publication')source.warnings=[...source.warnings,'This imports the entire linked PDF, not only an article excerpt. Confirm permission to republish all of its extracted text.'];
    changes.push({action:record?'update':'add',id,title:record?.title || source.title,source,record:record||null,document:doc||null,previousSegments:old});
  }
  // Only an explicit 404/410 can offer withdrawal, never a timeout or absent link.
  for(const failure of scan.failures.filter(f=>[404,410].includes(f.status))) {
    const records=snapshot.records.filter(r=>r.public_url===failure.url && r.state==='ready' && r.rights_review==='approved');
    if(records.length===1 && !used.has(records[0].id)) {
      const r=records[0];used.add(r.id);
      changes.push({action:'withdraw',id:r.id,title:r.title,record:r,source:{url:failure.url,warnings:['Source returned '+failure.status+'. Withdrawal is optional; the database record will be kept.']}});
    }
  }
  return {changes,unchanged,blocked,failures:scan.failures};
}
