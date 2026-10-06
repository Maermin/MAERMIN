// ============================================================================
// MAERMIN — First-Run Onboarding  (window.MaerminOnboarding)
// ----------------------------------------------------------------------------
// The biggest adoption hurdle is the Cloudflare-Worker setup. This module turns
// it into a guided wizard:
//   • step-by-step deploy guide + one-click "Copy worker.js"
//   • a live "Test connection" that pings each data-source endpoint (yf,
//     yfsearch, skinprices) and reports green / amber / red per source
//   • a Demo-mode entry so newcomers can explore the full app before any setup.
//
// Pure logic (endpoints/classify/probe/fetchWorkerSource) is dual-exported and
// unit-tested under Node with an injected fetch; the React `Wizard` is built
// with React.createElement (no JSX) and only renders in the browser.
// ============================================================================
(function () {
  'use strict';
// Translation lookup (i18n.js): __('key', 'English fallback', { slot: value }).
function __(k, f, v) { return (typeof window !== 'undefined' && window.MaerminI18n ? window.MaerminI18n : require('./i18n.js')).t(k, f, v); }

  var GITHUB_WORKER_URL = 'https://github.com/Maermin/MAERMIN/blob/main/cf-worker/worker.js';
  // One-click deploy: Cloudflare copies cf-worker/ into the user's GitHub,
  // creates the KV namespace and deploys (Workers Builds).
  var DEPLOY_URL = 'https://deploy.workers.cloudflare.com/?url=https://github.com/Maermin/MAERMIN/tree/main/cf-worker';
  // The Worker version this release relies on: WORKER_VERSION in
  // cf-worker/worker.js (test/worker-version.test.js keeps them equal).
  var EXPECTED_WORKER_VERSION = '2026.10.2';

  // ---- pure: version compare ("2026.10.1" vs "2026.9.4"), per numeric part --
  function compareVersions(a, b) {
    var pa = String(a || '').split('.'), pb = String(b || '').split('.');
    for (var i = 0; i < Math.max(pa.length, pb.length); i++) {
      var x = parseInt(pa[i], 10) || 0, y = parseInt(pb[i], 10) || 0;
      if (x !== y) return x < y ? -1 : 1;
    }
    return 0;
  }

  // ---- pure: what a ?action=version answer means ---------------------------
  // outcome = { networkError?, status?, payload? } -> { state, version }
  // state: 'current' | 'outdated' | 'newer' | 'unreachable'. A Worker from
  // before the version route answers 400 "Unknown action": outdated.
  function versionState(outcome, expected) {
    outcome = outcome || {}; expected = expected || EXPECTED_WORKER_VERSION;
    if (outcome.networkError || typeof outcome.status !== 'number') return { state: 'unreachable', version: null };
    var p = outcome.payload, v = p && typeof p === 'object' && typeof p.version === 'string' ? p.version : null;
    if (!v) return { state: outcome.status >= 500 ? 'unreachable' : 'outdated', version: null };
    var c = compareVersions(v, expected);
    return { state: c < 0 ? 'outdated' : (c > 0 ? 'newer' : 'current'), version: v };
  }

  // ---- impure: ask the Worker for its version (fetch injectable) -----------
  function checkWorkerVersion(workerUrl, opts) {
    opts = opts || {};
    var doFetch = opts.fetch || (typeof fetch !== 'undefined' ? fetch : null);
    var base = normalizeWorkerUrl(workerUrl);
    if (!base || !doFetch) return Promise.resolve({ state: 'unreachable', version: null, expected: EXPECTED_WORKER_VERSION });
    var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, opts.timeoutMs || 8000) : null;
    return doFetch(base + '?action=version', { method: 'GET', signal: ctrl ? ctrl.signal : undefined })
      .then(function (r) {
        return r.text().then(function (txt) {
          var payload; try { payload = JSON.parse(txt); } catch (e) { payload = null; }
          return versionState({ status: r.status, payload: payload });
        });
      }, function () { return versionState({ networkError: 'network' }); })
      .then(function (out) { if (timer) clearTimeout(timer); out.expected = EXPECTED_WORKER_VERSION; return out; });
  }

  // ---- pure: worker URL helpers -------------------------------------------
  function normalizeWorkerUrl(url) {
    return String(url || '').trim().replace(/\/+$/, '');
  }
  function isValidWorkerUrl(url) {
    return /^https?:\/\/[^\s]+$/i.test(normalizeWorkerUrl(url));
  }

  // The three data-source endpoints the app depends on, each with a cheap probe
  // using a well-known query so a healthy worker returns real data.
  function endpoints(workerUrl) {
    var base = normalizeWorkerUrl(workerUrl);
    return [
      { id: 'yf',           label: __('obEpYf', 'Stock & ETF prices (Yahoo Finance)'),
        url: base + '?action=yf&symbol=AAPL&interval=1d&range=5d' },
      { id: 'yfsearch',     label: __('obEpSearch', 'Symbol search'),
        url: base + '?action=yfsearch&q=Apple&type=stock' },
      { id: 'skinprices',   label: __('obEpSkins', 'CS2 skin prices (Steam Market list)'),
        url: base + '?action=skinprices' }
    ];
  }

  // ---- pure: classify a probe outcome -------------------------------------
  // outcome = { networkError?:string, status?:number, payload?:any }
  // → { state:'ok'|'warn'|'fail', message:string }
  function classify(id, outcome) {
    outcome = outcome || {};
    if (outcome.networkError) {
      return { state: 'fail', message: __('obUnreachable', 'Could not reach the Worker — {why}. Check the URL is correct, deployed, and not blocked by CORS.', { why: outcome.networkError }) };
    }
    var status = outcome.status, p = outcome.payload;
    if (typeof status !== 'number' || status < 200 || status >= 300) {
      var emsg = (p && p.error) ? p.error : ('HTTP ' + status);
      return { state: 'fail', message: __('obRespError', 'Worker responded with an error: {msg}', { msg: emsg }) };
    }
    if (p && p.error) return { state: 'fail', message: __('obWorkerError', 'Worker error: {msg}', { msg: p.error }) };

    var hasData;
    if (id === 'yf') hasData = !!(p && Array.isArray(p.prices) && p.prices.length);
    else if (id === 'skinprices') hasData = !!(p && typeof p === 'object' && !Array.isArray(p) && Object.keys(p).length > 0);
    else hasData = Array.isArray(p) && p.length > 0; // yfsearch returns an array

    if (hasData) return { state: 'ok', message: __('obConnected', 'Connected — live data received.') };
    return { state: 'warn', message: __('obNoData', 'Worker reachable, but the source returned no data right now (rate limit or a temporary upstream issue). The connection itself works.') };
  }

  // ---- impure: run probes (fetch injectable for Node tests) ---------------
  function probe(ep, opts) {
    opts = opts || {};
    var doFetch = opts.fetch || (typeof fetch !== 'undefined' ? fetch : null);
    var timeoutMs = opts.timeoutMs || 12000;
    var base = { id: ep.id, label: ep.label };
    if (!doFetch) return Promise.resolve(Object.assign({}, base, { state: 'fail', message: __('obNoFetch', 'No fetch in this environment.') }));

    var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, timeoutMs) : null;
    var t0 = Date.now();
    return doFetch(ep.url, { method: 'GET', signal: ctrl ? ctrl.signal : undefined })
      .then(function (r) {
        return r.text().then(function (txt) {
          var payload; try { payload = JSON.parse(txt); } catch (e) { payload = txt; }
          var c = classify(ep.id, { status: r.status, payload: payload });
          return Object.assign({}, base, { state: c.state, message: c.message, status: r.status, ms: Date.now() - t0 });
        });
      })
      .catch(function (e) {
        var why = (e && e.name === 'AbortError') ? __('obTimedOut', 'timed out') : ((e && e.message) || __('obNetworkError', 'network error'));
        var c = classify(ep.id, { networkError: why });
        return Object.assign({}, base, { state: c.state, message: c.message, ms: Date.now() - t0 });
      })
      .then(function (out) { if (timer) clearTimeout(timer); return out; });
  }

  function probeAll(workerUrl, opts) {
    return Promise.all(endpoints(workerUrl).map(function (ep) { return probe(ep, opts); })
      .concat([checkWorkerVersion(workerUrl, opts).then(versionRow)]));
  }

  // The version as a result row of the connection test. Outdated is a warning:
  // the data routes above may still work, newer features may not.
  function versionRow(v) {
    var row = { id: 'version', label: __('obEpVersion', 'Worker version') };
    if (v.state === 'current' || v.state === 'newer') return Object.assign(row, { state: 'ok', message: __('obVersionOk', 'Version {v} — up to date.', { v: v.version }) });
    if (v.state === 'outdated') return Object.assign(row, { state: 'warn', outdated: true, message: v.version
      ? __('obVersionOld', 'Version {v} is outdated (this app expects {e}). Update the Worker so every feature works.', { v: v.version, e: v.expected })
      : __('obVersionNone', 'This Worker is older than {e} and does not report a version. Update it so every feature works.', { e: v.expected }) });
    return Object.assign(row, { state: 'fail', message: __('obVersionUnknown', 'Could not read the Worker version.') });
  }

  // ---- impure: fetch the bundled worker.js text for the copy button -------
  function fetchWorkerSource(opts) {
    opts = opts || {};
    var doFetch = opts.fetch || (typeof fetch !== 'undefined' ? fetch : null);
    if (!doFetch) return Promise.reject(new Error('no-fetch'));
    var paths = opts.paths || ['cf-worker/worker.js', './cf-worker/worker.js'];
    var i = 0;
    function tryNext() {
      if (i >= paths.length) return Promise.reject(new Error('worker-src-unavailable'));
      var path = paths[i++];
      return doFetch(path).then(function (r) {
        if (!r.ok) return tryNext();
        return r.text();
      }, tryNext);
    }
    return tryNext();
  }

  // ---- React wizard (browser only) ----------------------------------------
  function Wizard(props) {
    var React = (typeof window !== 'undefined') ? window.React : null;
    if (!React) return null;
    var h = React.createElement;
    var theme = props.theme || {};
    var onClose = props.onClose || function () {};
    var ok = theme.success || '#22c55e', warn = theme.warning || '#f59e0b', bad = theme.danger || theme.error || '#ef4444';
    var text = theme.text || '#e6edf3', dim = theme.textSecondary || '#9aa4b2';
    var accent = theme.accent || '#8b7cff', border = theme.cardBorder || 'rgba(255,255,255,0.1)';
    var inputBg = theme.inputBg || '#0f172a', cardBg = theme.modalBg || theme.card || theme.cardBg || '#141a25';

    var sStep = React.useState('intro'); var step = sStep[0], setStep = sStep[1];
    var sUrl = React.useState(props.workerUrl || ''); var url = sUrl[0], setUrl = sUrl[1];
    var sBusy = React.useState(false); var busy = sBusy[0], setBusy = sBusy[1];
    var sResults = React.useState(null); var results = sResults[0], setResults = sResults[1];
    var sCopy = React.useState(null); var copyLbl = sCopy[0] || __('obCopyWorker', 'Copy worker.js'), setCopyLbl = sCopy[1];

    // Results belong to the URL they were taken for: editing the URL clears
    // them, and a test still running for an older URL is ignored (FINDINGS L-6).
    var runRef = React.useRef(0);
    function editUrl(v) { runRef.current++; setUrl(v); setResults(null); setBusy(false); }
    function runTest() {
      if (busy) return;
      if (!isValidWorkerUrl(url)) { setResults([{ id: 'url', label: __('obWorkerUrl', 'Worker URL'), state: 'fail', message: __('obEnterValid', 'Enter a valid https:// Worker URL first.') }]); return; }
      var run = ++runRef.current;
      setBusy(true); setResults(null);
      probeAll(url).then(function (rs) { if (run !== runRef.current) return; setResults(rs); setBusy(false); },
        function () { if (run === runRef.current) setBusy(false); });
    }
    function copyWorker() {
      fetchWorkerSource().then(function (src) {
        try {
          navigator.clipboard.writeText(src).then(
            function () { setCopyLbl(__('obCopied', 'Copied ✓')); setTimeout(function () { setCopyLbl(null); }, 1600); },
            function () { window.open(GITHUB_WORKER_URL, '_blank'); }
          );
        } catch (e) { window.open(GITHUB_WORKER_URL, '_blank'); }
      }, function () { window.open(GITHUB_WORKER_URL, '_blank'); });
    }
    function saveAndClose() {
      if (props.onSaveWorkerUrl) props.onSaveWorkerUrl(normalizeWorkerUrl(url));
      onClose();
    }

    function btn(label, onClick, kind, disabled) {
      var bg = kind === 'primary' ? accent : 'transparent';
      var col = kind === 'primary' ? '#ffffff' : text;
      var bd = kind === 'primary' ? 'none' : ('1px solid ' + border);
      return h('button', { type: 'button', onClick: onClick, disabled: !!disabled, 'aria-busy': disabled ? 'true' : undefined, style: { padding: '0.6rem 1.1rem', background: bg, color: col, opacity: disabled ? 0.6 : 1,
        border: bd, borderRadius: '8px', cursor: disabled ? 'wait' : 'pointer', fontWeight: kind === 'primary' ? '700' : '500', fontSize: '0.85rem' } }, label);
    }

    var body;
    if (step === 'intro') {
      body = h('div', null,
        h('p', { style: { color: dim, fontSize: '0.9rem', lineHeight: '1.6', marginBottom: '1.25rem' } },
          __('obIntro', 'MAERMIN runs entirely in your browser. A free Cloudflare Worker unlocks live stock, ETF and CS2 prices. Set it up now, or explore with demo data first.')),
        h('div', { style: { display: 'grid', gap: '0.75rem' } },
          choiceCard(h, '◆', __('obSetupWorker', 'Set up the Cloudflare Worker'), __('obSetupWorkerHint', 'Guided — ~2 minutes. Unlocks all live data.'), function () { setStep('deploy'); }, accent, text, dim, border, cardBg, true),
          choiceCard(h, '◇', __('obDemo', 'Explore Demo mode'), __('obDemoHint', 'Load a realistic example portfolio. Reset anytime.'), function () { if (props.onActivateDemo) props.onActivateDemo(); onClose(); }, accent, text, dim, border, cardBg, false),
          choiceCard(h, '→', __('obLater', "I'll do this later"), __('obLaterHint', 'Skip for now — add a Worker URL in API Settings anytime.'), onClose, accent, text, dim, border, cardBg, false)
        )
      );
    } else if (step === 'deploy') {
      body = h('div', null,
        h('ol', { style: { color: text, fontSize: '0.88rem', lineHeight: '1.7', paddingLeft: '1.2rem', margin: '0 0 0.75rem' } },
          h('li', null, __('obDeployStep1', 'Click "Deploy to Cloudflare", sign in (free account) and confirm. Cloudflare creates the Worker and its storage.')),
          h('li', null, __('obDeployStep2', 'Copy the Worker URL shown at the end (…workers.dev).')),
          h('li', null, __('obPasteTest', 'Paste the URL here and test the connection.'))
        ),
        h('div', { style: { marginBottom: '0.75rem' } },
          h('a', { href: DEPLOY_URL, target: '_blank', rel: 'noopener noreferrer', 'data-testid': 'deploy-worker', style: { display: 'inline-block', padding: '0.6rem 1.1rem', background: accent, color: '#ffffff', borderRadius: '8px', fontWeight: '700', fontSize: '0.85rem', textDecoration: 'none' } }, __('obDeployBtn', 'Deploy to Cloudflare ↗'))
        ),
        h('details', { style: { marginBottom: '1rem', color: dim, fontSize: '0.82rem' } },
          h('summary', { style: { cursor: 'pointer', color: text } }, __('obManual', 'Or set it up by hand (copy and paste)')),
          h('ol', { style: { lineHeight: '1.7', paddingLeft: '1.2rem', margin: '0.5rem 0' } },
            h('li', null, __('obOpen', 'Open') + ' ', h('a', { href: 'https://dash.cloudflare.com', target: '_blank', rel: 'noopener noreferrer', style: { color: accent } }, 'dash.cloudflare.com'), ' → ' + __('obCreateWorker', 'Workers & Pages → Create Worker.')),
            h('li', null, __('obReplaceWith', 'Replace the default code with') + ' ', h('b', null, 'worker.js'), ' ' + __('obCopyBelow', '(copy below).')),
            h('li', null, __('obSaveDeploy', 'Save and Deploy, then copy your Worker URL.'))
          ),
          h('div', { style: { display: 'flex', gap: '0.5rem' } },
            btn(copyLbl, copyWorker, 'secondary'),
            h('a', { href: GITHUB_WORKER_URL, target: '_blank', rel: 'noopener noreferrer', style: { padding: '0.6rem 1.1rem', border: '1px solid ' + border, borderRadius: '8px', color: text, fontSize: '0.85rem', textDecoration: 'none' } }, __('obGithub', 'View on GitHub'))
          )
        ),
        h('label', { style: { display: 'block', color: dim, fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.4rem' }, htmlFor: 'ob-worker-url' }, __('obWorkerUrl', 'Worker URL')),
        h('input', { id: 'ob-worker-url', type: 'text', value: url, placeholder: 'https://your-worker.workers.dev',
          onChange: function (e) { editUrl(e.target.value); }, spellCheck: false,
          style: { width: '100%', padding: '0.7rem 0.85rem', background: inputBg, border: '1px solid ' + border, borderRadius: '8px', color: text, fontSize: '0.9rem', boxSizing: 'border-box', marginBottom: '0.9rem' } }),
        results && h('div', { style: { marginBottom: '0.9rem' } }, results.map(function (r) { return resultRow(h, r, ok, warn, bad, text, dim, border); })),
        h('div', { style: { display: 'flex', gap: '0.6rem', justifyContent: 'space-between', alignItems: 'center' } },
          btn(__('back', '← Back'), function () { setStep('intro'); }, 'secondary'),
          h('div', { style: { display: 'flex', gap: '0.6rem' } },
            btn(busy ? __('obTesting', 'Testing…') : __('obTest', 'Test connection'), runTest, 'secondary', busy),
            results && results.every(function (r) { return r.state !== 'fail'; }) ? btn(__('obSaveFinish', 'Save & Finish'), saveAndClose, 'primary') : null
          )
        )
      );
    }

    return h(window.MaerminUI.Overlay, { onClose: onClose, style: { position: 'fixed', inset: 0, zIndex: 9000, background: 'rgba(3,6,12,0.72)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1.5rem' } },
      h('div', { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'dlg-onboarding', style: { background: cardBg, border: '1px solid ' + border, borderRadius: '16px', padding: '1.75rem',
          width: '100%', maxWidth: '520px', maxHeight: '88vh', overflowY: 'auto', boxShadow: '0 30px 70px -20px rgba(0,0,0,0.7)' } },
        h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' } },
          h('h3', { id: 'dlg-onboarding', style: { color: text, fontSize: '1.15rem', fontWeight: '700', margin: 0 } }, __('obTitle', 'Set up your data sources')),
          h('button', { onClick: onClose, 'aria-label': __('close', 'Close'), style: { background: 'none', border: 'none', color: dim, fontSize: '1.4rem', cursor: 'pointer', lineHeight: 1 } }, '×')
        ),
        body
      )
    );
  }

  function choiceCard(h, icon, title, sub, onClick, accent, text, dim, border, cardBg, primary) {
    return h('button', { onClick: onClick, style: { display: 'flex', gap: '0.85rem', alignItems: 'center', textAlign: 'left',
        width: '100%', padding: '0.9rem 1rem', background: primary ? 'rgba(139,124,255,0.08)' : 'transparent',
        border: '1px solid ' + (primary ? accent : border), borderRadius: '10px', cursor: 'pointer' } },
      h('span', { style: { fontSize: '1.3rem' } }, icon),
      h('span', null,
        h('span', { style: { display: 'block', color: text, fontWeight: '600', fontSize: '0.9rem' } }, title),
        h('span', { style: { display: 'block', color: dim, fontSize: '0.78rem', marginTop: '0.15rem' } }, sub)
      )
    );
  }

  function resultRow(h, r, ok, warn, bad, text, dim, border) {
    var color = r.state === 'ok' ? ok : (r.state === 'warn' ? warn : bad);
    var dot = r.state === 'ok' ? '●' : (r.state === 'warn' ? '◐' : '○');
    return h('div', { key: r.id, style: { display: 'flex', gap: '0.6rem', alignItems: 'flex-start', padding: '0.5rem 0', borderBottom: '1px solid ' + border } },
      h('span', { style: { color: color, fontSize: '0.9rem', marginTop: '0.1rem' } }, dot),
      h('div', null,
        h('div', { style: { color: text, fontSize: '0.82rem', fontWeight: '600' } }, r.label),
        h('div', { style: { color: dim, fontSize: '0.74rem', lineHeight: '1.45' } }, r.message)
      )
    );
  }

  var api = {
    normalizeWorkerUrl: normalizeWorkerUrl,
    isValidWorkerUrl: isValidWorkerUrl,
    endpoints: endpoints,
    classify: classify,
    probe: probe,
    probeAll: probeAll,
    fetchWorkerSource: fetchWorkerSource,
    compareVersions: compareVersions,
    versionState: versionState,
    checkWorkerVersion: checkWorkerVersion,
    versionRow: versionRow,
    Wizard: Wizard,
    GITHUB_WORKER_URL: GITHUB_WORKER_URL,
    DEPLOY_URL: DEPLOY_URL,
    EXPECTED_WORKER_VERSION: EXPECTED_WORKER_VERSION
  };

  if (typeof window !== 'undefined') window.MaerminOnboarding = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
