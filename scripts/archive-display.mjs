// Display metadata comes from the existing public citation schemas.
export function archiveDisplay(records,pages){
 const metadata=new Map();
 for(const page of pages)for(const schema of page.schema||[])for(const item of schema['@graph']||[]){
  if(typeof item.identifier==='string'&&/^(CORHC|CGDA)-\d+$/.test(item.identifier)){
   const previous=metadata.get(item.identifier)||{};
   metadata.set(item.identifier,{...previous,...item});
  }
 }
 return records.map(record=>{
  const identifier=record.sourceUrl.match(/(?:CORHC|CGDA)-\d+/)?.[0]||record.id;
  const date=metadata.get(identifier)?.dateCreated;
  const known=record.kind==='Oral history'&&/^\d{4}-\d{2}-\d{2}$/.test(date||'');
  const label=known?new Intl.DateTimeFormat('en-US',{month:'long',day:'numeric',year:'numeric',timeZone:'UTC'}).format(new Date(date+'T00:00:00Z')):'';
  return {...record,identifier,title:label&&!record.title.includes(label)?record.title+' — '+label:record.title};
 });
}
