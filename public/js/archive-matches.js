// Shared, bounded text matching. Source text is always rendered as text, never HTML.
export function searchTerms(query,matched=''){
 return [...new Set(((String(query).slice(0,200)+' '+String(matched).slice(0,400)).toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu)||[]))].slice(0,32);
}
export function matchRanges(text,terms){
 if(!terms.length)return [];
 const escaped=terms.map(t=>t.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).sort((a,b)=>b.length-a.length);
 const expression=new RegExp('(?<![\\p{L}\\p{N}])(?:'+escaped.join('|')+')[\\p{L}\\p{N}]*','giu');
 return [...text.matchAll(expression)].map(m=>({start:m.index,end:m.index+m[0].length}));
}
export function excerptAround(text,ranges,radius=140){
 if(!ranges.length)return text.slice(0,280);
 const start=Math.max(0,ranges[0].start-radius),end=Math.min(text.length,ranges[0].end+radius);
 return (start?'…':'')+text.slice(start,end)+(end<text.length?'…':'');
}
export function sourceLink(source,locator){
 if(!source)return null;
 let url;try{url=new URL(source);}catch{return null;}
 if(url.origin!=='https://carriegabaree.com'||url.username||url.password)return null;
 const page=/^PDF page ([1-9]\d*)$/.exec(locator);
 if(/\.pdf$/i.test(url.pathname)&&page){url.hash='page='+page[1];return {href:url.href,label:'Open original PDF — page '+page[1]};}
 return {href:url.href,label:/\.pdf$/i.test(url.pathname)?'Open original PDF':'Open original transcript'};
}
export function highlightText(element,text,terms){
 const fragment=document.createDocumentFragment();let offset=0;
 for(const range of matchRanges(text,terms)){
  fragment.append(document.createTextNode(text.slice(offset,range.start)));
  const mark=document.createElement('mark');mark.textContent=text.slice(range.start,range.end);fragment.append(mark);offset=range.end;
 }
 fragment.append(document.createTextNode(text.slice(offset)));element.replaceChildren(fragment);
}
