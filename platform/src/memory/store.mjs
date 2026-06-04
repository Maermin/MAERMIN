// Project memory — the long-term knowledge the agents must never lose.
// In-memory by default with optional JSON-file persistence; retrieval is hybrid
// (lexical now, vector-ready via an injected embed()). This is the seed of the
// pgvector-backed RAG service described in the architecture doc.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

export class MemoryStore {
  constructor(opts = {}) {
    this.file = opts.file || null;          // optional JSON persistence
    this.embed = opts.embed || null;        // optional async (text)->number[]
    this.entries = [];
    if (this.file && existsSync(this.file)) {
      try { this.entries = JSON.parse(readFileSync(this.file, 'utf8')) || []; } catch { this.entries = []; }
    }
  }

  _persist() { if (this.file) { try { writeFileSync(this.file, JSON.stringify(this.entries, null, 2)); } catch {} } }

  // Record a memory. kind ∈ architecture|development|user|history.
  async record({ kind = 'history', text = '', meta = {} }) {
    const entry = { id: this.entries.length + 1, kind, text: String(text), meta, at: Date.now() };
    if (this.embed) { try { entry.vector = await this.embed(entry.text); } catch {} }
    this.entries.push(entry);
    this._persist();
    return entry;
  }

  all(filter = {}) {
    return this.entries.filter((e) => (!filter.kind || e.kind === filter.kind));
  }

  // Hybrid retrieval: vector cosine when embeddings exist, else lexical overlap.
  async search(query, k = 5) {
    if (!query || this.entries.length === 0) return [];
    let scored;
    if (this.embed && this.entries.some((e) => e.vector)) {
      const q = await this.embed(query);
      scored = this.entries.map((e) => ({ e, s: e.vector ? cosine(q, e.vector) : 0 }));
    } else {
      const terms = tokenize(query);
      scored = this.entries.map((e) => ({ e, s: lexical(terms, tokenize(e.text)) }));
    }
    return scored.filter((x) => x.s > 0).sort((a, b) => b.s - a.s).slice(0, k).map((x) => x.e);
  }
}

function tokenize(s) { return String(s).toLowerCase().match(/[a-z0-9]+/g) || []; }
function lexical(qTerms, dTerms) {
  if (!qTerms.length || !dTerms.length) return 0;
  const set = new Set(dTerms);
  let hit = 0; for (const t of qTerms) if (set.has(t)) hit++;
  return hit / qTerms.length;
}
function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return (na && nb) ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}
