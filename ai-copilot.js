/**
 * MAERMIN - AI Copilot
 * ------------------------------------------------------------------
 * A cross-cutting "Analyse with AI" affordance. It does NOT compute any
 * analytics itself — each view passes the numbers it has ALREADY computed
 * (health score, risk dimensions, FIRE, etc.) as a structured context, and
 * the copilot turns them into a natural-language explanation via the user's
 * own LLM proxy (a Cloudflare Worker that forwards to Claude). No portfolio
 * logic is duplicated here.
 *
 * Exposes:
 *   window.AICopilot.analyze(context)  -> Promise<string>
 *   window.AICopilot.Button(props)     -> self-contained React button + modal
 *   window.AICopilot.isConfigured()    -> boolean
 *
 * Endpoint: localStorage 'maermin_ai_endpoint' (or apiKeys.aiWorker). If unset,
 * the modal lets the user paste it inline — nothing crashes when it's missing.
 */
(function () {
  'use strict';

  var ENDPOINT_KEY = 'maermin_ai_endpoint';

  function getEndpoint() {
    try {
      var direct = (localStorage.getItem(ENDPOINT_KEY) || '').trim();
      if (direct) return direct;
      var keys = JSON.parse(localStorage.getItem('apiKeys') || '{}');
      return ((keys && keys.aiWorker) || '').trim();
    } catch (e) { return ''; }
  }
  function setEndpoint(url) { try { localStorage.setItem(ENDPOINT_KEY, (url || '').trim()); } catch (e) {} }
  function isConfigured() { return getEndpoint().length > 8; }

  function buildPrompt(context) {
    var L = [];
    L.push('You are a portfolio-analysis assistant inside MAERMIN, a personal multi-asset portfolio tracker.');
    L.push('Analyse the following ' + (context.title || 'portfolio') + ' data and give concise, specific, actionable insight. Reply in English. Use the actual numbers. Keep it short (a few bullet points). This is educational, not individual financial advice — at most one short caveat line.');
    L.push('');
    L.push('DATA:');
    L.push('```json');
    try { L.push(JSON.stringify(context.data || {}, null, 2)); } catch (e) { L.push('{}'); }
    L.push('```');
    if (context.question) { L.push(''); L.push('USER QUESTION: ' + context.question); }
    return L.join('\n');
  }

  // POST to the user's proxy. Accepts several common response shapes so the
  // worker can forward to Claude (or another provider) however it likes.
  function analyze(context) {
    var endpoint = getEndpoint();
    if (!endpoint) return Promise.reject(new Error('NO_ENDPOINT'));
    var body = {
      prompt: buildPrompt(context),
      system: 'You are a concise, numerate financial portfolio analyst.',
      model: context.model || 'claude-sonnet-4-6',
      max_tokens: 700
    };
    var ctrl = (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) ? AbortSignal.timeout(30000) : undefined;
    return fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl
    }).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json().catch(function () { return {}; });
    }).then(function (data) {
      var text = data.text || data.completion
        || (data.content && data.content[0] && data.content[0].text)
        || (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content)
        || (typeof data === 'string' ? data : '');
      if (!text) throw new Error('EMPTY');
      return text;
    });
  }

  // ---- Self-contained React button + modal --------------------------------
  function Modal(props) {
    var e = React.createElement;
    var theme = props.theme || {};
    var t = props.t || {};
    var context = props.context || {};
    var onClose = props.onClose;

    var loadingState = React.useState(false); var loading = loadingState[0]; var setLoading = loadingState[1];
    var resultState = React.useState(''); var result = resultState[0]; var setResult = resultState[1];
    var errState = React.useState(''); var err = errState[0]; var setErr = errState[1];
    var epState = React.useState(getEndpoint()); var ep = epState[0]; var setEp = epState[1];
    var qState = React.useState(''); var question = qState[0]; var setQuestion = qState[1];

    var run = function (q) {
      setLoading(true); setErr('');
      analyze(Object.assign({}, context, q ? { question: q } : {})).then(function (text) {
        setResult(text); setLoading(false);
      }).catch(function (e2) {
        setErr(e2 && e2.message === 'NO_ENDPOINT' ? 'NO_ENDPOINT' : ((e2 && e2.message) || 'error'));
        setLoading(false);
      });
    };

    React.useEffect(function () { if (isConfigured()) run(); }, []);

    var inputStyle = { width: '100%', boxSizing: 'border-box', padding: '0.6rem 0.8rem', background: theme.inputBg, border: '1px solid ' + (theme.inputBorder || theme.cardBorder), borderRadius: '8px', color: theme.text, fontSize: '0.85rem' };

    var bodyChildren = [];
    if (!isConfigured() || err === 'NO_ENDPOINT') {
      bodyChildren.push(
        e('div', { key: 'cfg' },
          e('p', { style: { color: theme.textSecondary, fontSize: '0.85rem', marginBottom: '0.6rem' } },
            t.aiSetupHint || 'Paste your AI proxy URL (a Cloudflare Worker that forwards to Claude). Your portfolio numbers are sent only to this endpoint.'),
          e('input', { value: ep, onChange: function (ev) { setEp(ev.target.value); }, placeholder: 'https://your-worker.workers.dev', style: inputStyle }),
          e('button', {
            onClick: function () { setEndpoint(ep); setErr(''); run(); },
            style: { marginTop: '0.6rem', padding: '0.55rem 1.1rem', background: theme.accent, color: '#13110a', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 700, fontSize: '0.85rem' }
          }, t.aiSave || t.save || 'Save & analyse'))
      );
    } else if (loading) {
      bodyChildren.push(e('div', { key: 'ld', style: { color: theme.textSecondary, fontSize: '0.9rem', padding: '1rem 0' } }, (t.aiThinking || 'Analysing') + ' …'));
    } else if (err) {
      bodyChildren.push(e('div', { key: 'er', style: { color: theme.danger || '#ef4444', fontSize: '0.85rem' } }, (t.aiError || 'Could not reach the AI endpoint') + ' (' + err + ').'));
    } else if (result) {
      bodyChildren.push(e('div', { key: 'rs', style: { color: theme.text, fontSize: '0.88rem', lineHeight: 1.6, whiteSpace: 'pre-wrap' } }, result));
    }

    // Follow-up question (only once configured)
    if (isConfigured() && err !== 'NO_ENDPOINT') {
      bodyChildren.push(
        e('div', { key: 'fu', style: { display: 'flex', gap: '0.5rem', marginTop: '1rem' } },
          e('input', { value: question, onChange: function (ev) { setQuestion(ev.target.value); }, onKeyDown: function (ev) { if (ev.key === 'Enter' && question.trim()) run(question.trim()); }, placeholder: t.aiAskFollowup || 'Ask a follow-up…', style: inputStyle }),
          e('button', { onClick: function () { if (question.trim()) run(question.trim()); }, disabled: loading, style: { padding: '0.6rem 1rem', background: theme.accent, color: '#13110a', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 600, fontSize: '0.82rem' } }, '→'))
      );
    }

    return e('div', {
      onClick: function (ev) { if (ev.target === ev.currentTarget) onClose(); },
      style: { position: 'fixed', inset: 0, background: 'rgba(4,6,10,0.62)', backdropFilter: 'blur(8px)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 10000, padding: '1rem' }
    },
      e('div', { style: { background: theme.modalBg || theme.card, border: '1px solid ' + (theme.modalBorder || theme.cardBorder), borderRadius: '16px', width: '560px', maxWidth: '100%', maxHeight: '85vh', overflow: 'auto', boxShadow: '0 25px 60px rgba(0,0,0,0.5)', padding: '1.5rem' } },
        e('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' } },
          e('div', { style: { color: theme.text, fontWeight: 800, fontSize: '1.1rem' } }, '✨ ' + (context.title || (t.aiAnalyze || 'AI analysis'))),
          e('button', { onClick: onClose, style: { background: 'none', border: '1px solid ' + (theme.cardBorder || '#333'), borderRadius: '8px', color: theme.textSecondary, cursor: 'pointer', padding: '0.3rem 0.7rem' } }, '×')),
        bodyChildren,
        e('div', { style: { color: theme.textSecondary, fontSize: '0.68rem', marginTop: '1rem', opacity: 0.7 } },
          t.aiDisclaimer || 'AI-generated, may be inaccurate. Educational only — not financial advice.')
      )
    );
  }

  function Button(props) {
    var e = React.createElement;
    var theme = props.theme || {};
    var t = props.t || {};
    var openState = React.useState(false); var open = openState[0]; var setOpen = openState[1];
    var compact = props.compact;
    return e(React.Fragment, null,
      e('button', {
        onClick: function () { setOpen(true); },
        title: t.aiAnalyze || 'Analyse with AI',
        style: Object.assign({
          display: 'inline-flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer',
          background: (theme.accent || '#f5a524') + '18', color: theme.accent || '#f5a524',
          border: '1px solid ' + ((theme.accent || '#f5a524') + '44'), borderRadius: '8px',
          fontWeight: 600, fontSize: compact ? '0.72rem' : '0.8rem', padding: compact ? '0.3rem 0.6rem' : '0.45rem 0.85rem'
        }, props.style || {})
      }, '✨ ', compact ? (t.aiShort || 'AI') : (t.aiAnalyze || 'Analyse with AI')),
      open && e(Modal, { theme: theme, t: t, context: props.context || {}, onClose: function () { setOpen(false); } })
    );
  }

  if (typeof window !== 'undefined') {
    window.AICopilot = { analyze: analyze, isConfigured: isConfigured, getEndpoint: getEndpoint, setEndpoint: setEndpoint, Button: Button };
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { analyze: analyze, isConfigured: isConfigured, buildPrompt: buildPrompt };
  }
})();
