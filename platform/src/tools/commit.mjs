// Changeset finalizer — turns the loose files an agentic run wrote into the
// workspace into a single committed, reviewable git changeset. This is the local
// half of "open a PR": everything except the network push, which needs a remote +
// token and so lands with the production runner (kept out of this offline seed).
//
// Everything goes through the ToolBus, so it inherits the sandbox-root confinement
// and audit log. Safe to call on a fresh dir (it inits) or an existing repo.

export async function commitWorkspace(bus, opts = {}) {
  const message = opts.message || 'chore: automated changes';

  // Initialise a repo if the workspace isn't one yet.
  if (!(await bus.fs.exists('.git'))) await bus.git.init();

  // Ensure a commit identity (local scope; harmless if a global one already exists).
  await bus.shell.exec('git', { args: ['config', 'user.email', opts.email || 'agent@maermin.local'] });
  await bus.shell.exec('git', { args: ['config', 'user.name', opts.name || 'MAERMIN Agent'] });

  // Optional feature branch (create, or switch to it if it already exists).
  if (opts.branch) {
    const made = await bus.git.branch(opts.branch).catch(() => null);
    if (!made) await bus.shell.exec('git', { args: ['checkout', opts.branch] });
  }

  await bus.git.add();
  const commit = await bus.shell.exec('git', { args: ['commit', '-m', message] });
  const committed = commit.code === 0; // non-zero when there was nothing to commit

  let sha = null, files = [];
  if (committed) {
    sha = (await bus.shell.exec('git', { args: ['rev-parse', '--short', 'HEAD'] })).stdout.trim();
    const show = await bus.shell.exec('git', { args: ['show', '--stat', '--name-only', '--pretty=format:', 'HEAD'] });
    files = show.stdout.split('\n').map((l) => l.trim()).filter(Boolean);
  }
  const branch = (await bus.git.currentBranch()).stdout.trim();
  return { committed, sha, branch, files, message };
}
