// Node harness for reusable CSV import presets (WI-8). Pure, no browser.
// Run: node test/import-presets.test.js
'use strict';

let passed = 0, failed = 0;
function ok(name, cond) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.error('  ✗ ' + name); }
}

const IM = require('../import-mapping.js');

(function run() {
  console.log('import-presets:');

  const headers = ['Trade Date', 'Side', 'Ticker', 'Shares', 'Unit Price', 'Commission', 'Ccy'];
  // Pretend the user mapped an unknown broker's columns by hand.
  const mapping = { date: 'Trade Date', type: 'Side', symbol: 'Ticker', quantity: 'Shares', price: 'Unit Price', fee: 'Commission', currency: 'Ccy' };

  // ---- buildPreset normalises and assigns an id ----
  const preset = IM.buildPreset({ name: 'My Broker', mapping, delimiter: ';', dateFormat: 'de', category: 'stocks', currency: 'eur' });
  ok('buildPreset keeps the name', preset.name === 'My Broker');
  ok('buildPreset assigns an id', !!preset.id);
  ok('buildPreset normalises currency', preset.currency === 'EUR');
  ok('buildPreset stores the columnMap', preset.columnMap.symbol === 'Ticker' && preset.columnMap.fee === 'Commission');
  ok('buildPreset keeps delimiter + dateFormat', preset.delimiter === ';' && preset.dateFormat === 'de');

  // an unnamed preset is rejected
  ok('unnamed preset rejected', IM.buildPreset({ mapping }) === null);

  // ---- applyPreset reproduces the same mapping on matching headers ----
  const applied = IM.applyPreset(preset, headers);
  ok('applyPreset reproduces the mapping exactly', JSON.stringify(applied.mapping) === JSON.stringify(mapping));
  ok('applyPreset reports no missing columns', applied.missing.length === 0);
  ok('applyPreset carries category + currency', applied.category === 'stocks' && applied.currency === 'EUR');

  // ---- missing columns degrade cleanly ----
  const fewerHeaders = ['Trade Date', 'Ticker', 'Shares', 'Unit Price']; // no Side/Commission/Ccy
  const degraded = IM.applyPreset(preset, fewerHeaders);
  ok('present columns still map', degraded.mapping.symbol === 'Ticker' && degraded.mapping.date === 'Trade Date');
  ok('absent columns degrade to null', degraded.mapping.type === null && degraded.mapping.fee === null && degraded.mapping.currency === null);
  ok('missing columns are reported', degraded.missing.sort().join(',') === 'currency,fee,type');

  // ---- upsert / get / remove ----
  let st = IM.upsertPreset({ version: 1, presets: [] }, preset);
  ok('upsert adds a preset', st.presets.length === 1);
  // same name updates in place (no duplicate)
  st = IM.upsertPreset(st, IM.buildPreset({ name: 'My Broker', mapping, delimiter: ',', category: 'stocks' }));
  ok('upsert by name updates in place', st.presets.length === 1 && st.presets[0].delimiter === ',');
  const id = st.presets[0].id;
  ok('getPreset finds by id', IM.getPreset(st, id).name === 'My Broker');
  st = IM.removePreset(st, id);
  ok('removePreset deletes', st.presets.length === 0);

  // ---- normalize roundtrip (backup) ----
  const stored = IM.upsertPreset({ version: 1, presets: [] }, preset);
  const json = JSON.stringify(IM.normalizePresets(stored));
  const back = IM.normalizePresets(JSON.parse(json));
  ok('backup roundtrip preserves the preset', back.presets.length === 1 && back.presets[0].name === 'My Broker');
  ok('roundtrip preserves the columnMap', back.presets[0].columnMap.price === 'Unit Price');

  // junk input degrades to an empty set
  ok('junk normalises to empty', IM.normalizePresets('not json').presets.length === 0);
  ok('array form accepted', IM.normalizePresets([preset]).presets.length === 1);

  // a re-import with the saved preset yields the identical mapping object
  const reMapping = IM.applyPreset(IM.getPreset(stored, stored.presets[0].id), headers).mapping;
  ok('saved preset re-imports the same broker without re-mapping', JSON.stringify(reMapping) === JSON.stringify(mapping));

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
