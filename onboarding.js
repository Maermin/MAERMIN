// ============================================================================
// MAERMIN — First-Run Onboarding  (window.MaerminOnboarding)
// ----------------------------------------------------------------------------
// The biggest adoption hurdle is the Cloudflare-Worker setup. This module turns
// it into a guided wizard:
//   • step-by-step deploy guide + one-click "Copy worker.js"
//   • a live "Test connection" that pings each data-source endpoint (yf,
//     yfsearch, steamhistory, search) and reports green / amber / red per source
//   • a Demo-mode entry so newcomers can explore the full app before any setup.
//
// Pure logic (endpoints/classify/probe/fetchWorkerSource) is dual-exported and
// unit-tested under Node with an injected fetch; the React `Wizard` is built
// with React.createElement (no JSX) and only renders in the browser.
// ============================================================================
(function () {
  'use strict';

  var GITHUB_WORKER_URL = 'https://github.com/maermin/MAERMIN/blob/main/cf-worker/worker.js';

  // ---- pure: worker URL helpers -------------------------------------------
  function normalizeWorkerUrl(url) {
    return String(url || '').trim().replace(/\/+$/, '');
  }
  function isValidWorkerUrl(url) {
    return /^https?:\/\/[^\s]+$/i.test(normalizeWorkerUrl(url));
  }

  // The four data-source endpoints the app depends on, each with a cheap probe
  // using a well-known query so a healthy worker returns real data.
  function endpoints(workerUrl) {
    var base = normalizeWorkerUrl(workerUrl);
    return [
      { id: 'yf',           label: 'Stock & ETF prices (Yahoo Finance)',
        url: base + '?action=yf&symbol=AAPL&interval=1d&range=5d' },
      { id: 'yfsearch',     label: 'Symbol search',
        url: base + '?action=yfsearch&q=Apple&type=stock' },
      { id: 'steamhistory', label: 'CS2 skin prices (Steam)',
        url: base + '?action=steamhistory&name=' + encodeURIComponent('AK-47 | Redline (Field-Tested)') },
      { id: 'search',       label: 'CS2 skin search',
        url: base + '?action=search&q=ak47' }
    ];
  }

  // ---- pure: classify a probe outcome -------------------------------------
  // outcome = { networkError?:string, status?:number, payload?:any }
  // → { state:'ok'|'warn'|'fail', message:string }
  function classify(id, outcome) {
    outcome = outcome || {};
    if (outcome.networkError) {
      return { state: 'fail', message: 'Could not reach the Worker — ' + outcome.networkError +
        '. Check the URL is correct, deployed, and not blocked by CORS.' };
    }
    var status = outcome.status, p = outcome.payload;
    if (typeof status !== 'number' || status < 200 || status >= 300) {
      var emsg = (p && p.error) ? p.error : ('HTTP ' + status);
      return { state: 'fail', message: 'Worker responded with an error: ' + emsg };
    }
    if (p && p.error) return { state: 'fail', message: 'Worker error: ' + p.error };

    var hasData;
    if (id === 'yf' || id === 'steamhistory') hasData = !!(p && Array.isArray(p.prices) && p.prices.length);
    else hasData = Array.isArray(p) && p.length > 0; // yfsearch / search return arrays

    if (hasData) return { state: 'ok', message: 'Connected — live data received.' };
    return { state: 'warn', message: 'Worker reachable, but the source returned no data right now ' +
      '(rate limit or a temporary upstream issue). The connection itself works.' };
  }

  // ---- impure: run probes (fetch injectable for Node tests) ---------------
  function probe(ep, opts) {
    opts = opts || {};
    var doFetch = opts.fetch || (typeof fetch !== 'undefined' ? fetch : null);
    var timeoutMs = opts.timeoutMs || 12000;
    var base = { id: ep.id, label: ep.label };
    if (!doFetch) return Promise.resolve(Object.assign({}, base, { state: 'fail', message: 'No fetch in this environment.' }));

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
        var why = (e && e.name === 'AbortError') ? 'timed out' : ((e && e.message) || 'network error');
        var c = classify(ep.id, { networkError: why });
        return Object.assign({}, base, { state: c.state, message: c.message, ms: Date.now() - t0 });
      })
      .then(function (out) { if (timer) clearTimeout(timer); return out; });
  }

  function probeAll(workerUrl, opts) {
    return Promise.all(endpoints(workerUrl).map(function (ep) { return probe(ep, opts); }));
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
    var accent = theme.accent || '#f5a524', border = theme.cardBorder || 'rgba(255,255,255,0.1)';
    var inputBg = theme.inputBg || '#0f172a', cardBg = theme.cardBg || '#141a25';

    var sStep = React.useState('intro'); var step = sStep[0], setStep = sStep[1];
    var sUrl = React.useState(props.workerUrl || ''); var url = sUrl[0], setUrl = sUrl[1];
    var sBusy = React.useState(false); var busy = sBusy[0], setBusy = sBusy[1];
    var sResults = React.useState(null); var results = sResults[0], setResults = sResults[1];
    var sCopy = React.useState('Copy worker.js'); var copyLbl = sCopy[0], setCopyLbl = sCopy[1];

    function runTest() {
      if (!isValidWorkerUrl(url)) { setResults([{ id: 'url', label: 'Worker URL', state: 'fail', message: 'Enter a valid https:// Worker URL first.' }]); return; }
      setBusy(true); setResults(null);
      probeAll(url).then(function (rs) { setResults(rs); setBusy(false); }, function () { setBusy(false); });
    }
    function copyWorker() {
      fetchWorkerSource().then(function (src) {
        try {
          navigator.clipboard.writeText(src).then(
            function () { setCopyLbl('Copied ✓'); setTimeout(function () { setCopyLbl('Copy worker.js'); }, 1600); },
            function () { window.open(GITHUB_WORKER_URL, '_blank'); }
          );
        } catch (e) { window.open(GITHUB_WORKER_URL, '_blank'); }
      }, function () { window.open(GITHUB_WORKER_URL, '_blank'); });
    }
    function saveAndClose() {
      if (props.onSaveWorkerUrl) props.onSaveWorkerUrl(normalizeWorkerUrl(url));
      onClose();
    }

    function btn(label, onClick, kind) {
      var bg = kind === 'primary' ? accent : 'transparent';
      var col = kind === 'primary' ? '#13110a' : text;
      var bd = kind === 'primary' ? 'none' : ('1px solid ' + border);
      return h('button', { onClick: onClick, style: { padding: '0.6rem 1.1rem', background: bg, color: col,
        border: bd, borderRadius: '8px', cursor: 'pointer', fontWeight: kind === 'primary' ? '700' : '500', fontSize: '0.85rem' } }, label);
    }

    var body;
    if (step === 'intro') {
      body = h('div', null,
        h('p', { style: { color: dim, fontSize: '0.9rem', lineHeight: '1.6', marginBottom: '1.25rem' } },
          'MAERMIN runs entirely in your browser. A free Cloudflare Worker unlocks live stock, ETF and CS2 prices. Set it up now, or explore with demo data first.'),
        h('div', { style: { display: 'grid', gap: '0.75rem' } },
          choiceCard(h, '◆', 'Set up the Cloudflare Worker', 'Guided — ~2 minutes. Unlocks all live data.', function () { setStep('deploy'); }, accent, text, dim, border, cardBg, true),
          choiceCard(h, '◇', 'Explore Demo mode', 'Load a realistic example portfolio. Reset anytime.', function () { if (props.onActivateDemo) props.onActivateDemo(); onClose(); }, accent, text, dim, border, cardBg, false),
          choiceCard(h, '→', 'I\'ll do this later', 'Skip for now — add a Worker URL in API Settings anytime.', onClose, accent, text, dim, border, cardBg, false)
        )
      );
    } else if (step === 'deploy') {
      body = h('div', null,
        h('ol', { style: { color: text, fontSize: '0.88rem', lineHeight: '1.7', paddingLeft: '1.2rem', margin: '0 0 1rem' } },
          h('li', null, 'Open ', h('a', { href: 'https://dash.cloudflare.com', target: '_blank', style: { color: accent } }, 'dash.cloudflare.com'), ' → Workers & Pages → Create Worker.'),
          h('li', null, 'Replace the default code with ', h('b', null, 'worker.js'), ' (copy below).'),
          h('li', null, 'Save and Deploy, then copy your Worker URL.'),
          h('li', null, 'Paste the URL here and test the connection.')
        ),
        h('div', { style: { display: 'flex', gap: '0.5rem', marginBottom: '1rem' } },
          btn(copyLbl, copyWorker, 'secondary'),
          h('a', { href: GITHUB_WORKER_URL, target: '_blank', style: { padding: '0.6rem 1.1rem', border: '1px solid ' + border, borderRadius: '8px', color: text, fontSize: '0.85rem', textDecoration: 'none' } }, 'View on GitHub')
        ),
        h('label', { style: { display: 'block', color: dim, fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.4rem' } }, 'Worker URL'),
        h('input', { type: 'text', value: url, placeholder: 'https://your-worker.workers.dev',
          onChange: function (e) { setUrl(e.target.value); }, spellCheck: false,
          style: { width: '100%', padding: '0.7rem 0.85rem', background: inputBg, border: '1px solid ' + border, borderRadius: '8px', color: text, fontSize: '0.9rem', boxSizing: 'border-box', marginBottom: '0.9rem' } }),
        results && h('div', { style: { marginBottom: '0.9rem' } }, results.map(function (r) { return resultRow(h, r, ok, warn, bad, text, dim, border); })),
        h('div', { style: { display: 'flex', gap: '0.6rem', justifyContent: 'space-between', alignItems: 'center' } },
          btn('← Back', function () { setStep('intro'); }, 'secondary'),
          h('div', { style: { display: 'flex', gap: '0.6rem' } },
            btn(busy ? 'Testing…' : 'Test connection', runTest, 'secondary'),
            results && results.every(function (r) { return r.state !== 'fail'; }) ? btn('Save & Finish', saveAndClose, 'primary') : null
          )
        )
      );
    }

    return h('div', { style: { position: 'fixed', inset: 0, zIndex: 9000, background: 'rgba(3,6,12,0.72)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1.5rem' }, onClick: function (e) { if (e.target === e.currentTarget) onClose(); } },
      h('div', { style: { background: cardBg, border: '1px solid ' + border, borderRadius: '16px', padding: '1.75rem',
          width: '100%', maxWidth: '520px', maxHeight: '88vh', overflowY: 'auto', boxShadow: '0 30px 70px -20px rgba(0,0,0,0.7)' } },
        h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' } },
          h('h3', { style: { color: text, fontSize: '1.15rem', fontWeight: '700', margin: 0 } }, 'Set up your data sources'),
          h('button', { onClick: onClose, 'aria-label': 'Close', style: { background: 'none', border: 'none', color: dim, fontSize: '1.4rem', cursor: 'pointer', lineHeight: 1 } }, '×')
        ),
        body
      )
    );
  }

  function choiceCard(h, icon, title, sub, onClick, accent, text, dim, border, cardBg, primary) {
    return h('button', { onClick: onClick, style: { display: 'flex', gap: '0.85rem', alignItems: 'center', textAlign: 'left',
        width: '100%', padding: '0.9rem 1rem', background: primary ? 'rgba(245,165,36,0.08)' : 'transparent',
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
    Wizard: Wizard,
    GITHUB_WORKER_URL: GITHUB_WORKER_URL
  };

  if (typeof window !== 'undefined') window.MaerminOnboarding = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
