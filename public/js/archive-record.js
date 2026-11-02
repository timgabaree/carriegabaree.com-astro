import {searchTerms,matchRanges,excerptAround,highlightText} from './archive-matches.js';
import {readAdvanced,advancedParams,compileAdvanced} from './advanced-search.js';
const controls=document.querySelector('.archive-record-controls'),page=document.querySelector('.archive-page'),siteHeader=document.querySelector('.site-header');
if(controls&&page&&siteHeader){
 const measure=()=>{
  const top=siteHeader.getBoundingClientRect().height+8;
  page.style.setProperty('--archive-controls-top',top+'px');
  page.style.setProperty('--archive-scroll-offset',(top+controls.getBoundingClientRect().height+20)+'px');
 };
 const observer=new ResizeObserver(measure);observer.observe(controls);observer.observe(siteHeader);measure();
}
const box=document.getElementById('archive-matches');
if(box){
 const params=new URLSearchParams(location.search),query=(params.get('q')||'').slice(0,200),advanced=params.get('advanced')==='1'?readAdvanced(params):null,matcher=advanced?compileAdvanced(advanced):null,terms=matcher?matcher.terms:searchTerms(query,params.get('match')||'');
 if(advanced||query.trim()&&terms.length){
  box.hidden=false;const heading=document.getElementById('search-matches');
  heading.textContent=advanced?'Advanced search matches':'Matches for “'+query+'”';
  const back=document.getElementById('archive-back');const backParams=advanced?advancedParams(advanced):new URLSearchParams({q:query});
  if(params.get('type'))backParams.set('type',params.get('type'));back.href='/search?'+backParams;
  const entries=[],sections=[...document.querySelectorAll('.archive-passage')];
  for(const section of sections){
   const paragraph=section.querySelector('p'),text=paragraph.textContent,ranges=matchRanges(text,terms);
   if(ranges.length)highlightText(paragraph,text,terms);
   const include=matcher?(advanced.scope==='passage'?matcher.passage(text):matcher.relevant(text)):ranges.length>0;
   if(!include)continue;
   entries.push({section,text,ranges});
  }
  const matching=new Set(entries.map(entry=>entry.section)),toggle=document.getElementById('archive-show-full'),sourceHeading=document.getElementById('archive-source-heading'),sourceStatus=document.getElementById('archive-source-status');
  let showFull=false;
  function updateView(){
   for(const section of sections)section.hidden=!showFull&&!matching.has(section);
   toggle.textContent=showFull?'Show matching passages only':'Show full document';
   toggle.setAttribute('aria-pressed',String(showFull));
   sourceHeading.textContent=showFull?'Full document text':'Matching passage text';
   sourceStatus.textContent=showFull?`Showing all ${sections.length} passages. Search words remain highlighted.`:`Showing ${entries.length} matching passages only. Other passages are hidden. Choose “Show full document” for more context.`;
  }
  toggle.hidden=false;sourceStatus.hidden=false;updateView();
  toggle.addEventListener('click',()=>{showFull=!showFull;updateView();});
  const status=document.getElementById('archive-match-status'),list=document.getElementById('archive-match-list'),more=document.getElementById('archive-match-more');let shown=0;
  const el=(tag,text)=>{const node=document.createElement(tag);node.textContent=text;return node;};
  function append(){
   for(const entry of entries.slice(shown,shown+20)){
    const card=el('article','');card.className='archive-result';
    card.append(el('h3',entry.section.querySelector('h3').textContent));
    const excerpt=el('p','');highlightText(excerpt,excerptAround(entry.text,entry.ranges),terms);card.append(excerpt);
    const links=el('div','');links.className='archive-match-links';
    const passage=el('a','Read this passage');passage.href='#'+entry.section.id;
    passage.addEventListener('click',()=>entry.section.focus({preventScroll:true}));links.append(passage);
    const original=entry.section.querySelector('.archive-source-link');if(original)links.append(original.cloneNode(true));
    card.append(links);list.append(card);
   }
   shown=Math.min(entries.length,shown+20);more.hidden=shown===entries.length;
   const noun=entries.length===1?'passage':'passages',verb=entries.length===1?'matches':'match';
   status.textContent=entries.length?`${entries.length} ${noun} ${verb} ${advanced?.scope==='passage'?'all your conditions':matcher&&!matcher.positive?'this exclusion-only search':'your search words'}. Showing ${shown} previews. ${advanced&&advanced.scope!=='passage'?'Conditions match the whole document, not necessarily each passage. ':''}Read a passage below or open its original source.`:'No matching words were found in the attached text. The search result may match the title, subjects or a related word form. Choose “Show full document” to read the record.';
  }
  append();more.addEventListener('click',append);
  if(location.hash==='#search-matches'){heading.focus({preventScroll:true});heading.scrollIntoView();}
 }
}
