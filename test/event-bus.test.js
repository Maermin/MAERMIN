// Node harness for the event bus. Pure pub/sub, no browser.
// Run: node test/event-bus.test.js
'use strict';

let passed = 0, failed = 0;
function ok(name, cond) { cond ? (passed++, console.log('  ✓ ' + name)) : (failed++, console.error('  ✗ ' + name)); }

const Bus = require('../event-bus.js');

(function run() {
  console.log('event-bus:');

  // basic emit/subscribe
  let got = null;
  const off = Bus.on('prices:refreshed', (p) => { got = p; });
  const n = Bus.emit('prices:refreshed', { count: 5 });
  ok('subscriber receives the payload', got && got.count === 5);
  ok('emit returns the handler count', n === 1);
  ok('listenerCount reflects subscriptions', Bus.listenerCount('prices:refreshed') === 1);

  // unsubscribe
  off();
  got = null;
  Bus.emit('prices:refreshed', { count: 9 });
  ok('unsubscribed handler no longer fires', got === null);
  ok('listenerCount drops after off', Bus.listenerCount('prices:refreshed') === 0);

  // multiple subscribers + isolation of a thrower
  let a = 0, b = 0;
  Bus.on('tick', () => { a++; throw new Error('boom'); });
  Bus.on('tick', () => { b++; });
  const fired = Bus.emit('tick');
  ok('a throwing subscriber does not stop the others', a === 1 && b === 1);
  ok('emit still counts successful handlers', fired === 2);

  // once
  let c = 0;
  Bus.once('one', () => { c++; });
  Bus.emit('one'); Bus.emit('one');
  ok('once fires exactly once', c === 1);

  // emit with no listeners is a safe no-op
  ok('emit with no listeners returns 0', Bus.emit('nobody-home', {}) === 0);

  // off(event) clears all handlers for that event
  Bus.on('z', () => {}); Bus.on('z', () => {});
  Bus.off('z');
  ok('off(event) clears all handlers', Bus.listenerCount('z') === 0);

  console.log(`\n  ${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
})();
