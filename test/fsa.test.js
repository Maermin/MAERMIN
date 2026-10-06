// Freistellungsaufträge per broker (P2-6): normalising the store, the sum
// against the allowance, and used/left per broker.
// Run: node test/fsa.test.js
'use strict';
let passed = 0, failed = 0;
function ok(name, cond, detail) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.error('  ✗ ' + name + (detail ? '  — ' + detail : '')); }
}
const F = require('../fsa.js');
console.log('freistellungsaufträge:');
let st = F.normalize(null);
ok('empty store', st.brokers.length === 0 && st.version === 1);
st = F.upsert(st, { id: 'a', name: 'Bank A', amount: 600, portfolioIds: ['default'] });
st = F.upsert(st, { id: 'b', name: 'Broker B', amount: '400.004' });
ok('upsert adds, rounds to cents and keeps the portfolio links', st.brokers.length === 2 && st.brokers[1].amount === 400 && st.brokers[0].portfolioIds.join() === 'default');
st = F.upsert(st, { id: 'a', name: 'Bank A', amount: 700, portfolioIds: ['default'] });
ok('upsert replaces by id', st.brokers.length === 2 && st.brokers[0].amount === 700);
ok('negative amounts become 0, junk is dropped', F.normalize({ brokers: [{ id: 'x', amount: -5 }, null, { name: 'no id' }] }).brokers.map((b) => b.amount).join() === '0');

const income = { a: 250, b: null };
let s = F.summarize(st, 1000, (b) => income[b.id]);
ok('orders above the allowance are flagged with the excess', s.over && s.total === 1100 && s.excess === 100 && s.unassigned === 0);
ok('used = min(order, income), left = order - used', s.rows[0].used === 250 && s.rows[0].headroom === 450 && s.rows[0].taxedAtBroker === 0);
ok('no linked portfolio → income unknown, no headroom shown', s.rows[1].income === null && s.rows[1].headroom === null);
s = F.summarize(st, 2000, () => 900);
ok('joint allowance 2,000: not over, rest is unassigned', !s.over && s.unassigned === 900);
ok('income beyond the order is taxed at the broker', s.rows[1].used === 400 && s.rows[1].headroom === 0 && s.rows[1].taxedAtBroker === 500);
ok('a loss year uses nothing', F.summarize(st, 1000, () => -300).rows[0].used === 0);
ok('exactly the allowance is not over', !F.summarize(F.upsert(F.normalize(null), { id: 'z', name: 'Z', amount: 1000 }), 1000).over);
ok('remove drops a broker', F.remove(st, 'a').brokers.map((b) => b.id).join() === 'b');
console.log('\n  ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
