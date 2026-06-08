// Tool-call protocol — the bridge between a model's text output and the ToolBus.
// Native function-calling differs per provider and would bloat the thin provider
// wrappers, so v1 uses a single provider-agnostic TEXT protocol: an agent emits
// fenced ```tool blocks of JSON, we parse them, run each through the (guarded,
// audited) bus, and feed the results back for the next turn. Mock and real models
// use the exact same channel, so the agentic loop is fully testable offline.
//
//   ```tool
//   {"tool":"fs.write","path":"src/app.js","content":"export const x = 1;"}
//   ```

// Prompt fragment appended when an agent has a workspace. The "AVAILABLE TOOLS"
// marker is also how a provider knows tool use is permitted this turn.
export const TOOL_PROMPT = [
  'AVAILABLE TOOLS — to act on the workspace, emit one or more fenced blocks:',
  '```tool',
  '{"tool":"fs.write","path":"src/x.js","content":"..."}',
  '```',
  'Tools: fs.write{path,content} · fs.read{path} · fs.list{path} · fs.exists{path} ·',
  'shell.exec{cmd} or {args:["prog","arg"]} · git.add{path?} · git.commit{message} ·',
  'git.branch{name} · git.status · git.diff · http.fetch{url}.',
  'Emit tool blocks to make changes; when finished, reply "STATUS: ok" with NO tool block.'
].join('\n');

const BLOCK_RE = /```tool\s*\n([\s\S]*?)```/g;

function tryJson(s) { try { return JSON.parse(s); } catch { return null; } }
function isCall(o) { return o && typeof o === 'object' && typeof o.tool === 'string'; }

// Extract every tool call from a model response. A block may hold one JSON object,
// a JSON array, or JSON-lines — all are accepted.
export function parseToolCalls(text) {
  const calls = [];
  const src = String(text || '');
  BLOCK_RE.lastIndex = 0;
  let m;
  while ((m = BLOCK_RE.exec(src))) {
    const body = m[1].trim();
    const whole = tryJson(body);
    if (Array.isArray(whole)) { for (const o of whole) if (isCall(o)) calls.push(o); }
    else if (isCall(whole)) { calls.push(whole); }
    else { for (const line of body.split('\n')) { const o = tryJson(line.trim()); if (isCall(o)) calls.push(o); } }
  }
  return calls;
}

// Run one parsed call against the bus. Unknown tools throw (recorded as an error
// in the result, never silently dropped). http returns status only, not the body,
// to keep tool results bounded.
function dispatch(bus, c) {
  switch (c.tool) {
    case 'fs.write':  return bus.fs.write(c.path, c.content);
    case 'fs.read':   return bus.fs.read(c.path);
    case 'fs.list':   return bus.fs.list(c.path || '.');
    case 'fs.exists': return bus.fs.exists(c.path);
    case 'fs.remove': return bus.fs.remove(c.path);
    case 'shell.exec':return bus.shell.exec(c.cmd || (Array.isArray(c.args) ? c.args[0] : ''), { args: c.args, cwd: c.cwd });
    case 'git.init':  return bus.git.init();
    case 'git.add':   return bus.git.add(c.path);
    case 'git.commit':return bus.git.commit(c.message || c.msg || 'update');
    case 'git.branch':return bus.git.branch(c.name);
    case 'git.status':return bus.git.status();
    case 'git.diff':  return bus.git.diff();
    case 'http.fetch':return bus.http.fetch(c.url, c.init || {}).then((r) => ({ status: r.status, ok: r.ok }));
    default: throw new Error('unknown tool: ' + c.tool);
  }
}

// Execute calls in order; each result is { tool, ok, result|error }. A failing
// call does not abort the batch — the model sees the error and can adapt.
export async function executeToolCalls(bus, calls) {
  const out = [];
  for (const c of calls) {
    try { out.push({ tool: c.tool, ok: true, result: await dispatch(bus, c) }); }
    catch (e) { out.push({ tool: c.tool, ok: false, error: String(e.message || e) }); }
  }
  return out;
}

// Render results back into the prompt for the next turn.
export function renderResults(results) {
  return results.map((r, i) => {
    const head = `[${i + 1}] ${r.tool} → ${r.ok ? 'ok' : 'ERROR'}`;
    const body = r.ok ? summarize(r.result) : r.error;
    return body ? `${head}: ${truncate(body, 300)}` : head;
  }).join('\n');
}

function summarize(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  try { return JSON.stringify(v); } catch { return String(v); }
}
function truncate(s, n) { s = String(s); return s.length > n ? s.slice(0, n) + '…' : s; }
