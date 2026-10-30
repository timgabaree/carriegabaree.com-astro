import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validateIdentity, requireClean, validateReceipt, parseUpload, checkSafeFiles, confirm, runWorkflow } from '../WEBSITE-WORKFLOW/workflow.mjs';

const config = { domain: 'example.test', repository: 'example.test-astro', branch: 'main', worker: 'example-production', account: 'account', checks: [], livePages: ['/'] };
const remote = 'https://github.com/timgabaree/example.test-astro.git';
const version = '12345678-1234-1234-1234-123456789abc';
const commit = 'a'.repeat(40);

test('release identity accepts only this project, branch and explicit fetch/push destinations', () => {
  validateIdentity(config, 'main', remote, remote, config.repository);
  for (const args of [
    ['other', remote, remote, config.repository],
    ['main', remote, 'https://github.com/other/repo.git', config.repository],
    ['main', remote, remote, 'old-php-project'],
  ]) assert.throws(() => validateIdentity(config, ...args));
});
test('dirty and untracked files block release', () => {
  requireClean('');
  assert.throws(() => requireClean(' M src/pages/index.astro'));
  assert.throws(() => requireClean('?? new-file'));
});
test('upload receipts bind version to exact commit, account and Worker', () => {
  const receipt = { version, commit, worker: config.worker, account: config.account };
  validateReceipt(receipt, config, commit);
  for (const [field, value] of [['commit','old'],['worker','wrong'],['account','wrong'],['version','not-a-uuid']]) {
    assert.throws(() => validateReceipt({ ...receipt, [field]: value }, config, commit));
  }
  assert.throws(() => validateReceipt({pending:true}, config, commit));
});
test('machine-readable upload result rejects missing, multiple and wrong-worker versions', () => {
  const line = JSON.stringify({ type:'version-upload',worker_name:config.worker,version_id:version });
  assert.equal(parseUpload(line+'\n', config.worker), version);
  assert.throws(() => parseUpload(line+'\n'+line,config.worker));
  assert.throws(() => parseUpload('{}',config.worker));
  assert.throws(() => parseUpload(line,'wrong-worker'));
});
test('private/generated files are refused; example templates and normal source are allowed', () => {
  checkSafeFiles(['src/pages/index.astro','.env.example','.dev.vars.example','.run/01-preview.run.xml']);
  for (const file of ['.env','.env.production','.dev.vars','.dev.vars.staging','.local/private.json','.website-workflow-local/uploaded-version.json','node_modules/a.js','dist-production/index.html','private.pem']) {
    assert.throws(() => checkSafeFiles([file]),file);
  }
});
test('confirmation requires exact site-specific text', async () => {
  await confirm(async()=> 'PUBLISH example.test','PUBLISH example.test');
  for (const input of ['', 'yes', 'PUBLISH other.test']) await assert.rejects(confirm(async()=>input,'PUBLISH example.test'));
});

function fixture(t, {dirty = '', remoteCommit = commit} = {}) {
  t.mock.method(console, 'log', () => {}); // Keep simulated publish messages out of real release output.
  const root = fs.mkdtempSync(path.join(os.tmpdir(),'website-workflow-test-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  for (const dir of ['WEBSITE-WORKFLOW','node_modules/wrangler/bin','dist-production']) fs.mkdirSync(path.join(root,dir),{recursive:true});
  fs.writeFileSync(path.join(root,'WEBSITE-WORKFLOW/site.json'),JSON.stringify(config));
  fs.writeFileSync(path.join(root,'package.json'),JSON.stringify({name:config.repository}));
  fs.writeFileSync(path.join(root,'.nvmrc'),process.versions.node);
  fs.writeFileSync(path.join(root,'node_modules/wrangler/bin/wrangler.js'),'');
  fs.writeFileSync(path.join(root,'dist-production/index.html'),'<title>Example</title><main>Example</main>');
  fs.writeFileSync(path.join(root,'wrangler.production.jsonc'),JSON.stringify({name:config.worker,account_id:config.account,vars:{PRODUCTION_ENABLED:'true',ENVIRONMENT:'production'},assets:{directory:'./dist-production'},workers_dev:false,preview_urls:false}));
  const calls=[];
  const run=(binary,args,options={})=>{
    calls.push({binary,args,options});
    if(binary==='git') {
      if(args[0]==='rev-parse')return args[1]==='--show-toplevel'?root:commit;
      if(args[0]==='branch')return 'main';
      if(args[0]==='remote')return remote;
      if(args[0]==='ls-files')return 'src/pages/index.astro';
      if(args[0]==='status')return dirty;
      if(args[0]==='ls-remote')return remoteCommit+'\trefs/heads/main';
      return '';
    }
    if(args.includes('upload')&&!args.includes('--dry-run')) {
      fs.writeFileSync(options.env.WRANGLER_OUTPUT_FILE_PATH,JSON.stringify({type:'version-upload',worker_name:config.worker,version_id:version})+'\n');
    }
    return '';
  };
  return {root,run,calls};
}
for (const step of ['push','upload','publish']) test(step+' refuses dirty source before any remote mutation',async t=>{
  const f=fixture(t,{dirty:' M README.md'});
  await assert.rejects(runWorkflow(f.root,step,{run:f.run,ask:async()=>{throw Error('Unexpected prompt');}}));
  assert.ok(f.calls.every(c=>c.binary==='git'&&!['push','commit','add'].includes(c.args[0])));
});
test('upload refuses a commit not on GitHub',async t=>{
  const f=fixture(t,{remoteCommit:'b'.repeat(40)});
  await assert.rejects(runWorkflow(f.root,'upload',{run:f.run}));
  assert.ok(f.calls.every(c=>c.binary==='git'));
});
test('cancelled push never runs git push',async t=>{
  const f=fixture(t);
  await assert.rejects(runWorkflow(f.root,'push',{run:f.run,ask:async()=>''}));
  assert.ok(!f.calls.some(c=>c.args[0]==='push'));
});
test('cancelled commit never stages or commits',async t=>{
  const f=fixture(t,{dirty:' M README.md'});let answer=0;
  await assert.rejects(runWorkflow(f.root,'commit',{run:f.run,ask:async()=>answer++===0?'Example change':''}));
  assert.ok(!f.calls.some(c=>['add','commit'].includes(c.args[0])));
});
test('upload saves version receipt but never deploys live traffic or routes',async t=>{
  const f=fixture(t);
  await runWorkflow(f.root,'upload',{run:f.run,ask:async()=> 'UPLOAD example.test'});
  const receipt=JSON.parse(fs.readFileSync(path.join(f.root,'.website-workflow-local/uploaded-version.json')));
  validateReceipt(receipt,config,commit);
  assert.ok(!f.calls.some(c=>c.args.includes('deploy')||c.args.includes('triggers')));
});
test('publish requires receipt and deploys only its exact version at 100 percent',async t=>{
  const f=fixture(t);
  await assert.rejects(runWorkflow(f.root,'publish',{run:f.run}));
  fs.mkdirSync(path.join(f.root,'.website-workflow-local'));
  fs.writeFileSync(path.join(f.root,'.website-workflow-local/uploaded-version.json'),JSON.stringify({commit,version,worker:config.worker,account:config.account}));
  await runWorkflow(f.root,'publish',{run:f.run,ask:async()=> 'PUBLISH example.test'});
  const deployments=f.calls.filter(c=>c.args.includes('deploy'));
  assert.equal(deployments.length,1);
  assert.ok(deployments[0].args.includes(version+'@100%'));
  assert.ok(deployments[0].args.includes('versions'));
  assert.ok(!f.calls.some(c=>c.args.includes('triggers')));
});
test('describe mode has no commands or prompts, even for publish',async t=>{
  const f=fixture(t);
  await runWorkflow(f.root,'publish',{describe:true,run:()=>{throw Error('Unexpected command');},ask:async()=>{throw Error('Unexpected prompt');}});
});
