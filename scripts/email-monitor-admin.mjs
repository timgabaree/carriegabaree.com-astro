import {execFileSync} from 'node:child_process';
const [action='status',value]=process.argv.slice(2);
if(!['status','history','acknowledge','test'].includes(action)||
 (action==='acknowledge'&&!/^[a-f0-9-]{36}$/.test(value??''))||
 (action==='test'&&!['rgesol','carrie'].includes(value)))throw Error('Usage: node scripts/email-monitor-admin.mjs status | history | acknowledge <reviewed-revision> | test <rgesol|carrie>');
const key=execFileSync('/usr/bin/security',['find-generic-password','-s','family-sites-email-monitor','-a','admin','-w'],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();
const response=await fetch('https://family-sites-email-monitor.timgabaree-com-astro.workers.dev/admin/'+action,{
 method:['status','history'].includes(action)?'GET':'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},
 ...(action==='acknowledge'?{body:JSON.stringify({revision:value})}:{}),
 ...(action==='test'?{body:JSON.stringify({scenario:'primary-write-unavailable',site:value})}:{}),signal:AbortSignal.timeout(30000)});
if(!response.ok)throw Error('Monitor returned '+response.status+'; nothing was assumed cleared.');
console.log(['status','history'].includes(action)?await response.json():action==='test'?'Labeled failure latched. Verify automatic alert before acknowledging its exact revision.':'Reviewed revision acknowledged.');
