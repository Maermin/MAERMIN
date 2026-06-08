// Sandboxed tool bus — the execution substrate that turns text-only agents into
// agents that can actually touch a repo. Every side-effecting capability an agent
// has (filesystem, shell, git, network) goes through THIS object, so it is the one
// place to enforce the architecture's §13 guards:
//
//   • confinement     — all fs/shell work is rooted at `root`; path traversal and
//                        absolute escapes are rejected before any syscall.
//   • capability scope — caps = { fs, shell, git, http }; a denied capability
//                        throws, it never silently no-ops.
//   • SSRF allow-list  — http.fetch only reaches hosts you explicitly allow; literal
//                        loopback / private / link-local IPs are blocked outright.
//   • append-only audit— every op records { tool, op, target, ok, at } so a run is
//                        fully reconstructable (the seed of the `events` table).
//
// Zero dependencies (node builtins only); the real BullMQ runner wraps an instance
// of this per job, inside an ephemeral container.

import {
  readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, readdirSync, statSync
} from 'node:fs';
import { resolve, join, sep, dirname, relative, isAbsolute } from 'node:path';
import { spawnSync } from 'node:child_process';

const PRIVATE_IP = /^(127\.|10\.|192\.168\.|169\.254\.|0\.0\.0\.0|::1$|fe80:|fc00:|fd00:)/i;
const PRIVATE_HOST = /^(localhost|0\.0\.0\.0|metadata\.google\.internal)$/i;

export class ToolBus {
  // opts: { root, caps?, allowHosts?, timeoutMs?, maxBuffer?, onAudit? }
  constructor(opts = {}) {
    if (!opts.root) throw new Error('ToolBus requires a sandbox root');
    this.root = resolve(opts.root);
    mkdirSync(this.root, { recursive: true });
    this.caps = { fs: true, shell: true, git: true, http: true, ...(opts.caps || {}) };
    // http is allow-list-first: an empty list denies all outbound requests.
    this.allowHosts = new Set((opts.allowHosts || []).map((h) => h.toLowerCase()));
    this.timeoutMs = opts.timeoutMs ?? 30_000;
    this.maxBuffer = opts.maxBuffer ?? 8 * 1024 * 1024;
    this.onAudit = typeof opts.onAudit === 'function' ? opts.onAudit : null;
    // Injectable fetch (tests/non-global runtimes); falls back to global fetch.
    this._fetch = opts.fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
    this.audit = [];

    // Bind capability namespaces so callers can destructure (`const { fs } = bus`).
    this.fs = {
      read: this._fsRead.bind(this), write: this._fsWrite.bind(this),
      list: this._fsList.bind(this), exists: this._fsExists.bind(this),
      mkdir: this._fsMkdir.bind(this), remove: this._fsRemove.bind(this)
    };
    this.shell = { exec: this._shellExec.bind(this) };
    this.git = {
      clone: this._gitClone.bind(this), init: (o) => this._git(['init'], o),
      status: (o) => this._git(['status', '--porcelain'], o),
      add: (p, o) => this._git(['add', p == null ? '-A' : p], o),
      commit: (msg, o) => this._git(['commit', '-m', String(msg)], o),
      branch: (name, o) => this._git(['checkout', '-b', String(name)], o),
      diff: (o) => this._git(['diff', '--stat'], o),
      currentBranch: (o) => this._git(['rev-parse', '--abbrev-ref', 'HEAD'], o)
    };
    this.http = { fetch: this._httpFetch.bind(this) };
  }

  // ---- internals --------------------------------------------------------------

  _record(tool, op, target, ok, error) {
    const e = { tool, op, target: String(target ?? ''), ok, at: Date.now() };
    if (error) e.error = String(error.message || error);
    this.audit.push(e);
    if (this.onAudit) { try { this.onAudit(e); } catch {} }
    return e;
  }

  _need(cap) {
    if (!this.caps[cap]) {
      const err = new Error(`capability denied: ${cap}`);
      this._record(cap, 'denied', cap, false, err);
      throw err;
    }
  }

  // Resolve a caller-supplied path INSIDE the sandbox; reject any escape.
  _resolve(p) {
    if (typeof p !== 'string' || p.length === 0) throw new Error('path required');
    if (isAbsolute(p)) throw new Error('absolute paths are not allowed: ' + p);
    const abs = resolve(this.root, p);
    const rel = relative(this.root, abs);
    if (rel === '' ) return abs; // the root itself
    if (rel.startsWith('..') || isAbsolute(rel)) {
      throw new Error('path escapes sandbox root: ' + p);
    }
    return abs;
  }

  // ---- fs ---------------------------------------------------------------------

  async _fsRead(p) {
    this._need('fs');
    try { const abs = this._resolve(p); const out = readFileSync(abs, 'utf8'); this._record('fs', 'read', p, true); return out; }
    catch (e) { this._record('fs', 'read', p, false, e); throw e; }
  }

  async _fsWrite(p, content) {
    this._need('fs');
    try {
      const abs = this._resolve(p);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, String(content ?? ''));
      this._record('fs', 'write', p, true);
      return abs;
    } catch (e) { this._record('fs', 'write', p, false, e); throw e; }
  }

  async _fsList(p = '.') {
    this._need('fs');
    try {
      const abs = this._resolve(p);
      const out = readdirSync(abs).map((name) => {
        const st = statSync(join(abs, name));
        return { name, dir: st.isDirectory(), size: st.size };
      });
      this._record('fs', 'list', p, true);
      return out;
    } catch (e) { this._record('fs', 'list', p, false, e); throw e; }
  }

  async _fsExists(p) {
    this._need('fs');
    try { const abs = this._resolve(p); const ok = existsSync(abs); this._record('fs', 'exists', p, true); return ok; }
    catch (e) { this._record('fs', 'exists', p, false, e); throw e; }
  }

  async _fsMkdir(p) {
    this._need('fs');
    try { const abs = this._resolve(p); mkdirSync(abs, { recursive: true }); this._record('fs', 'mkdir', p, true); return abs; }
    catch (e) { this._record('fs', 'mkdir', p, false, e); throw e; }
  }

  async _fsRemove(p) {
    this._need('fs');
    try { const abs = this._resolve(p); rmSync(abs, { recursive: true, force: true }); this._record('fs', 'remove', p, true); }
    catch (e) { this._record('fs', 'remove', p, false, e); throw e; }
  }

  // ---- shell ------------------------------------------------------------------

  // exec(cmd, { args?, cwd?, timeoutMs?, env? }). cwd is confined to the sandbox.
  async _shellExec(cmd, opts = {}) {
    this._need('shell');
    if (typeof cmd !== 'string' || !cmd.trim()) throw new Error('command required');
    const cwd = opts.cwd ? this._resolve(opts.cwd) : this.root;
    const useArgs = Array.isArray(opts.args);
    try {
      const r = spawnSync(cmd, useArgs ? opts.args : [], {
        cwd,
        shell: !useArgs,            // arg-array form avoids the shell (no injection)
        timeout: opts.timeoutMs ?? this.timeoutMs,
        maxBuffer: this.maxBuffer,
        encoding: 'utf8',
        env: { ...process.env, ...(opts.env || {}) }
      });
      const out = {
        code: r.status,
        stdout: r.stdout || '',
        stderr: r.stderr || '',
        timedOut: r.signal === 'SIGTERM' && r.status === null
      };
      this._record('shell', 'exec', cmd, out.code === 0);
      return out;
    } catch (e) { this._record('shell', 'exec', cmd, false, e); throw e; }
  }

  // ---- git (thin, audited wrappers over shell) --------------------------------

  async _git(args, opts = {}) {
    this._need('git');
    const r = await this._shellExec('git', { ...opts, args });
    this._record('git', args[0], args.join(' '), r.code === 0);
    if (r.code !== 0 && !opts.allowFail) throw new Error('git ' + args[0] + ' failed: ' + (r.stderr || r.stdout));
    return r;
  }

  // clone(url, dir) — dir is sandbox-relative; url goes through the http allow-list
  // so you cannot clone from an arbitrary internal host.
  async _gitClone(url, dir = 'repo', opts = {}) {
    this._need('git');
    this._assertUrlAllowed(url, 'git.clone');
    const target = this._resolve(dir);
    return this._git(['clone', '--depth', String(opts.depth || 1), String(url), target], { allowFail: opts.allowFail });
  }

  // ---- http (SSRF allow-list) -------------------------------------------------

  _assertUrlAllowed(url, op) {
    let u;
    try { u = new URL(String(url)); } catch { const e = new Error('invalid url'); this._record('http', op, url, false, e); throw e; }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
      const e = new Error('protocol not allowed: ' + u.protocol);
      this._record('http', op, url, false, e); throw e;
    }
    const host = u.hostname.toLowerCase();
    if (PRIVATE_HOST.test(host) || PRIVATE_IP.test(host)) {
      const e = new Error('blocked private/loopback host: ' + host);
      this._record('http', op, url, false, e); throw e;
    }
    if (!this.allowHosts.has(host)) {
      const e = new Error('host not in allow-list: ' + host);
      this._record('http', op, url, false, e); throw e;
    }
    return u;
  }

  async _httpFetch(url, init = {}) {
    this._need('http');
    this._assertUrlAllowed(url, 'fetch');
    if (!this._fetch) throw new Error('no fetch available');
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), init.timeoutMs ?? this.timeoutMs);
    try {
      const res = await this._fetch(String(url), { ...init, signal: ctrl.signal, redirect: 'manual' });
      this._record('http', 'fetch', url, res.ok);
      return res;
    } catch (e) { this._record('http', 'fetch', url, false, e); throw e; }
    finally { clearTimeout(timer); }
  }
}

// Factory — mirrors createProvider(); the central place to construct a scoped bus.
export function createToolBus(opts = {}) { return new ToolBus(opts); }
