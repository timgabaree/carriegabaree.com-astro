import * as pagefind from 'pagefind';
export async function buildArchiveIndex(records,outputPath){
 if(!records.length)return;
 const {index,errors}=await pagefind.createIndex();
 if(errors?.length||!index)throw Error('Could not create search index.');
 try{
  for(const r of records){
   const result=await index.addCustomRecord({url:'/search/'+r.id,language:'en',content:[r.title,r.summary,...r.subjects,...r.segments.map(s=>s.content)].join('\n\n'),meta:{title:r.title,kind:r.kind,summary:r.summary},filters:{type:[r.kind]}});
   if(result.errors.length)throw Error('Could not index an approved record.');
  }
  const result=await index.writeFiles({outputPath});if(result.errors.length)throw Error('Could not write archive search index.');
 }finally{await index.deleteIndex();await pagefind.close();}
}
