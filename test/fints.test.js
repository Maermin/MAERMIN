// Node harness for P5-3.4 fints.js: FinTS syntax, message building, response
// parsing, MT940 / MT535, and whole dialogs against the synthetic bank
// (test/fints-bank-sim.js): first contact, pushTAN (decoupled polling), a TAN
// entered, a wrong PIN, paging, and that the PIN appears only where it must.
// Run: node test/fints.test.js
'use strict';
let passed = 0, failed = 0;
function ok(name, cond, detail) { cond ? (passed++, console.log('  ✓ ' + name)) : (failed++, console.error('  ✗ ' + name + (detail !== undefined ? '  — ' + JSON.stringify(detail) : ''))); }
const approx = (a, b) => Math.abs(a - b) < 1e-9;

const F = require('../fints.js');
const { createBank, MT940_PAGES, MT535 } = require('./fints-bank-sim.js');

(async function run() {
  console.log('syntax:');
  ok('escape ? @ \' : +', F.esc("a?b@c'd:e+f") === "a??b?@c?'d?:e?+f");
  const p = F.parse("HNHBK:1:3+000000000042+300+0+1'HKIDN:3:2+280:12030000+us?+er+0+1'XBIN:4:1+@5@a'+:b'");
  ok('parse: segments, header, groups', p.length === 3 && p[1].type === 'HKIDN' && p[1].no === '3' && p[1].des[0][1] === '12030000');
  ok('parse: an escaped + stays in the value', p[1].des[1][0] === 'us+er');
  ok('parse: binary data is taken raw, separators inside it included', p[2].des[0][0] === "a'+:b");

  console.log('\nmessages:');
  const msg = F.buildMessage({ blz: '12030000', user: 'demo-user', pin: '4711', systemId: 'SYS', dialogId: '0', msgNo: 1, secFunc: '942',
    segments: [F.SEG.HKIDN({ blz: '12030000', user: 'demo-user', systemId: 'SYS' }), F.SEG.HKVVB({ productId: 'TESTPRODUCT', productVersion: '1' })], now: new Date(2025, 1, 3, 12, 0, 0), ctrlRef: '1234567' });
  const size = parseInt(msg.slice(11, 23), 10);
  ok('HNHBK carries the exact message length', size === msg.length, [size, msg.length]);
  const ps = F.unwrap(F.parse(msg));
  ok('envelope: HNVSK / HNVSD around HNSHK ... HNSHA, HNHBS last', ps.map((s) => s.type).join(',') === 'HNHBK,HNVSK,HNSHK,HKIDN,HKVVB,HNSHA,HNHBS', ps.map((s) => s.type).join());
  ok('segments are numbered in order (HNSHK 2, payload 3..4, HNSHA 5, HNHBS 6)', ps[2].no === '2' && ps[3].no === '3' && ps[4].no === '4' && ps[5].no === '5' && ps[6].no === '6');
  ok('PIN/TAN security function 942 in HNSHK, profile PIN:2', ps[2].des[1][0] === '942' && ps[2].des[0].join(':') === 'PIN:2');
  ok('product id in HKVVB', ps[4].des[3][0] === 'TESTPRODUCT');
  ok('the PIN appears once, in HNSHA', msg.split('4711').length === 2 && ps[5].des[2][0] === '4711');
  const one = F.buildMessage({ blz: '1', user: 'u', pin: 'p', msgNo: 1, segments: [] });
  ok('first contact (999) uses profile PIN:1', F.unwrap(F.parse(one))[2].des[0].join(':') === 'PIN:1');

  console.log('\nMT940 / MT535:');
  const rows = F.mt940(MT940_PAGES[0] + MT940_PAGES[1]);
  ok('MT940: four bookings', rows.length === 4, rows);
  ok('MT940: debit negative, booking date, purpose and name', rows[0].amount === -50 && rows[0].date === '2025-01-15' && rows[0].purpose === 'Miete Januar' && rows[0].name === 'Max Mustermann' && rows[0].bookingText === 'SEPA-UEBERWEISUNG', rows[0]);
  ok('MT940: credit positive, GV code', rows[1].amount === 1500 && rows[1].gvc === '166');
  const turn = F.mt940(':60F:C241231EUR0,00\n:61:2412310102D1,00NMSCNONREF\n:86:805?00X\n:61:2501021231C2,00NMSCNONREF\n:86:166?00Y');
  ok('MT940: year turn both ways (valued 31.12. booked 02.01.; valued 02.01. booked 31.12.)', turn[0].date === '2025-01-02' && turn[1].date === '2024-12-31', turn.map((x) => x.date));
  const st = F.mt535(MT535);
  ok('MT535: statement date and two positions', st.date === '2025-02-03' && st.positions.length === 2, st);
  const dax = st.positions[0];
  ok('MT535: ISIN, name over two lines, quantity, price, value', dax.isin === 'DE0005933931' && dax.name === 'iShares Core DAX UCITS ETF (DE)' && dax.quantity === 12 && approx(dax.price, 139.52) && dax.priceCurrency === 'EUR' && approx(dax.value, 1674.24) && dax.priceDate === '2025-01-31', dax);
  ok('MT535: fractional quantity', st.positions[1].quantity === 3.5);

  console.log('\ndialogs against the synthetic bank:');
  const cfg = { blz: '12030000', user: 'demo-user', pin: '4711', productId: 'TESTPRODUCT', productVersion: '1' };
  const bank = createBank();
  const sync = await F.synchronize(cfg, (m) => bank.handle(m));
  ok('first contact: system id', sync.systemId === 'SYS-demo-user', sync);
  ok('first contact: the TAN methods the bank allows, with names', sync.methods.length === 2 && sync.methods[0].secFunc === '942' && sync.methods[0].name === 'pushTAN 2.0' && sync.methods[1].name === 'SMS-TAN', sync.methods);
  ok('first contact: the dialog is ended (HKEND)', /HKEND/.test(bank.state.log[bank.state.log.length - 1]));

  const waits = [];
  const hooks = { sleep: () => null, waiting: (w) => waits.push(w), tan: () => { throw new Error('no TAN expected'); } };
  const res = await F.fetchAll(Object.assign({}, cfg, { systemId: sync.systemId, secFunc: '942' }), (m) => bank.handle(m), hooks, { from: '2025-01-01' });
  ok('pushTAN: waits for the app, polls until released', waits.length === 3 && /App/.test(waits[0].challenge), waits);
  ok('two accounts: current account and depot', res.accounts.length === 2 && res.accounts.filter((a) => a.depot).length === 1, res.accounts.map((a) => a.accountNo));
  const giro = res.accounts.find((a) => !a.depot), depot = res.accounts.find((a) => a.depot);
  ok('SEPA data: IBAN and BIC', giro.iban === 'DE02120300000000202051' && giro.bic === 'BYLADEM1001', giro);
  ok('balance 2.420,10 EUR on 2025-02-03', giro.balance && approx(giro.balance.amount, 2420.1) && giro.balance.date === '2025-02-03', giro.balance);
  ok('transactions over two pages (touchdown)', giro.transactions.length === 4, giro.transactions.length);
  ok('depot statement: two positions', depot.positions && depot.positions.length === 2 && depot.positionsDate === '2025-02-03', depot);
  ok('no warnings', res.warnings.length === 0, res.warnings);
  const pinMsgs = bank.state.log.filter((m) => m.indexOf('4711') > -1);
  ok('every message carries the PIN only in HNSHA', pinMsgs.every((m) => F.unwrap(F.parse(m)).filter((s) => JSON.stringify(s.des).indexOf('"4711"') > -1) /* the PIN as a whole element; random ids can contain the digits */.every((s) => s.type === 'HNSHA')));

  // TAN entered (SMS-TAN, not decoupled)
  const bank2 = createBank({ decoupled: false });
  let asked = '';
  const r2 = await F.fetchAll(Object.assign({}, cfg, { systemId: 'SYS-demo-user', secFunc: '921' }), (m) => bank2.handle(m), { tan: (c) => { asked = c.challenge; return '123456'; } }, {});
  ok('SMS-TAN: the challenge is shown and the TAN goes into HNSHA', /SMS/.test(asked) && r2.accounts.length === 2 && bank2.state.log.some((m) => /HNSHA:\d+:2\+\d+\+\+4711:123456'/.test(m)), asked);
  ok('without a date no transactions are fetched', r2.accounts.every((a) => a.transactions.length === 0));
  // wrong TAN
  const bank3 = createBank({ decoupled: false });
  let err3 = null;
  try { await F.fetchAll(Object.assign({}, cfg, { systemId: 'S', secFunc: '921' }), (m) => bank3.handle(m), { tan: () => '000000' }, {}); } catch (e) { err3 = e; }
  ok('a wrong TAN is reported with the bank\'s code', err3 && err3.code === '9941', err3 && err3.message);
  // wrong PIN
  let err4 = null;
  try { await F.synchronize(Object.assign({}, cfg, { pin: '0000' }), (m) => createBank().handle(m)); } catch (e) { err4 = e; }
  ok('a wrong PIN is reported (9910)', err4 && err4.code === '9910' && /PIN/.test(err4.message), err4 && err4.message);
  // cancelled TAN
  let err5 = null;
  try { await F.fetchAll(Object.assign({}, cfg, { systemId: 'S', secFunc: '921' }), (m) => createBank({ decoupled: false }).handle(m), { tan: () => null }, {}); } catch (e) { err5 = e; }
  ok('no TAN entered: cancelled', err5 && err5.code === 'cancelled');
  // transactions that need a TAN of their own
  const bank6 = createBank({ kazNeedsTan: true });
  const w6 = [];
  const r6 = await F.fetchAll(Object.assign({}, cfg, { systemId: 'S', secFunc: '942' }), (m) => bank6.handle(m), { sleep: () => null, waiting: (w) => w6.push(w) }, { from: '2025-01-01' });
  ok('HKKAZ with its own strong authentication (HIPINS J): authorised, both pages', r6.accounts.find((a) => !a.depot).transactions.length === 4 && w6.length >= 6, w6.length);

  console.log('\ntransport:');
  ok('base64 round trip keeps Latin-1 (umlauts)', F.fromB64(F.toB64('Überweisung Müller')) === 'Überweisung Müller');
  let sent = null;
  const tr = F.workerTransport('https://w.example.dev/', 'https://fints.example.de/fints', async (url, init) => { sent = { url, body: JSON.parse(init.body) }; return { status: 200, json: async () => ({ status: 200, msg: F.toB64("HNHBK:1:3+1'") }) }; });
  const back = await tr("HNHBK:1:3+0'");
  ok('workerTransport: posts { url, msg } to action=fints and decodes the answer', sent.url === 'https://w.example.dev/?action=fints' && sent.body.url === 'https://fints.example.de/fints' && F.fromB64(sent.body.msg) === "HNHBK:1:3+0'" && back === "HNHBK:1:3+1'", sent);
  let terr = null;
  try { await F.workerTransport('https://w', 'u', async () => ({ status: 403, json: async () => ({ error: 'Bank not allowed' }) }))('x'); } catch (e) { terr = e; }
  ok('workerTransport: a refused bank is an error with the Worker\'s reason', terr && /Bank not allowed/.test(terr.message));

  console.log('\n  ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
