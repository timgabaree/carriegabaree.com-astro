// No rewriting of source PDFs or raw extraction. A reviewed edition is explicitly selected.
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const compact = text => text.normalize('NFC').replace(/\s/g,'');
export const rawSegments = (snapshot,id) => snapshot.text_segments.filter(t=>t.document_id===id).sort((a,b)=>a.ordinal-b.ordinal).map(({ordinal,locator,content})=>({ordinal,locator,content}));
export function effectiveSegments(snapshot,document) {
  const raw=rawSegments(snapshot,document.id);
  const edition=snapshot.text_reviews?.find(e=>e.document_id===document.id);
  if(!edition)return raw;
  if(edition.source_sha256!==document.sha256 || edition.raw_json!==JSON.stringify(raw))throw Error('Reviewed text is stale for '+document.id+'. Review the changed source before exporting.');
  return validateReadingText(raw,JSON.parse(edition.cleaned_json));
}
export function validateReadingText(raw,cleaned) {
  if(!Array.isArray(cleaned) || cleaned.length!==raw.length)throw Error('Keep every original page/segment in the reading text.');
  cleaned.forEach((s,i)=>{
    if(s.ordinal!==raw[i].ordinal || s.locator!==raw[i].locator || typeof s.content!=='string' || !s.content.trim() || s.content.length>20000 || Object.keys(s).sort().join(',')!=='content,locator,ordinal')throw Error('Keep segment numbers and PDF page labels; edit only nonempty text.');
  });
  if(Buffer.byteLength(JSON.stringify(cleaned))>1500000)throw Error('Reading text exceeds the document limit.');
  return cleaned;
}
export function reflowPage(raw,layout=[]) {
  const input=raw.replace(/\r\n?/g,'\n').split('\n'),lines=[];
  // PDF superscripts can become their own extraction lines. Reunite them only
  // when the PDF geometry proves the combined text is one printed line.
  for(let i=0;i<input.length;i++) {
    let value=input[i];
    for(let count=1;count<=3 && i+count<input.length;count++) {
      if(!input[i+count].trim() || !value.trim())break;
      const combined=input.slice(i,i+count+1).join(' ');
      if(layout.filter(l=>compact(l.text)===compact(combined)).length===1) {value=combined;i+=count;break;}
    }
    lines.push(value);
  }
  const matches=lines.map(line=>{
    if(!line.trim())return null;
    const found=layout.map((l,i)=>({...l,index:i})).filter(l=>compact(l.text)===compact(line));
    return found.length===1?found[0]:null;
  });
  let output='',previous=null,joined=0;
  lines.forEach((value,i)=>{
    const line=value.trim().replace(/[\t ]+/g,' ');
    if(!line){previous=null;return;}
    const current=matches[i];
    // Only join adjacent printed lines of the same size and column. An indent,
    // heading, extra vertical gap or uncertain match keeps a paragraph boundary.
    const join=previous && current && current.index===previous.index+1 &&
      Math.abs(current.height-previous.height)<2.5 && current.top-previous.top>0 &&
      current.top-previous.top<Math.max(previous.height,current.height)*1.65 &&
      current.x-previous.x<3 && previous.x-current.x<24 &&
      !/[-‐‑–]$/.test(output) && !/^\d+[.)]\s/.test(line) &&
      previous.text.length>35 && line.length>12;
    if(output)output+=join?' ':'\n\n';
    output+=line; if(join)joined++;previous=current;
  });
  // Verified small-cap byline only: preserve the accent printed in the source.
  const cleaned=output.replace(/^b\s*y\s+c\s*arrie\s+g\s*abar\s*é\s*e$/gim,'By Carrie Gabarée');
  const expected=compact(raw).replace(/bycarriegabarée/gi,'ByCarrieGabarée');
  if(compact(cleaned)!==expected)throw Error('Automatic cleanup changed source characters unexpectedly.');
  return {content:cleaned,joined,hyphenBreaks:(cleaned.match(/[-‐]\n\n(?=\p{Ll})/gu)||[]).length};
}
export function proposeReadingText(raw,bytes,python) {
  const result=spawnSync(python,[fileURLToPath(new URL('./pdf-reading-layout.py',import.meta.url))],{input:bytes,maxBuffer:30*1024*1024,timeout:120000});
  if(result.status!==0)throw Error('PDF layout reading failed. Install pdfplumber in the configured Python environment; raw text is unchanged.');
  const pages=JSON.parse(result.stdout.toString());let joined=0,hyphenBreaks=0;
  const segments=raw.map(s=>{
    const match=s.locator.match(/^PDF page (\d+)(?:\b|$)/);if(!match)throw Error('Only PDF page-labeled publication text can use this workflow.');
    const result=reflowPage(s.content,pages[Number(match[1])-1]||[]);joined+=result.joined;hyphenBreaks+=result.hyphenBreaks;
    return {...s,content:result.content};
  });
  return {segments,joined,hyphenBreaks};
}
