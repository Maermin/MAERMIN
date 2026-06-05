// Configurable multi-agent workflow engine.
// A workflow is DATA: an ordered list of stages, each mapped to an agent role,
// optionally a blocking gate. The engine runs each stage through its agent,
// feeds prior artifacts + retrieved memory forward, persists every step, and
// halts at a failed gate (the seed of the human/auto-fix loop).

import { Agent, ROLES } from '../agents/roles.mjs';

// Default pipeline: Idea → Architecture → Plan → Implement → Test → Security →
// Docs → Deploy. Reorder/skip per project by passing your own config.
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
  constructor({ provider, memory, workspace, hooks = {} } = {}) {
    if (!provider) throw new Error('WorkflowEngine requires a provider');
    this.provider = provider;
    this.memory = memory || null;
    this.workspace = workspace || null; // optional ToolBus: real fs/git/shell/http
    this.hooks = hooks; // { onStageStart, onStageEnd, onBlocked }
  }

  async run(goal, config = DEFAULT_WORKFLOW) {
    if (!goal) throw new Error('goal required');
    const run = { goal, workflow: config.name, status: 'running', startedAt: Date.now(), stages: [] };
    const artifacts = {};

    for (let i = 0; i < config.stages.length; i++) {
      const stage = config.stages[i];
      const def = ROLES[stage.agent];
      const isGate = stage.gate ?? def?.gate ?? false;

      emit(this.hooks.onStageStart, { run, stage, idx: i });

      // Retrieve relevant memory for this stage's context.
      let recall = [];
      if (this.memory) { try { recall = await this.memory.search(goal + ' ' + stage.name, 5); } catch {} }

      const agent = new Agent(stage.agent, this.provider, { model: stage.model });
      let result;
      try {
        // workspace (the ToolBus) is reachable to agents that need to act on a repo.
        result = await agent.run({ goal, artifacts, memory: recall, workspace: this.workspace });
      } catch (e) {
        result = { agent: stage.agent, status: 'error', artifacts: '', decisions: [], summary: 'error: ' + e.message };
      }

      const rec = { name: stage.name, agent: stage.agent, idx: i, gate: isGate, status: result.status, summary: result.summary, decisions: result.decisions };
      if (result.toolLog) rec.tools = result.toolLog.length; // # of tool calls this stage ran
      run.stages.push(rec);
      artifacts[stage.name] = result.artifacts;

      // If a sandboxed workspace is present, persist the artifact to a real file
      // through the audited bus — the concrete step from "text" to "files on disk".
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

      // Blocking gate: stop the pipeline, mark blocked.
      if (isGate && result.status !== 'ok') {
        run.status = 'blocked';
        run.blockedAt = stage.name;
        run.finishedAt = Date.now();
        emit(this.hooks.onBlocked, { run, stage: rec });
        return { run, artifacts };
      }
      if (result.status === 'error') {
        run.status = 'error';
        run.finishedAt = Date.now();
        return { run, artifacts };
      }
    }

    run.status = 'completed';
    run.finishedAt = Date.now();
    return { run, artifacts };
  }
}

function emit(fn, payload) { if (typeof fn === 'function') { try { fn(payload); } catch {} } }
