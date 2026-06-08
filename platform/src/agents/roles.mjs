// Specialised agent roles + a generic Agent that drives any of them through the
// provider adapter. Each agent is stateless: all state arrives via `ctx`
// (goal, prior artifacts, retrieved memory, optional workspace). run() returns a
// uniform result so the workflow engine can sequence, gate and persist them
// identically. With a workspace, the agent runs a bounded tool-using loop so it
// can act on a real repo; without one it is a single completion (legacy path).

import { TOOL_PROMPT, parseToolCalls, executeToolCalls, renderResults } from '../tools/protocol.mjs';

export const ROLES = {
  architect: {
    role: 'architect',
    system: 'ROLE: architect. You design system architecture, make tech-stack and data-model decisions, and emit ADRs. Output concise, decision-first.'
  },
  pm: {
    role: 'pm',
    system: 'ROLE: pm. You turn architecture into a plan: epics, features, tasks, subtasks with estimates and priorities.'
  },
  developer: {
    role: 'developer',
    system: 'ROLE: developer. You implement backend, frontend, APIs and databases as concrete diffs and files.'
  },
  test: {
    role: 'test',
    system: 'ROLE: test. You write and run unit, integration and e2e tests. Emit "STATUS: fail" if quality gates are not met.',
    gate: true
  },
  security: {
    role: 'security',
    system: 'ROLE: security. You run OWASP checks, secret detection and dependency audits. Emit "STATUS: fail" on a blocking finding.',
    gate: true
  },
  devops: {
    role: 'devops',
    system: 'ROLE: devops. You handle Docker, CI/CD, Kubernetes and deployments.'
  },
  docs: {
    role: 'docs',
    system: 'ROLE: docs. You produce README, API docs, changelogs and release notes.'
  }
};

export class Agent {
  constructor(roleKey, provider, opts = {}) {
    const def = ROLES[roleKey];
    if (!def) throw new Error('unknown role: ' + roleKey);
    this.roleKey = roleKey;
    this.def = def;
    this.provider = provider;
    this.model = opts.model;
  }

  // ctx: { goal, artifacts: {stageName: text}, memory: [entries], workspace?, maxSteps? }
  async run(ctx) {
    const prior = Object.entries(ctx.artifacts || {})
      .map(([k, v]) => `## ${k}\n${truncate(v, 800)}`).join('\n\n');
    const recall = (ctx.memory || []).map((m) => `- (${m.kind}) ${truncate(m.text, 160)}`).join('\n');
    const base = [
      `GOAL: ${ctx.goal}`,
      prior ? `\nPRIOR ARTIFACTS:\n${prior}` : '',
      recall ? `\nRELEVANT MEMORY:\n${recall}` : ''
    ].join('\n');

    // Legacy single-shot path — no workspace, nothing to act on.
    if (!ctx.workspace) {
      const prompt = `${base}\nProduce your ${this.def.role} artifact. Start with "STATUS: ok" or "STATUS: fail".`;
      return this._finalize(await this.provider.complete({ system: this.def.system, prompt, model: this.model }));
    }

    // Agentic path — bounded loop: complete → run tool calls → feed results back.
    const maxSteps = ctx.maxSteps || 4;
    let prompt = `${base}\n${TOOL_PROMPT}\nProduce your ${this.def.role} artifact. Start with "STATUS: ok" or "STATUS: fail".`;
    let transcript = '';
    const toolLog = [];
    let last = '';
    for (let step = 0; step < maxSteps; step++) {
      last = await this.provider.complete({ system: this.def.system, prompt, model: this.model });
      transcript += (transcript ? '\n\n' : '') + last;
      const calls = parseToolCalls(last);
      if (calls.length === 0) break; // agent declared itself done
      const results = await executeToolCalls(ctx.workspace, calls);
      toolLog.push(...results);
      prompt = `${base}\n${TOOL_PROMPT}\nTOOL RESULTS (continue with more tool blocks, or finish with "STATUS: ok" and no tool block):\n${renderResults(results)}`;
    }
    return this._finalize(transcript, toolLog);
  }

  _finalize(text, toolLog) {
    const status = /STATUS:\s*fail/i.test(text) ? 'fail' : 'ok';
    const decisions = (text.match(/DECISION:\s*(.+)/gi) || []).map((d) => d.replace(/DECISION:\s*/i, '').trim());
    const out = { agent: this.roleKey, status, artifacts: text, decisions, summary: firstLine(text) };
    if (toolLog) out.toolLog = toolLog;
    return out;
  }
}

function truncate(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n) + '…' : s; }
function firstLine(s) { return String(s || '').split('\n').find((l) => l.trim()) || ''; }
