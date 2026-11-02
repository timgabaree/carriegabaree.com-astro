import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {parse} from 'node-html-parser';

// Only public approved archive fields and indexable top-level content pages.
export async function buildAdvancedSearch(records,outputRoot,pages){
 const entries=records.map(r=>({id:r.id,url:'/search/'+r.id,title:r.title,kind:r.kind,summary:r.summary,subjects:r.subjects,segments:r.segments}));
 for(const page of pages){
  if(page.noindex||!/^([a-z0-9-]+)?$/.test(page.slug)||['search','archive','sitemap','thank-you','404'].includes(page.slug))continue;
  const html=parse(await readFile(path.join(outputRoot,(page.slug||'index')+'.html'),'utf8'));
  const main=html.querySelector('main');if(!main)throw Error('Public page has no main content.');
  main.querySelectorAll('script,style,nav,form,button,header,footer,[hidden]').forEach(node=>node.remove());
  const text=main.structuredText.replace(/\s+/g,' ').trim();
  entries.push({id:'page-'+(page.slug||'home'),url:'/'+page.slug,title:page.title,kind:'Website page',summary:page.description||'',subjects:[],segments:[{locator:'Page text',content:text}]});
 }
 await mkdir(path.join(outputRoot,'archive-index'),{recursive:true});
 await writeFile(path.join(outputRoot,'archive-index/advanced-search.json'),JSON.stringify({version:1,records:entries}));
 return entries;
}
