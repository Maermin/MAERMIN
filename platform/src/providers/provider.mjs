// AI provider adapter — the seam that makes the model layer swappable
// (Claude / OpenAI / Gemini / local). Every agent talks ONLY to this interface,
// so providers are interchangeable per stage/project.
//
//   interface Provider {
//     name: string
//     complete({ system, prompt, model, temperature }) -> Promise<string>
//     embed?(text) -> Promise<number[]>
//   }

// ---- Mock provider (deterministic; used by tests + offline dev) -------------
// Produces role-aware, structured output so the workflow can be exercised end to
// end without network or API keys.
export class MockProvider {
  constructor(opts = {}) { this.name = 'mock'; this._fail = opts.fail || {}; }
  async complete({ system = '', prompt = '' }) {
    const role = (system.match(/ROLE:\s*(\w[\w-]*)/) || [])[1] || 'agent';
    // Allow tests to force a gate failure for a given role.
    if (this._fail[role]) return `STATUS: fail\nFINDING: forced ${role} failure for test`;
    const goal = (prompt.match(/GOAL:\s*(.+)/) || [, 'the goal'])[1].trim();
    const canUseTools = /AVAILABLE TOOLS/.test(prompt);
    const afterResults = /TOOL RESULTS/.test(prompt);

    // When tools are offered, the developer "writes" a file on its first turn, then
    // finishes once it sees the tool result — exercising the full agentic loop with
    // no network. Other roles, and follow-up turns, just emit their text artifact.
    if (role === 'developer' && canUseTools && !afterResults) {
      const slug = (goal.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 40)) || 'app';
      const file = `src/${slug}.js`;
      return [
        `STATUS: ok`,
        `# developer output`,
        `Implementing: ${goal}`,
        `DECISION: developer scaffolded ${file} for "${goal}".`,
        '```tool',
        JSON.stringify({ tool: 'fs.write', path: file, content: `// ${goal}\nexport function main() {\n  return ${JSON.stringify(goal)};\n}\n` }),
        '```'
      ].join('\n');
    }

    return [
      `STATUS: ok`,
      `# ${role} output`,
      `Addressed: ${goal}`,
      `DECISION: ${role} produced its artifact for "${goal}".`
    ].join('\n');
  }
  async embed(text) {
    // Cheap deterministic pseudo-embedding (hash buckets) — real providers
    // override this. Good enough for lexical-adjacent similarity in tests.
    const v = new Array(16).fill(0);
    for (let i = 0; i < text.length; i++) v[i % 16] += text.charCodeAt(i) % 17;
    const n = Math.hypot(...v) || 1;
    return v.map((x) => x / n);
  }
}

// ---- Claude provider (thin REST wrapper) -----------------------------------
export class ClaudeProvider {
  constructor({ apiKey, model = 'claude-opus-4-8', fetchImpl } = {}) {
    this.name = 'claude'; this.apiKey = apiKey; this.model = model;
    this._fetch = fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
  }
  async complete({ system = '', prompt = '', model, temperature = 0.2 }) {
    if (!this._fetch) throw new Error('no fetch available');
    const res = await this._fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': this.apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: model || this.model, max_tokens: 4096, temperature, system, messages: [{ role: 'user', content: prompt }] })
    });
    if (!res.ok) throw new Error('claude http ' + res.status);
    const data = await res.json();
    return (data.content || []).map((b) => b.text || '').join('');
  }
}

// ---- OpenAI provider (thin REST wrapper) -----------------------------------
export class OpenAIProvider {
  constructor({ apiKey, model = 'gpt-4o', fetchImpl } = {}) {
    this.name = 'openai'; this.apiKey = apiKey; this.model = model;
    this._fetch = fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
  }
  async complete({ system = '', prompt = '', model, temperature = 0.2 }) {
    if (!this._fetch) throw new Error('no fetch available');
    const res = await this._fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + this.apiKey },
      body: JSON.stringify({ model: model || this.model, temperature, messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }] })
    });
    if (!res.ok) throw new Error('openai http ' + res.status);
    const data = await res.json();
    return data.choices?.[0]?.message?.content || '';
  }
}

// Factory — central place to add Gemini / local adapters later.
export function createProvider(kind, opts = {}) {
  switch (kind) {
    case 'claude': return new ClaudeProvider(opts);
    case 'openai': return new OpenAIProvider(opts);
    case 'mock': default: return new MockProvider(opts);
  }
}
