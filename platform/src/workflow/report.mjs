// Release-readiness report — turns a raw run into the answer the user actually
// wants: "is this shippable, and if not, why?". It is a pure projection over the
// run record (+ the workspace audit log when present), so it has no side effects
// and can be rendered anywhere (CLI, API, dashboard).
//
//   level: 'ship'    — completed with zero repairs (clean first pass)
//          'caution' — completed but needed auto-fixes (review the recovered stages)
//          'blocked' — halted: a gate/verify failed past its repair budget

export function buildReport(result, opts = {}) {
  const run = (result && result.run) || result || {};
  const stages = run.stages || [];
  const gates = stages.filter((s) => s.gate);
  const completed = run.status === 'completed';
  const passed = stages.filter((s) => s.status === 'ok').length;
  const total = stages.length || 1;

  const readiness = completed ? 100 : Math.round((100 * passed) / total);
  const level = !completed ? 'blocked' : (run.repairs > 0 ? 'caution' : 'ship');

  const ws = opts.workspace || null;
  const files = ws
    ? [...new Set(ws.audit.filter((a) => a.tool === 'fs' && a.op === 'write' && a.ok).map((a) => a.target))]
    : [];
  const toolOps = ws ? ws.audit.length : stages.reduce((n, s) => n + (s.tools || 0), 0);

  return {
    goal: run.goal,
    workflow: run.workflow,
    status: run.status,
    readiness,
    level,
    durationMs: (run.finishedAt || Date.now()) - (run.startedAt || Date.now()),
    gates: { passed: gates.filter((s) => s.status === 'ok').length, total: gates.length },
    repairs: run.repairs || 0,
    recovered: stages.filter((s) => s.recovered).map((s) => s.name),
    blockedAt: run.blockedAt || null,
    blockedReason: run.blockedReason || null,
    files,
    toolOps,
    stages: stages.map((s) => ({
      name: s.name, agent: s.agent, status: s.status, gate: !!s.gate,
      repairs: s.repairs || 0, recovered: !!s.recovered,
      verified: s.verified, tools: s.tools || 0
    }))
  };
}

// Human-readable rendering for the CLI / logs.
export function formatReport(rep) {
  const bar = readinessBar(rep.readiness);
  const head = [
    `RELEASE READINESS — ${rep.level.toUpperCase()}  ${bar} ${rep.readiness}/100`,
    `goal: ${rep.goal}`,
    `workflow: ${rep.workflow} · status: ${rep.status}${rep.blockedAt ? ` (blocked at ${rep.blockedAt} · ${rep.blockedReason})` : ''}`,
    `gates: ${rep.gates.passed}/${rep.gates.total} passed · auto-fixes: ${rep.repairs}${rep.recovered.length ? ` · recovered: ${rep.recovered.join(', ')}` : ''} · tool ops: ${rep.toolOps}`
  ];
  const lines = rep.stages.map((s) => {
    const icon = s.status === 'ok' ? '✓' : '✗';
    const tags = [
      s.gate ? 'gate' : null,
      s.verified === true ? 'verified' : s.verified === false ? 'verify-fail' : null,
      s.repairs ? `repairs:${s.repairs}` : null,
      s.recovered ? 'recovered' : null
    ].filter(Boolean).join(' ');
    return `  ${icon} ${s.name} [${s.agent}]${tags ? '  · ' + tags : ''}`;
  });
  const files = rep.files.length ? ['files written:', ...rep.files.map((f) => '  - ' + f)] : [];
  return [...head, '', ...lines, ...(files.length ? ['', ...files] : [])].join('\n');
}

function readinessBar(pct) {
  const n = Math.round((Math.max(0, Math.min(100, pct)) / 100) * 10);
  return '[' + '█'.repeat(n) + '░'.repeat(10 - n) + ']';
}
