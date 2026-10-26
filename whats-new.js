// ============================================================================
// MAERMIN — "What's new" after an update  (window.MaerminWhatsNew)
// ----------------------------------------------------------------------------
// Audit 2026-10-24, feature 7. The first start after the app's version changed
// shows the newest section of RELEASE.md on the Overview: its title, the
// summary line (it says whether data was migrated and what to redeploy) and
// the highlights, with a link to the full notes. "Got it" records the version.
//
// The notes are read from RELEASE.md next to index.html (the build copies it
// to dist/), once, only when the version differs from the one last seen. A
// new install records the version silently: it has nothing to compare with.
//
// 'maermin_whats_new_seen' holds the last version seen (plain, device-local:
// not in the backup KEYS and not sensitive, so not synced).
//
//   parseLatest(markdown) -> { version, title, date, summary, highlights[] } | null
//   check(storage, version) -> 'show' | 'first' | 'seen'   ('first' records it)
//   markSeen(storage, version)
//   Card({ notes, onClose })
// Pure parts tested in test/whats-new.test.js.
// ============================================================================
(function () {
  'use strict';
// Translation lookup (i18n.js): __('key', 'English fallback', { slot: value }).
function __(k, f, v) { return (typeof window !== 'undefined' && window.MaerminI18n ? window.MaerminI18n : require('./i18n.js')).t(k, f, v); }

  var KEY = 'maermin_whats_new_seen';
  var NOTES_URL = 'https://github.com/Maermin/MAERMIN/blob/main/RELEASE.md';
  var MAX_ITEMS = 8;

  // Markdown inline -> plain text: **bold**, `code`, [text](url), stray markup.
  function plain(s) {
    return String(s || '')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\*+/g, '')                // stray emphasis; underscores stay (key names like maermin_chart_prefs)
      .replace(/\s+/g, ' ')
      .trim();
  }

  function parseLatest(md) {
    var lines = String(md || '').split(/\r?\n/);
    var i = 0;
    while (i < lines.length && !/^## \[v?\d+\.\d+(\.\d+)?\]/.test(lines[i])) i++;
    if (i >= lines.length) return null;
    var head = lines[i].match(/^## \[v?(\d+\.\d+(?:\.\d+)?)\]\s*(.*)$/);
    var rest = head[2] || '';
    var parts = rest.split(/\s+[—-]\s+/);
    var out = { version: head[1], title: plain(parts[0] || '').replace(/^"|"$/g, ''), date: plain(parts[1] || ''), summary: '', highlights: [] };
    var inHigh = false;
    for (i = i + 1; i < lines.length; i++) {
      var l = lines[i];
      if (/^## /.test(l)) break;                       // next release
      if (!out.summary && /^>\s?/.test(l)) { out.summary = plain(l.replace(/^>\s?/, '')); continue; }
      if (/^### /.test(l)) { inHigh = /highlight/i.test(l); continue; }
      if (inHigh && /^- /.test(l) && out.highlights.length < MAX_ITEMS) {
        // "- **Charts** (where): text" -> keep the first sentence-ish part short
        out.highlights.push(plain(l.slice(2)));
      }
    }
    return out;
  }

  function read(storage) { try { return storage ? storage.getItem(KEY) : null; } catch (e) { return null; } }
  function markSeen(storage, version) { try { if (storage && version) storage.setItem(KEY, String(version)); } catch (e) { /* read-only tab */ } }

  function check(storage, version) {
    if (!version) return 'seen';
    var seen = read(storage);
    if (!seen) { markSeen(storage, version); return 'first'; }
    return seen === String(version) ? 'seen' : 'show';
  }

  function Card(props) {
    var React = window.React, h = React.createElement;
    var UIC = window.MaerminComponents || {};
    var n = props.notes;
    if (!n) return null;
    var close = UIC.Button ? h(UIC.Button, { variant: 'primary', size: 'sm', 'data-testid': 'whats-new-close', onClick: props.onClose }, __('wnGotIt', 'Got it')) : null;
    return h(UIC.Card, { className: 'ui-whats-new', 'data-testid': 'whats-new',
      title: __('wnTitle', 'What\'s new in {v}', { v: n.version }) + (n.title ? ' · ' + n.title : ''),
      subtitle: n.date || null, action: close },
      n.summary ? h('p', { className: 'ui-note ui-note--flush' }, n.summary) : null,
      n.highlights.length ? h('ul', { className: 'ui-whats-new__list' }, n.highlights.map(function (t, i) { return h('li', { key: i }, t); })) : null,
      h('p', { className: 'ui-whats-new__more' },
        h('a', { href: NOTES_URL, target: '_blank', rel: 'noopener noreferrer' }, __('wnFull', 'Full release notes (English)'))));
  }

  var api = { KEY: KEY, NOTES_URL: NOTES_URL, plain: plain, parseLatest: parseLatest, check: check, markSeen: markSeen, Card: Card };
  if (typeof window !== 'undefined') window.MaerminWhatsNew = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
