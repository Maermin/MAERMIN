// Pull-request output — the network half of "open a PR", the step that turns a
// committed run into something a human reviews. Everything goes through the bus,
// so the push is audited and the API call is held to the same SSRF allow-list as
// any other outbound request (the host MUST be in the bus's allowHosts).
//
// Two-phase, and graceful: it always pushes the branch to the remote (real git —
// works against a local bare repo in tests and a real `origin` in production),
// then opens the PR via the host API only when given repo + token; otherwise it
// returns push-only so the local arc still completes without credentials.

export async function openPullRequest(bus, opts = {}) {
  if (!bus) throw new Error('openPullRequest requires a ToolBus');
  if (!opts.remote) throw new Error('openPullRequest requires a remote (url or path)');

  const branch = opts.branch || (await bus.git.currentBranch()).stdout.trim();
  const base = opts.base || 'main';

  // 1) Push the branch. Through the bus shell so it is sandbox-confined + audited.
  const push = await bus.shell.exec('git', { args: ['push', String(opts.remote), branch] });
  if (push.code !== 0) throw new Error('git push failed: ' + (push.stderr || push.stdout).trim());
  const pushed = true;

  // 2) Open the PR — opt-in (needs a repo "owner/name" + token). Without them the
  //    branch is on the remote and the caller can open the PR however they like.
  if (!opts.repo || !opts.token) {
    return { pushed, opened: false, url: null, number: null, branch, base };
  }

  const host = opts.host || 'api.github.com';
  const res = await bus.http.fetch(`https://${host}/repos/${opts.repo}/pulls`, {
    method: 'POST',
    headers: {
      authorization: 'Bearer ' + opts.token,
      accept: 'application/vnd.github+json',
      'content-type': 'application/json',
      'user-agent': 'maermin-platform'
    },
    body: JSON.stringify({ title: opts.title || `MAERMIN: ${branch}`, head: branch, base, body: opts.body || '' })
  });
  if (!res.ok) {
    let detail = '';
    try { detail = JSON.stringify(await res.json()); } catch {}
    throw new Error(`PR API ${res.status}${detail ? ' ' + detail : ''}`);
  }
  const data = await res.json();
  return { pushed, opened: true, url: data.html_url || null, number: data.number ?? null, branch, base };
}
