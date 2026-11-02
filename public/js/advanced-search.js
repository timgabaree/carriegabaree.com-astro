import {searchTerms,matchRanges} from './archive-matches.js';

const clean=value=>String(value||'').trim().slice(0,200);
export function readAdvanced(params){
 return {all:clean(params.get('q')),any:clean(params.get('any')),phrase:clean(params.get('phrase')),exclude:clean(params.get('exclude')),scope:['passage','document','site'].includes(params.get('scope'))?params.get('scope'):'passage',type:clean(params.get('type'))};
}
export function advancedParams(query){
 const params=new URLSearchParams({advanced:'1',scope:query.scope});
 for(const [key,value] of [['q',query.all],['any',query.any],['phrase',query.phrase],['exclude',query.exclude],['type',query.type]])if(value)params.set(key,value);
 return params;
}
const normalize=text=>text.normalize('NFC').toLocaleLowerCase().replace(/\s+/gu,' ').trim();
export function hasPhrase(text,phrase){
 if(!phrase)return true;
 const haystack=normalize(text),needle=normalize(phrase);let from=0;
 while(from<=haystack.length){
  const at=haystack.indexOf(needle,from);if(at<0)return false;
  const before=haystack[at-1]||'',after=haystack[at+needle.length]||'';
  if(!/[\p{L}\p{N}]/u.test(before)&&!/[\p{L}\p{N}]/u.test(after))return true;
  from=at+1;
 }
 return false;
}
export function compileAdvanced(query){
 const all=searchTerms(query.all),any=searchTerms(query.any),excluded=searchTerms(query.exclude);
 const contains=(text,word)=>matchRanges(text,[word]).length>0;
 const positive=all.length>0||any.length>0||Boolean(query.phrase);
 const accepts=texts=>all.every(w=>texts.some(t=>contains(t,w)))&&(!any.length||any.some(w=>texts.some(t=>contains(t,w))))&&(!query.phrase||texts.some(t=>hasPhrase(t,query.phrase)))&&!excluded.some(w=>texts.some(t=>contains(t,w)));
 return {positive,terms:[...new Set([...all,...any,...searchTerms(query.phrase)])],accepts,
  passage:text=>accepts([text]),
  relevant:text=>!positive||all.some(w=>contains(text,w))||any.some(w=>contains(text,w))||Boolean(query.phrase&&hasPhrase(text,query.phrase))};
}
export function searchAdvanced(records,query){
 const matcher=compileAdvanced(query);const found=[];
 for(const record of records){
  if(record.kind==='Website page'&&query.scope!=='site')continue;
  if(query.type&&record.kind!==query.type)continue;
  const passages=record.segments.map(s=>s.content);
  const metadata=[record.title,record.summary,...(record.subjects||[])];
  const matched=query.scope==='passage'?passages.some(matcher.passage):matcher.accepts([...metadata,...passages]);
  if(!matched)continue;
  const indices=passages.flatMap((text,i)=>(query.scope==='passage'?matcher.passage(text):matcher.relevant(text))?[i]:[]);
  found.push({...record,matching:indices,preview:indices.length?passages[indices[0]]:record.summary||record.title});
 }
 return found;
}
