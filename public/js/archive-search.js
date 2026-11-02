import {searchTerms,highlightText} from './archive-matches.js';
import {readAdvanced,advancedParams,compileAdvanced,searchAdvanced} from './advanced-search.js';
import {matchRanges,excerptAround} from './archive-matches.js';
const form=document.getElementById('archive-search-form');
if(form){
 const query=document.getElementById('archive-query'),type=document.getElementById('archive-type');
 const status=document.getElementById('archive-search-status'),results=document.getElementById('archive-results'),more=document.getElementById('archive-more');
 const advanced=document.getElementById('archive-advanced'),any=document.getElementById('archive-any'),phrase=document.getElementById('archive-phrase'),exclude=document.getElementById('archive-exclude'),scope=document.getElementById('archive-scope');
 let engine,advancedData,request=0,matches=[],shown=0,activeQuery='',activeType='',activeAdvanced=null;
 const el=(tag,text)=>{const node=document.createElement(tag);node.textContent=text;return node;};
 async function append(token){
  more.disabled=true;
  const batch=await Promise.all(matches.slice(shown,shown+10).map(r=>r.data()));
  if(token!==request)return;
  for(const data of batch){
   const card=el('article','');card.className='archive-result';
   const title=el('h2',''),link=el('a',data.meta.title);const url=new URL(data.url,location.origin);
   if(url.origin!==location.origin||!(/^\/search\/[a-zA-Z0-9_-]+$/.test(url.pathname)||data.advanced&&data.meta.kind==='Website page'&&/^\/[a-z0-9-]*$/.test(url.pathname)))throw Error('Invalid result link');
   if(data.advanced){
    const isPage=data.meta.kind==='Website page',params=advancedParams(activeAdvanced),terms=compileAdvanced(activeAdvanced).terms;
    link.href=url.pathname+(isPage?'':'?'+params+'#search-matches');title.append(link);
    const kind=el('p',data.meta.kind);kind.className='eyebrow';card.append(kind,title);
    const preview=el('p','');highlightText(preview,excerptAround(data.preview,matchRanges(data.preview,terms)),terms);card.append(preview);
    if(!isPage&&activeAdvanced.scope!=='passage')card.append(el('p','Conditions match the whole document; highlighted words may occur in different passages.'));
    const read=el('a',isPage?'Read page →':'View matching passages →');read.href=link.href;card.append(read);results.append(card);continue;
   }
   // Decode Pagefind's encoded excerpt in an inert document, then render only text.
   const parsed=new DOMParser().parseFromString(data.excerpt,'text/html');const excerpt=parsed.body.textContent;
   const matched=[...parsed.querySelectorAll('mark')].map(mark=>mark.textContent).join(' ').slice(0,400);
   const params=new URLSearchParams({q:activeQuery});if(matched)params.set('match',matched);if(activeType)params.set('type',activeType);
   const kind=el('p',data.meta.kind);kind.className='eyebrow';
   link.href=url.pathname+(activeQuery?'?'+params+'#search-matches':'');title.append(link);card.append(kind,title);
   const preview=el('p','');highlightText(preview,activeQuery?excerpt:data.meta.summary,searchTerms(activeQuery,matched));card.append(preview);
   const read=el('a',activeQuery?'View matching passages →':'Read record →');read.href=link.href;card.append(read);results.append(card);
  }
  shown+=batch.length;more.hidden=shown>=matches.length;more.disabled=false;
  status.textContent=`${matches.length} ${matches.length===1?'result':'results'} found. Showing ${shown}.`;
 }
 async function search(){
  activeQuery=query.value.trim();activeType=type.value;
  activeAdvanced=advanced.open?readAdvanced(new URLSearchParams({q:activeQuery,type:activeType,any:any.value,phrase:phrase.value,exclude:exclude.value,scope:scope.value})):null;
  const state=activeAdvanced?advancedParams(activeAdvanced):new URLSearchParams();if(activeQuery)state.set('q',activeQuery);if(activeType)state.set('type',activeType);history.replaceState(null,'',location.pathname+(state.size?'?'+state:''));
  const token=++request;status.textContent='Searching…';results.replaceChildren();more.hidden=true;
  try{
   let found;
   if(activeAdvanced){
    const criteria=activeAdvanced;
    if(!advancedData){const response=await fetch('/archive-index/advanced-search.json');if(!response.ok)throw Error('Advanced search unavailable');const data=await response.json();if(data.version!==1||!Array.isArray(data.records))throw Error('Invalid search data');advancedData=data.records;}
    if(token!==request)return;
    found={results:searchAdvanced(advancedData,criteria).map(r=>({data:async()=>({advanced:true,url:r.url,meta:{title:r.title,kind:r.kind},preview:r.preview})}))};
   }else{
    engine??=await import('/archive-index/pagefind.js');
    found=await engine.search(activeQuery||null,{filters:activeType?{type:activeType}:{}});
   }
   if(token!==request)return;
   matches=found.results;shown=0;document.getElementById('archive-browse').open=false;
   if(!matches.length){status.textContent='No matching records. Try fewer words or choose all types.';return;}
   await append(token);
  }catch{if(token===request){status.textContent='Search is unavailable. You can still browse all approved records below.';document.getElementById('archive-browse').open=true;more.hidden=true;}}
 }
 form.addEventListener('submit',event=>{event.preventDefault();search();});type.addEventListener('change',search);
 form.addEventListener('reset',()=>{++request;matches=[];activeQuery='';activeType='';activeAdvanced=null;advanced.open=false;history.replaceState(null,'',location.pathname);results.replaceChildren();more.hidden=true;status.textContent=`Browse all ${form.dataset.recordCount} approved records below, or search their full text.`;document.getElementById('archive-browse').open=true;});
 more.addEventListener('click',()=>append(request).catch(()=>{status.textContent='Unable to load more results. Please search again.';more.disabled=false;}));
 const initial=new URLSearchParams(location.search);query.value=(initial.get('q')||'').slice(0,200);if([...type.options].some(option=>option.value===initial.get('type')))type.value=initial.get('type');
 if(initial.get('advanced')==='1'){const criteria=readAdvanced(initial);advanced.open=true;any.value=criteria.any;phrase.value=criteria.phrase;exclude.value=criteria.exclude;scope.value=criteria.scope;}
 if(query.value||type.value||advanced.open)search();
}
