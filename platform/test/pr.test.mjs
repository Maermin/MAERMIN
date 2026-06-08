// Pull-request output — the network half of "open a PR", proven offline.
// The push is real git against a LOCAL BARE REPO (no network); the GitHub API
// call is exercised through an injected fetch stub held to the bus SSRF
// allow-list. Run: node test/pr.test.mjs
import os from 'node:os';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { runWorkflow, createToolBus, openPullRequest } from '../src/index.mjs';

let passed = 0, failed = 0;
function ok(name, cond) { cond ? (passed++, console.log('  ✓ ' + name)) : (failed++, console.error('  ✗ ' + name)); }

function bareRepo() {
  const dir = mkdtempSync(join(os.tmpdir(), 'maermin-remote-')) + '/origin.git';
  spawnSync('git', ['init', '--bare', dir]);
  return dir;
}
function remoteHasBranch(bare, branch) {
  return spawnSync('git', ['--git-dir', bare, 'rev-parse', '--verify', branch], { encoding: 'utf8' }).status === 0;
}
function stubFetch(rec) {
  return async (url, init) => {
    rec.url = String(url); rec.init = init;
    rec.body = init && init.body ? JSON.parse(init.body) : null;
    return { ok: true, status: 201, json: async () => ({ html_url: 'https://github.com/me/app/pull/7', number: 7 }) };
  };
}

(async function main() {
  // ---- (1) full arc: run → commit → push → open PR -------------------------
  console.log('full arc (goal → committed → pushed → PR opened):');
  const bare = bareRepo();
  const rec = {};
  const ws = createToolBus({ root: mkdtempSync(join(os.tmpdir(), 'maermin-ws-')), allowHosts: ['api.github.com'], fetchImpl: stubFetch(rec) });
  const res = await runWorkflow('Add OAuth login', {
    workspace: ws, commit: true, branch: 'feature/oauth',
    pr: { remote: bare, repo: 'me/app', token: 'ghp_test' }
  });
  ok('run completed', res.run.status === 'completed');
  ok('changeset committed', res.changeset && res.changeset.committed);
  ok('pullRequest attached to result', !!res.pullRequest);
  ok('branch was pushed to the remote', res.pullRequest.pushed && remoteHasBranch(bare, 'feature/oauth'));
  ok('PR was opened', res.pullRequest.opened === true);
  ok('returns PR url + number', res.pullRequest.url === 'https://github.com/me/app/pull/7' && res.pullRequest.number === 7);
  ok('API hit the right endpoint', rec.url === 'https://api.github.com/repos/me/app/pulls');
  ok('API call used head=branch and the configured base', rec.body.head === 'feature/oauth' && rec.body.base === 'main');
  ok('API authorized with the token', rec.init.headers.authorization === 'Bearer ghp_test');
  ok('PR body carries the readiness report', /RELEASE READINESS/.test(rec.body.body));
  ok('the http call was audited', ws.audit.some((a) => a.tool === 'http' && a.op === 'fetch' && a.ok));

  // ---- (2) push-only when credentials are absent ---------------------------
  console.log('push-only (no repo/token ⇒ branch pushed, PR not opened):');
  const bare2 = bareRepo();
  const ws2 = createToolBus({ root: mkdtempSync(join(os.tmpdir(), 'maermin-ws-')) });
  const res2 = await runWorkflow('Spike', { workspace: ws2, commit: true, branch: 'feature/spike', pr: { remote: bare2 } });
  ok('branch pushed without credentials', res2.pullRequest.pushed && remoteHasBranch(bare2, 'feature/spike'));
  ok('PR not opened (no token)', res2.pullRequest.opened === false && res2.pullRequest.url === null);

  // ---- (3) SSRF guard still applies to the PR API host ---------------------
  console.log('SSRF guard (PR host must be allow-listed):');
  const bare3 = bareRepo();
  const ws3 = createToolBus({ root: mkdtempSync(join(os.tmpdir(), 'maermin-ws-')), allowHosts: [], fetchImpl: stubFetch({}) });
  await runWorkflow('Locked down', { workspace: ws3, commit: true, branch: 'feature/lock' });
  let threw = '';
  try { await openPullRequest(ws3, { remote: bare3, branch: 'feature/lock', repo: 'me/app', token: 't' }); }
  catch (e) { threw = e.message; }
  ok('PR to a non-allow-listed host is blocked', /allow-list/.test(threw));
  ok('but the branch was still pushed before the API call', remoteHasBranch(bare3, 'feature/lock'));

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
