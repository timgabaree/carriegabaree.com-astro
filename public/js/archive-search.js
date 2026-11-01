import {searchTerms,highlightText} from './archive-matches.js';
const form=document.getElementById('archive-search-form');
if(form){
 const query=document.getElementById('archive-query'),type=document.getElementById('archive-type');
 const status=document.getElementById('archive-search-status'),results=document.getElementById('archive-results'),more=document.getElementById('archive-more');
 let engine,request=0,matches=[],shown=0,activeQuery='',activeType='';
 const el=(tag,text)=>{const node=document.createElement(tag);node.textContent=text;return node;};
 async function append(token){
  more.disabled=true;
  const batch=await Promise.all(matches.slice(shown,shown+10).map(r=>r.data()));
  if(token!==request)return;
  for(const data of batch){
   const card=el('article','');card.className='archive-result';
   const title=el('h2',''),link=el('a',data.meta.title);const url=new URL(data.url,location.origin);
   if(url.origin!==location.origin||!/^\/archive\/[a-zA-Z0-9_-]+$/.test(url.pathname))throw Error('Invalid result link');
   // Decode Pagefind's encoded excerpt in an inert document, then render only text.
   const parsed=new DOMParser().parseFromString(data.excerpt,'text/html');const excerpt=parsed.body.textContent;
   const matched=[...parsed.querySelectorAll('mark')].map(mark=>mark.textContent).join(' ').slice(0,400);
   const params=new URLSearchParams({q:activeQuery});if(matched)params.set('match',matched);if(activeType)params.set('type',activeType);
   link.href=url.pathname+(activeQuery?'?'+params+'#search-matches':'');title.append(link);card.append(el('p',data.meta.kind),title);
   const preview=el('p','');highlightText(preview,activeQuery?excerpt:data.meta.summary,searchTerms(activeQuery,matched));card.append(preview);
   const read=el('a',activeQuery?'View matching passages →':'Read record →');read.href=link.href;card.append(read);results.append(card);
  }
  shown+=batch.length;more.hidden=shown>=matches.length;more.disabled=false;
  status.textContent=`${matches.length} ${matches.length===1?'record':'records'} found. Showing ${shown}.`;
 }
 async function search(){
  activeQuery=query.value.trim();activeType=type.value;
  const state=new URLSearchParams();if(activeQuery)state.set('q',activeQuery);if(activeType)state.set('type',activeType);history.replaceState(null,'',location.pathname+(state.size?'?'+state:''));
  const token=++request;status.textContent='Searching…';results.replaceChildren();more.hidden=true;
  try{
   engine??=await import('/archive-index/pagefind.js');
   const found=await engine.search(activeQuery||null,{filters:activeType?{type:activeType}:{}});
   if(token!==request)return;
   matches=found.results;shown=0;document.getElementById('archive-browse').open=false;
   if(!matches.length){status.textContent='No matching records. Try fewer words or choose all types.';return;}
   await append(token);
  }catch{if(token===request){status.textContent='Search is unavailable. You can still browse all approved records below.';document.getElementById('archive-browse').open=true;more.hidden=true;}}
 }
 form.addEventListener('submit',event=>{event.preventDefault();search();});type.addEventListener('change',search);
 form.addEventListener('reset',()=>{++request;matches=[];activeQuery='';activeType='';history.replaceState(null,'',location.pathname);results.replaceChildren();more.hidden=true;status.textContent=`Browse all ${form.dataset.recordCount} approved records below, or search their full text.`;document.getElementById('archive-browse').open=true;});
 more.addEventListener('click',()=>append(request).catch(()=>{status.textContent='Unable to load more results. Please search again.';more.disabled=false;}));
 const initial=new URLSearchParams(location.search);query.value=(initial.get('q')||'').slice(0,200);if([...type.options].some(option=>option.value===initial.get('type')))type.value=initial.get('type');if(query.value||type.value)search();
}
