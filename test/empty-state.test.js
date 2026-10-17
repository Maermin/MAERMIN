// Node harness for the shared empty / loading / gated state (MaerminUI.EmptyState,
// MaerminUtils.emptyState / workerNote) and the "Open API Settings" action.
// Run: node test/empty-state.test.js
'use strict';
let passed = 0, failed = 0;
function ok(name, cond, info) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.error('  ✗ ' + name + (info !== undefined ? ' -> ' + JSON.stringify(info).slice(0, 400) : '')); }
}
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
globalThis.React = React;
globalThis.window = { React };
const U = require('../utils.js');

console.log('without the UI store (Node harnesses):');
{
  const html = renderToStaticMarkup(U.emptyState({ testid: 'x-empty', text: 'Nothing yet.' }));
  ok('a plain element with the test id and the text', /data-testid="x-empty"/.test(html) && /Nothing yet\./.test(html), html);
}

require('../store.js');
const UI = require('../ui-store.js');
console.log('with the UI store:');
{
  const html = renderToStaticMarkup(U.emptyState({ testid: 'x-empty', title: 'No data', text: 'Nothing yet.' }));
  ok('class, kind, title and text', /class="mx-empty"/.test(html) && /data-kind="empty"/.test(html) && /mx-empty-title">No data</.test(html) && /mx-empty-text">Nothing yet\.</.test(html), html);
  const load = renderToStaticMarkup(U.emptyState({ kind: 'loading', text: 'Loading…' }));
  ok('a loading state is announced as a status', /role="status"/.test(load) && /data-kind="loading"/.test(load), load);
  const compact = renderToStaticMarkup(U.emptyState({ compact: true, text: 'x' }));
  ok('compact inside a card', /class="mx-empty is-compact"/.test(compact), compact);
}
{
  const html = renderToStaticMarkup(U.workerNote('Add a Worker URL in API Settings.', 'w-note'));
  ok('worker note: compact, kind worker, one button "Open API Settings"', /is-compact/.test(html) && /data-kind="worker"/.test(html) && /<button[^>]*class="mx-btn mx-btn-secondary"[^>]*>Open API Settings<\/button>/.test(html), html);
}
{
  const html = renderToStaticMarkup(U.emptyState({ text: 't', actions: [
    { label: 'Use mine', variant: 'primary', onClick: () => {}, props: { 'data-a': 'x' } },
    false,
    { label: 'Set', onClick: () => {} }] }));
  ok('several actions: primary first, test hooks kept, falsy entries skipped', /mx-empty-actions/.test(html) && /class="mx-btn mx-btn-primary"[^>]*data-a="x"|data-a="x"[^>]*class="mx-btn mx-btn-primary"/.test(html) && (html.match(/<button/g) || []).length === 2, html);
}
{
  UI.closeOverlay('apiSettings');
  UI.workerAction().onClick();
  ok('the action opens the API Settings overlay', UI.isOverlayOpen('apiSettings') === true);
  UI.closeOverlay('apiSettings');
}

console.log(passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
