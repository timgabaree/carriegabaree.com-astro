// Numbered website actions. No remote write happens without a typed confirmation.
// Shared, dependency-free workflow; site-specific settings live in site.json.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import assert from 'node:assert/strict';

export const steps = {
  help: ['00 - START HERE', 'Print the steps, safety rules and this site’s settings. No changes.'],
  preview: ['01 - Preview on this Mac', 'Start a local preview. Stop it with the red Stop button or Control+C. No upload.'],
  check: ['02 - Check and build production', 'Run code checks, tests, a fresh production build and a Cloudflare dry run. No upload.'],
  commit: ['03 - Save changes in Git', 'Review ALL listed non-ignored changes, then create a local commit. Nothing is pushed.'],
  push: ['04 - Send commits to GitHub', 'Push the current clean branch to its existing GitHub repository. Does not publish the website.'],
  upload: ['05 - Upload to Cloudflare - NOT LIVE', 'Recheck and upload the exact GitHub-saved revision. Save its version ID locally. Does not change live traffic.'],
  publish: ['06 - PUBLISH LIVE WEBSITE', 'After typed approval, send 100% of live traffic to the version saved by step 05.'],
  verify: ['07 - Verify the live website', 'Check live pages and assets; when available, confirm the published Cloudflare version. No contact email.'],
  login: ['08 - Sign in to Cloudflare if needed', 'Open Cloudflare’s normal browser sign-in. No website deployment.'],
};

export function validateIdentity(config, branch, remote, pushRemote, packageName) {
  assert.equal(packageName, config.repository, 'Wrong project package.');
  assert.equal(branch, config.branch, 'Wrong Git branch; switch to the documented release branch first.');
  const allowed = ['https://github.com/timgabaree/' + config.repository + '.git', 'git@github.com:timgabaree/' + config.repository + '.git'];
  assert.ok(allowed.includes(remote), 'Unexpected GitHub fetch destination. Stop and inspect origin.');
  assert.ok(allowed.includes(pushRemote), 'Unexpected GitHub push destination. Stop and inspect origin.');
}
export function requireClean(status) {
  assert.equal(status.trim(), '', 'Uncommitted files remain. Review and commit them before GitHub upload or publishing.');
}
export function validateReceipt(receipt, config, head) {
  assert.equal(receipt.commit, head, 'The saved Cloudflare upload belongs to a different commit. Run step 05 again.');
  assert.equal(receipt.worker, config.worker, 'Wrong Worker in saved upload.');
  assert.equal(receipt.account, config.account, 'Wrong account in saved upload.');
  assert.match(receipt.version, /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i, 'Invalid uploaded version ID.');
}
export function parseUpload(text, worker) {
  const rows = text.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  const uploads = rows.filter(row => row.type === 'version-upload');
  assert.equal(uploads.length, 1, 'Expected exactly one upload result; live publishing is blocked.');
  assert.equal(uploads[0].worker_name, worker, 'Cloudflare returned a different Worker.');
  assert.match(uploads[0].version_id, /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i);
  return uploads[0].version_id;
}
export function checkSafeFiles(files) {
  for (const file of files) {
    const allowedExample = /(?:^|\/)(?:\.env|\.dev\.vars)\.example$/.test(file);
    assert.ok(allowedExample || !/(?:^|\/)(?:\.env(?:\.|$)|\.dev\.vars(?:\.|$)|\.local(?:\/|$)|\.website-workflow-local(?:\/|$)|node_modules\/|dist(?:-production)?\/|worker-build\/)|\.(?:pem|p12|pfx|key)$/i.test(file),
      'Private/generated file is tracked or would be committed: ' + file + '. Review it; do not force-add secrets.');
  }
}
function command(root, binary, args, options = {}) {
  const env = { ...process.env, PATH: path.dirname(process.execPath) + path.delimiter + process.env.PATH,
    WRANGLER_SEND_METRICS: 'false', ...options.env };
  const result = spawnSync(binary, args, { cwd: root, env, encoding: 'utf8',
    stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit', maxBuffer: 16 * 1024 * 1024 });
  if (result.error || result.status !== 0) {
    if (options.capture && result.stderr) console.error(result.stderr);
    throw new Error('Command failed: ' + binary + ' ' + args.join(' ') + '. Stop here; nothing else will run.');
  }
  return result.stdout?.trim() ?? '';
}
async function prompt(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try { return await rl.question(question + '\n> '); }
  finally { rl.close(); }
}
export async function confirm(ask, phrase) {
  assert.equal((await ask('Type exactly "' + phrase + '" to continue; anything else cancels.')).trim(), phrase, 'Cancelled. No further action taken.');
}

export async function runWorkflow(root, step, options = {}) {
  assert.ok(steps[step], 'Unknown workflow step.');
  const config = JSON.parse(fs.readFileSync(path.join(root, 'WEBSITE-WORKFLOW/site.json'), 'utf8'));
  console.log('\n' + steps[step][0] + ' — ' + config.domain + '\n' + steps[step][1] + '\n');
  if (options.describe || step === 'help') {
    for (const [key, [name, description]] of Object.entries(steps)) console.log(name + '\n  ' + description + '\n  npm run site:' + key);
    console.log('\nProject: ' + root + '\nGitHub: timgabaree/' + config.repository + ' (' + config.branch + ')\nCloudflare: ' + config.worker);
    console.log('\nSteps 03, 04, 05 and 06 require typed approval. Only step 06 changes the live website.\nRead WEBSITE-WORKFLOW/00-START-HERE.md before your first run. No step changes GoDaddy or DNS.');
    return;
  }
  assert.equal(process.versions.node, fs.readFileSync(path.join(root, '.nvmrc'), 'utf8').trim(),
    'Use the Node version in .nvmrc. In WebStorm Terminal run: nvm use');
  const run = options.run ?? ((binary, args, opts) => command(root, binary, args, opts));
  const ask = options.ask ?? prompt;
  const git = (...args) => run('git', args, { capture: true });
  const npm = (...args) => run('npm', args);
  const cf = (args, opts = {}) => run(process.execPath, [path.join(root, 'node_modules/wrangler/bin/wrangler.js'), ...args, '--config', 'wrangler.production.jsonc'], { ...opts, env: { ...opts.env, CLOUDFLARE_ACCOUNT_ID: config.account } });
  const stateDir = path.join(root, '.website-workflow-local');
  const receiptFile = path.join(stateDir, 'uploaded-version.json');
  const save = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  const head = () => git('rev-parse', 'HEAD');
  function identity() {
    assert.equal(fs.realpathSync(git('rev-parse', '--show-toplevel')), fs.realpathSync(root), 'Wrong Git root.');
    validateIdentity(config, git('branch', '--show-current'), git('remote', 'get-url', 'origin'),
      git('remote', 'get-url', '--push', 'origin'), JSON.parse(fs.readFileSync(path.join(root, 'package.json'))).name);
    checkSafeFiles(git('ls-files', '-z', '--cached', '--others', '--exclude-standard').split('\0').filter(Boolean));
  }
  function clean() { requireClean(git('status', '--porcelain', '--untracked-files=all')); }
  function onGitHub() {
    identity(); clean();
    const remote = git('ls-remote', '--exit-code', 'origin', 'refs/heads/' + config.branch).split(/\s/)[0];
    assert.equal(head(), remote, 'Local commit does not match GitHub. Complete step 04, or resolve remote changes first.');
  }
  function cloudConfig() {
    // These checked-in production files currently use strict JSON (valid JSONC).
    const liveConfig = JSON.parse(fs.readFileSync(path.join(root, 'wrangler.production.jsonc'), 'utf8'));
    assert.equal(liveConfig.name, config.worker);
    assert.equal(liveConfig.account_id, config.account);
    assert.equal(liveConfig.vars.PRODUCTION_ENABLED, 'true');
    assert.equal(liveConfig.vars.ENVIRONMENT, 'production');
    assert.equal(liveConfig.assets.directory, './dist-production');
    assert.equal(liveConfig.workers_dev, false);
    assert.equal(liveConfig.preview_urls, false);
    // Do not use "wrangler deploy" or "triggers deploy": preserve dashboard-managed routes.
  }
  function checks() {
    cloudConfig();
    assert.ok(fs.existsSync(path.join(root, 'node_modules/wrangler/bin/wrangler.js')), 'Install dependencies first: nvm use && npm ci');
    for (const args of config.checks) npm(...args);
    validateBuild(root, config);
    cf(['versions', 'upload', '--dry-run', '--outdir', 'worker-build/workflow']);
    console.log('\nChecks passed. Production files are prepared; nothing has been uploaded or published.');
  }
  identity();
  if (step === 'preview') return npm('run', 'dev', '--', '--host', '127.0.0.1');
  if (step === 'check') return checks();
  if (step === 'commit') {
    const status = git('status', '--short', '--untracked-files=all');
    assert.ok(status, 'No changes to commit.');
    console.log(status + '\n\n' + git('diff', '--stat') + '\n' + git('diff', '--cached', '--stat'));
    console.log('\nThis commits ALL listed changes, including new files. Review their contents in WebStorm first.\nFor selected files only, cancel and use WebStorm’s Commit window instead.');
    const message = (await ask('Enter a short commit message (blank cancels):')).trim();
    assert.ok(message && message.length <= 200 && !message.includes('\n'), 'Cancelled: a short single-line message is required.');
    await confirm(ask, 'COMMIT ' + config.domain);
    identity();
    run('git', ['add', '--all', '--', '.']);
    run('git', ['diff', '--cached', '--check']);
    run('git', ['commit', '-m', message]);
    console.log('Saved locally. Run step 04 to send the commit to GitHub. The website is unchanged.');
    return;
  }
  if (step === 'push') {
    clean();
    console.log('Destination: timgabaree/' + config.repository + ' — ' + config.branch + '\nCommit: ' + head());
    await confirm(ask, 'PUSH ' + config.domain);
    identity(); clean();
    run('git', ['push', 'origin', 'HEAD:refs/heads/' + config.branch]);
    onGitHub();
    console.log('GitHub matches this local commit. The live website is unchanged.');
    return;
  }
  if (step === 'login') return cf(['login']);
  cloudConfig();
  if (step === 'upload') {
    onGitHub();
    const commit = head();
    checks();
    onGitHub(); assert.equal(head(), commit, 'Commit changed during checks.');
    cf(['whoami']);
    await confirm(ask, 'UPLOAD ' + config.domain);
    onGitHub(); assert.equal(head(), commit, 'Commit changed before upload.');
    fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
    const output = path.join(stateDir, 'upload-' + randomUUID() + '.jsonl');
    // Invalidate a previous receipt before trying a new upload; failure must not reuse it.
    save(receiptFile, { pending: true, commit, worker: config.worker, account: config.account });
    cf(['versions', 'upload', '--tag', 'git-' + commit.slice(0, 12), '--message', 'Website workflow: ' + commit],
      { env: { WRANGLER_OUTPUT_FILE_PATH: output } });
    const version = parseUpload(fs.readFileSync(output, 'utf8'), config.worker);
    onGitHub(); assert.equal(head(), commit, 'Source changed during upload. Do not publish; repeat step 05.');
    save(receiptFile, { commit, worker: config.worker, account: config.account, version, uploadedAt: new Date().toISOString() });
    console.log('\nUploaded version ' + version + '. NOT LIVE. Step 06 is the separate live-publication action.');
    return;
  }
  if (step === 'publish') {
    onGitHub();
    assert.ok(fs.existsSync(receiptFile), 'Run step 05 first; there is no saved upload.');
    const receipt = JSON.parse(fs.readFileSync(receiptFile, 'utf8'));
    validateReceipt(receipt, config, head());
    cf(['deployments', 'status']);
    console.log('\nAbout to publish ' + receipt.version + ' at 100% traffic on https://' + config.domain + '\nGit commit: ' + receipt.commit);
    await confirm(ask, 'PUBLISH ' + config.domain);
    onGitHub(); validateReceipt(receipt, config, head());
    cf(['versions', 'deploy', receipt.version + '@100%', '--yes', '--message', 'Website workflow: ' + receipt.commit]);
    save(path.join(stateDir, 'published-version.json'), { ...receipt, publishedAt: new Date().toISOString() });
    cf(['deployments', 'status']);
    console.log('\nPublication completed. Run step 07 now, then inspect your changed pages in a browser.');
    return;
  }
  if (step === 'verify') {
    validateBuild(root, config);
    const publishedFile = path.join(stateDir, 'published-version.json');
    if (fs.existsSync(publishedFile)) {
      const receipt = JSON.parse(fs.readFileSync(publishedFile, 'utf8'));
      validateReceipt(receipt, config, head());
      clean();
      const deployed = JSON.parse(cf(['deployments', 'status', '--json'], { capture: true }));
      assert.deepEqual(deployed.versions, [{ version_id: receipt.version, percentage: 100 }], 'Cloudflare is not serving the recorded version at 100%.');
      console.log('Confirmed Cloudflare version ' + receipt.version + ' at 100% traffic.');
    } else console.log('No local publication receipt yet: checking live content, not claiming a particular deployed version.');
    await verifyLive(root, config);
    for (const args of config.liveChecks ?? []) {
      if (args[0] === 'npm') npm(...args.slice(1));
      else run(process.execPath, args);
    }
    console.log('\nLive HTTP/content/asset checks passed. No contact email was sent. Review the changed pages visually too.');
  }
}
export function validateBuild(root, config) {
  const dir = path.join(root, 'dist-production');
  assert.ok(fs.existsSync(dir), 'No production build. Run step 02 first.');
  let files = 0, html = 0;
  function walk(folder) {
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      const file = path.join(folder, entry.name);
      assert.ok(!entry.isSymbolicLink(), 'Unexpected symbolic link in build.');
      if (entry.isDirectory()) { walk(file); continue; }
      const relative = path.relative(dir, file);
      if (relative === '.assetsignore' || relative === '_headers' || relative === '_redirects') continue;
      assert.ok(!/(?:^|\/)\.|(?:\.php|\.shtml|\.env|\.map)$/i.test(relative), 'Unsafe public output: ' + relative);
      assert.ok(fs.statSync(file).size <= 25 * 1024 * 1024, 'Asset exceeds Cloudflare limit: ' + relative);
      files++;
      if (relative.endsWith('.html')) {
        const text = fs.readFileSync(file, 'utf8');
        assert.match(text, /<main(?:\s|>)/);
        assert.match(text, /<title>[^<]+<\/title>/);
        assert.ok(!text.includes('workers.dev'), 'Staging URL in production page: ' + relative);
        html++;
      }
    }
  }
  walk(dir); assert.ok(files > 0 && html > 0, 'Production build is empty.');
  assert.ok(fs.existsSync(path.join(dir, 'index.html')), 'Home page missing.');
  console.log('Production output: ' + html + ' HTML files, ' + files + ' public files checked for ' + config.domain + '.');
}
export async function verifyLive(root, config) {
  const origin = 'https://' + config.domain;
  const mainText = html => html.match(/<main(?:\s[^>]*)?>([\s\S]*?)<\/main>/)?.[1]
    ?.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
  let count = 0;
  for (const route of config.livePages) {
    const file = route === '/' ? 'index.html' : route.slice(1) + '.html';
    const local = fs.readFileSync(path.join(root, 'dist-production', file), 'utf8');
    const response = await fetch(origin + route, { redirect: 'manual', signal: AbortSignal.timeout(30000) });
    assert.equal(response.status, 200, route + ' status');
    const html = await response.text();
    assert.equal(html.match(/<title>(.*?)<\/title>/s)?.[1], local.match(/<title>(.*?)<\/title>/s)?.[1], route + ' title differs from local build');
    assert.ok(mainText(local), route + ' local main content missing');
    assert.equal(mainText(html), mainText(local), route + ' main content differs from local build');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.ok(response.headers.get('content-security-policy'), route + ' security policy missing');
    const assets = new Set([...local.matchAll(/(?:src|href)="([^"]+)"/g)].map(m => m[1]).filter(url => url.startsWith('/') && /\.(css|js)(?:\?|$)/.test(url)));
    for (const asset of assets) {
      const url = new URL(asset, origin);
      const r = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(30000) });
      assert.equal(r.status, 200, asset);
      const digest = bytes => createHash('sha256').update(bytes).digest('hex');
      assert.equal(digest(Buffer.from(await r.arrayBuffer())), digest(fs.readFileSync(path.join(root, 'dist-production', decodeURIComponent(url.pathname)))), asset + ' differs from build');
      count++;
    }
    count++; console.log('Verified ' + origin + route);
  }
  console.log(count + ' live page/asset checks passed.');
}
const ownFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === ownFile) {
  runWorkflow(path.resolve(path.dirname(ownFile), '..'), process.argv[2] ?? 'help', { describe: process.argv.includes('--describe') })
    .catch(error => { console.error('\nSTOPPED: ' + error.message + '\nNo automatic retry, force-push or rollback was performed.'); process.exitCode = 1; });
}
