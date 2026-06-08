// Configurable multi-agent workflow engine.
// A workflow is DATA: an ordered list of stages, each mapped to an agent role,
// optionally a blocking gate and/or a `verify` command. The engine runs each
// stage through its agent, GROUNDS the result in real execution (verify), and —
// when a stage fails — drives a bounded AUTO-FIX loop (developer repairs the
// workspace, the stage re-runs) before giving up. Every step is persisted and a
// failed-after-repairs gate halts the run. This is the autonomy core: a blocked
// run is no longer a dead end, it is a run that exhausted its repair budget.

import { Agent, ROLES } from '../agents/roles.mjs';

// Default pipeline: Idea → Architecture → Plan → Implement → Test → Security →
// Docs → Deploy. Reorder/skip per project by passing your own config. Add a
// `verify` (shell string or fn) to any stage to ground its pass/fail in a real
// command instead of the model's self-report.
export const DEFAULT_WORKFLOW = {
  name: 'full-sdlc',
  stages: [
    { name: 'architecture', agent: 'architect' },
    { name: 'planning', agent: 'pm' },
    { name: 'implementation', agent: 'developer' },
    { name: 'testing', agent: 'test', gate: true },
    { name: 'security', agent: 'security', gate: true },
    { name: 'documentation', agent: 'docs' },
    { name: 'deployment', agent: 'devops' }
  ]
};

export class WorkflowEngine {
  constructor({ provider, memory, workspace, hooks = {}, maxRepairs = 2 } = {}) {
    if (!provider) throw new Error('WorkflowEngine requires a provider');
    this.provider = provider;
    this.memory = memory || null;
    this.workspace = workspace || null; // optional ToolBus: real fs/git/shell/http
    this.hooks = hooks; // { onStageStart, onStageEnd, onRepair, onBlocked }
    this.maxRepairs = maxRepairs; // auto-fix attempts per failing stage (0 = off)
  }

  async run(goal, config = DEFAULT_WORKFLOW) {
    if (!goal) throw new Error('goal required');
    const maxRepairs = config.maxRepairs ?? this.maxRepairs;
    const run = { goal, workflow: config.name, status: 'running', startedAt: Date.now(), stages: [], repairs: 0 };
    const artifacts = {};

    for (let i = 0; i < config.stages.length; i++) {
      const stage = config.stages[i];
      const def = ROLES[stage.agent];
      const isGate = stage.gate ?? def?.gate ?? false;

      emit(this.hooks.onStageStart, { run, stage, idx: i });

      // First attempt.
      let result = await this._runAgent(stage, goal, artifacts);
      let verify = await this._verify(stage, result);
      let outcome = this._outcome(isGate, result, verify);
      let repairsForStage = 0;

      // Auto-fix loop. While the stage is failing and budget remains, ask the
      // developer to repair the workspace using the REAL failure detail, then
      // re-run the stage agent and re-verify. Infra errors (exceptions) are not
      // repaired — they are not quality failures.
      while (outcome === 'fail' && result.status !== 'error' && repairsForStage < maxRepairs) {
        repairsForStage++; run.repairs++;
        const failure = (verify && !verify.ok) ? verify.detail : extractFinding(result.artifacts);
        emit(this.hooks.onRepair, { run, stage, attempt: repairsForStage, failure });
        await this._repair(stage, goal, artifacts, failure);
        result = await this._runAgent(stage, goal, artifacts);
        verify = await this._verify(stage, result);
        outcome = this._outcome(isGate, result, verify);
      }

      const rec = {
        name: stage.name, agent: stage.agent, idx: i, gate: isGate,
        status: outcome, summary: result.summary, decisions: result.decisions,
        repairs: repairsForStage
      };
      if (result.toolLog) rec.tools = result.toolLog.length;
      if (verify) rec.verified = verify.ok;
      if (repairsForStage && outcome === 'ok') rec.recovered = true;
      run.stages.push(rec);
      artifacts[stage.name] = result.artifacts;

      // Persist the (final) artifact to a real file through the audited bus.
      if (this.workspace) {
        try {
          const path = `runs/${run.startedAt}/${String(i).padStart(2, '0')}-${stage.name}.md`;
          await this.workspace.fs.write(path, result.artifacts);
          rec.artifactPath = path;
        } catch { /* never let artifact persistence break the run */ }
      }

      // Persist artifact + decisions to memory so later runs/stages recall them.
      if (this.memory) {
        await this.memory.record({ kind: 'history', text: `[${stage.name}] ${result.summary}`, meta: { stage: stage.name, agent: stage.agent } });
        for (const d of result.decisions) await this.memory.record({ kind: 'architecture', text: d, meta: { stage: stage.name } });
      }

      emit(this.hooks.onStageEnd, { run, stage: rec, artifact: result.artifacts });

      // Infra error: bail (not a gate failure, not repairable here).
      if (result.status === 'error') {
        run.status = 'error';
        run.finishedAt = Date.now();
        return { run, artifacts };
      }

      // Still failing after the repair budget: halt.
      if (outcome === 'fail') {
        run.status = 'blocked';
        run.blockedAt = stage.name;
        run.blockedReason = (verify && !verify.ok) ? 'verify' : 'gate';
        run.finishedAt = Date.now();
        emit(this.hooks.onBlocked, { run, stage: rec });
        return { run, artifacts };
      }
    }

    run.status = 'completed';
    run.finishedAt = Date.now();
    return { run, artifacts };
  }

  // ---- internals ------------------------------------------------------------

  async _runAgent(stage, goal, artifacts) {
    let recall = [];
    if (this.memory) { try { recall = await this.memory.search(goal + ' ' + stage.name, 5); } catch {} }
    const agent = new Agent(stage.agent, this.provider, { model: stage.model });
    try {
      return await agent.run({ goal, artifacts, memory: recall, workspace: this.workspace });
    } catch (e) {
      return { agent: stage.agent, status: 'error', artifacts: '', decisions: [], summary: 'error: ' + e.message };
    }
  }

  // Ground a stage in reality: run its `verify` (shell string or fn) against the
  // workspace. Returns { ok, detail } or null when there is nothing to verify.
  async _verify(stage, result) {
    if (!stage.verify || !this.workspace) return null;
    try {
      if (typeof stage.verify === 'function') {
        const v = await stage.verify({ workspace: this.workspace, result });
        const ok = v === true || (v && v.code === 0) || (v && v.ok === true);
        return { ok: !!ok, detail: ok ? '' : 'custom verify reported failure' };
      }
      const r = await this.workspace.shell.exec(stage.verify);
      const ok = r.code === 0;
      const detail = ok ? '' : `verify "${stage.verify}" exited ${r.code}\n${(r.stderr || '') + (r.stdout || '')}`.trim();
      return { ok, detail };
    } catch (e) {
      return { ok: false, detail: 'verify error: ' + (e.message || e) };
    }
  }

  // A stage fails if real execution (verify) failed, OR a gate's agent
  // self-reported fail. Non-gate stages without verify never block (legacy).
  _outcome(isGate, result, verify) {
    if (verify && !verify.ok) return 'fail';
    if (isGate && result.status !== 'ok') return 'fail';
    return 'ok';
  }

  // Hand the failure back to a developer agent that acts on the real workspace.
  async _repair(stage, goal, artifacts, failure) {
    const dev = new Agent('developer', this.provider);
    const ctx = {
      goal,
      artifacts: { ...artifacts, _repair: `STAGE "${stage.name}" FAILED — fix the code in the workspace so it passes.\n${truncate(failure, 1200)}` },
      memory: [],
      workspace: this.workspace
    };
    try { return await dev.run(ctx); } catch { return null; }
  }
}

function emit(fn, payload) { if (typeof fn === 'function') { try { fn(payload); } catch {} } }
function truncate(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n) + '…' : s; }
// Pull a gate agent's stated reason (FINDING:/first line) to seed the repair.
function extractFinding(text) {
  const t = String(text || '');
  const f = (t.match(/FINDING:\s*(.+)/i) || [])[1];
  return (f || t.split('\n').find((l) => l.trim()) || 'stage failed').trim();
}
