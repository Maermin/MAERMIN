// ============================================================================
// MAERMIN — Budget and spending  (window.MaerminBudget)
// ----------------------------------------------------------------------------
// P5-5.3. A separate ledger for the money that goes through bank accounts:
// grocery bookings never touch the portfolio transactions.
//   - In: bank CSV exports (Sparkasse CSV-CAMT, ING, DKB, N26 and similar
//     header-based exports; German and English number and date formats) and
//     the rows a FinTS or GoCardless fetch brought in (fromBankRows). A repeat
//     import adds nothing twice (source + externalId).
//   - Categories (income, expense, saving, transfer) with keyword rules: a
//     category set by hand wins, then the user's rules, then the built-ins.
//     Splits book parts of one payment to several categories.
//   - A budget per category and month, income, expenses, savings and the
//     savings rate; the cash-flow Sankey; recurring payments (monthly,
//     quarterly, yearly) with the next date and the monthly cost.
// Stored in 'maermin_budget' (sensitive: encrypted, synced, in the backup).
// Amounts as booked (the account currency, normally EUR).
// Node-tested in test/budget.test.js.
// ============================================================================
(function () {
  'use strict';
// Translation lookup (i18n.js): __('key', 'English fallback', { slot: value }).
function __(k, f, v) { return (typeof window !== 'undefined' && window.MaerminI18n ? window.MaerminI18n : require('./i18n.js')).t(k, f, v); }

  var KEY = 'maermin_budget';
  var EPS = 0.005;

  // id, kind (names: defaultName below)
  var DEFAULT_CATEGORIES = [
    ['salary', 'income'], ['other-income', 'income'],
    ['housing', 'expense'], ['utilities', 'expense'],
    ['groceries', 'expense'], ['restaurants', 'expense'],
    ['transport', 'expense'], ['travel', 'expense'],
    ['subscriptions', 'expense'], ['insurance', 'expense'],
    ['health', 'expense'], ['shopping', 'expense'],
    ['household', 'expense'], ['education', 'expense'],
    ['gifts', 'expense'], ['fees', 'expense'],
    ['taxes', 'expense'], ['cash', 'expense'],
    ['uncategorized', 'expense'],
    ['savings', 'saving'], ['transfer', 'transfer']
  ];
  // Category names: literal keys, so the translation check sees every one.
  function defaultName(id) {
    switch (id) {
      case 'salary': return __('bgCatSalary', 'Salary');
      case 'other-income': return __('bgCatOtherIncome', 'Other income');
      case 'housing': return __('bgCatHousing', 'Housing');
      case 'utilities': return __('bgCatUtilities', 'Utilities & phone');
      case 'groceries': return __('bgCatGroceries', 'Groceries');
      case 'restaurants': return __('bgCatRestaurants', 'Restaurants & delivery');
      case 'transport': return __('bgCatTransport', 'Transport');
      case 'travel': return __('bgCatTravel', 'Travel');
      case 'subscriptions': return __('bgCatSubscriptions', 'Subscriptions');
      case 'insurance': return __('bgCatInsurance', 'Insurance');
      case 'health': return __('bgCatHealth', 'Health');
      case 'shopping': return __('bgCatShopping', 'Shopping');
      case 'household': return __('bgCatHousehold', 'Household & drugstore');
      case 'education': return __('bgCatEducation', 'Education');
      case 'gifts': return __('bgCatGifts', 'Gifts & donations');
      case 'fees': return __('bgCatFees', 'Bank fees');
      case 'taxes': return __('bgCatTaxes', 'Taxes');
      case 'cash': return __('bgCatCash', 'Cash withdrawals');
      case 'uncategorized': return __('bgCatUncategorized', 'Uncategorized');
      case 'savings': return __('bgCatSavings', 'Savings & investments');
      case 'transfer': return __('bgCatTransfer', 'Own transfers');
      default: return id;
    }
  }
  // Built-in keyword rules, first match wins (specific before general).
  var BUILTIN = [
    ['salary', /\b(gehalt|lohn|bez(ü|ue)ge|salary|payroll)\b/i, 'in'],
    ['transfer', /\b(umbuchung|(ü|ue)bertrag|eigen(er|es)? konto|own account)\b/i],
    ['fees', /\b(kontof(ü|ue)hrung|entgelt|geb(ü|ue)hr|bank fee)/i],
    ['savings', /trade republic|scalable|flatex|degiro|consorsbank depot|smartbroker|sparplan|wertpapier|tagesgeld|festgeld|bauspar|\betf\b|\bdepot\b/i],
    ['taxes', /finanzamt|kfz-steuer|grundsteuer|\bsteuer\b/i],
    ['housing', /\bmiete\b|\brent\b|hausverwaltung|wohnungs|nebenkosten|hausgeld/i],
    ['utilities', /stadtwerke|\bstrom\b|\bgas\b|vattenfall|e\.on|\beon\b|enbw|telekom|vodafone|\bo2\b|1&1|congstar|internet|rundfunk|beitragsservice/i],
    ['subscriptions', /netflix|spotify|disney|amazon prime|prime video|apple\.com\/bill|youtube|dazn|\bsky\b|audible|chatgpt|openai/i],
    ['groceries', /\brewe\b|edeka|\baldi\b|\blidl\b|\bnetto\b|\bpenny\b|kaufland|\bnorma\b|tegut|globus|alnatura|denns|supermarkt/i],
    ['restaurants', /restaurant|lieferando|wolt|uber \*?eats|mcdonald|burger king|starbucks|\bcaf(e|é)\b|pizzeria|imbiss|kantine/i],
    ['transport', /deutsche bahn|\bdb (vertrieb|fernverkehr)|\bbahn\b|tankstelle|\bshell\b|\baral\b|\besso\b|\bjet\b|\bbvg\b|\bmvv\b|\bhvv\b|\bvrr\b|\buber\b|\bbolt\b|flixbus|parkhaus|parken|deutschlandticket/i],
    ['travel', /booking\.com|airbnb|lufthansa|ryanair|eurowings|easyjet|condor|\bhotel\b|expedia/i],
    ['insurance', /versicherung|allianz|\bhuk\b|huk-coburg|\bergo\b|\baxa\b|debeka|signal iduna|\bdevk\b|generali/i],
    ['health', /apotheke|\barzt\b|praxis|zahnarzt|klinik|krankenkasse|optiker|fielmann/i],
    ['household', /rossmann|\bdm\b|dm-drogerie|m(ü|ue)ller drogerie|\bobi\b|bauhaus|hornbach|toom|ikea/i],
    ['shopping', /amazon|zalando|\botto\b|ebay|mediamarkt|saturn|h&m|primark|decathlon|about you/i],
    ['education', /schule|universit|hochschule|kita|kindergarten|udemy|coursera|volkshochschule/i],
    ['gifts', /spende|donation|unicef|caritas|(ä|ae)rzte ohne grenzen|wikimedia/i],
    ['cash', /geldautomat|bargeld|\batm\b|auszahlung/i]
  ];

  function num(v) { var n = parseFloat(v); return isFinite(n) ? n : 0; }
  function r2(v) { return Math.round(v * 100) / 100; }
  function fnv(s) { var h = 0x811c9dc5; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return ('0000000' + h.toString(16)).slice(-8); }
  function str(v) { return v == null ? '' : String(v).trim(); }

  // ---- state ----------------------------------------------------------------------
  function defaultCategories() { return DEFAULT_CATEGORIES.map(function (c) { return { id: c[0], kind: c[1], name: c[0] }; }); }
  function normalize(raw) {
    if (typeof raw === 'string') { try { raw = JSON.parse(raw); } catch (e) { raw = null; } }
    raw = raw && typeof raw === 'object' ? raw : {};
    var cats = defaultCategories();
    (Array.isArray(raw.categories) ? raw.categories : []).forEach(function (c) {
      if (!c || !c.id || !c.custom) return;
      if (!cats.some(function (x) { return x.id === c.id; })) cats.push({ id: String(c.id), kind: ['income', 'expense', 'saving', 'transfer'].indexOf(c.kind) >= 0 ? c.kind : 'expense', name: str(c.name).slice(0, 60) || String(c.id), custom: true });
    });
    var ids = {}; cats.forEach(function (c) { ids[c.id] = true; });
    var txs = (Array.isArray(raw.txs) ? raw.txs : []).filter(function (t) { return t && /^\d{4}-\d{2}-\d{2}$/.test(t.date) && isFinite(parseFloat(t.amount)); }).map(function (t) {
      var o = { id: String(t.id), date: t.date, amount: r2(num(t.amount)), currency: str(t.currency) || 'EUR', name: str(t.name).slice(0, 140), purpose: str(t.purpose).slice(0, 280),
        account: str(t.account).slice(0, 60), source: str(t.source) || 'csv', externalId: str(t.externalId) };
      if (t.category && ids[t.category]) o.category = t.category;
      if (Array.isArray(t.splits) && t.splits.length) o.splits = t.splits.filter(function (s) { return s && ids[s.category]; }).map(function (s) { return { category: s.category, amount: r2(num(s.amount)) }; });
      if (t.note) o.note = str(t.note).slice(0, 200);
      return o;
    });
    var rules = (Array.isArray(raw.rules) ? raw.rules : []).filter(function (r) { return r && str(r.contains) && ids[r.category]; }).map(function (r) {
      return { id: String(r.id || ('r' + fnv(r.contains + r.category))), field: ['name', 'purpose'].indexOf(r.field) >= 0 ? r.field : 'any', contains: str(r.contains).slice(0, 80), category: r.category };
    });
    var budgets = {};
    Object.keys(raw.budgets || {}).forEach(function (k) { var v = parseFloat(raw.budgets[k]); if (ids[k] && isFinite(v) && v > 0) budgets[k] = r2(v); });
    return { v: 1, categories: cats, txs: txs, rules: rules, budgets: budgets };
  }
  function load() { try { return normalize(localStorage.getItem(KEY)); } catch (e) { return normalize(null); } }
  function save(s) { var n = normalize(s); try { localStorage.setItem(KEY, JSON.stringify({ v: 1, categories: n.categories.filter(function (c) { return c.custom; }), txs: n.txs, rules: n.rules, budgets: n.budgets })); } catch (e) { /* non-fatal */ } return n; }
  function catById(state, id) { for (var i = 0; i < state.categories.length; i++) if (state.categories[i].id === id) return state.categories[i]; return null; }
  function catName(c) { return c ? (c.custom ? c.name : defaultName(c.id)) : ''; }

  // ---- CSV ------------------------------------------------------------------------------
  function splitLine(line, d) {
    var out = [], cur = '', q = false;
    for (var i = 0; i < line.length; i++) {
      var ch = line[i];
      if (q) { if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
      else if (ch === '"') q = true;
      else if (ch === d) { out.push(cur); cur = ''; }
      else cur += ch;
    }
    out.push(cur);
    return out.map(function (s) { return s.trim(); });
  }
  function parseAmount(s) {
    var t = str(s).replace(/[€\s]|EUR/gi, '');
    if (!t) return null;
    if (/^-?[\d.]+,\d+$/.test(t) || /^-?\d+,\d+$/.test(t)) t = t.replace(/\./g, '').replace(',', '.');
    else t = t.replace(/,/g, '');
    var n = parseFloat(t);
    return isFinite(n) ? n : null;
  }
  function parseDate(s) {
    var t = str(s), m;
    if ((m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t))) return m[1] + '-' + m[2] + '-' + m[3];
    if ((m = /^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})$/.exec(t))) {
      var y = m[3].length === 2 ? '20' + m[3] : m[3];
      return y + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2);
    }
    if ((m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t))) return m[3] + '-' + ('0' + m[1]).slice(-2) + '-' + ('0' + m[2]).slice(-2);
    return null;
  }
  var COLS = {
    date: [/^buchungstag$/, /^buchungsdatum$/, /^buchung$/, /^datum$/, /^date$/, /^booking date$/, /^transaction date$/],
    amount: [/^betrag( \(€\)| \(eur\))?$/, /^umsatz( in eur)?$/, /^amount( \(eur\))?$/, /^betrag \(eur\)$/],
    name: [/^beguenstigter\/zahlungspflichtiger$/, /^beg(ü|ue)nstigter\/zahlungspflichtiger$/, /^auftraggeber\/empf(ä|ae)nger$/, /^empf(ä|ae)nger$/, /^name$/, /^payee$/, /^counterparty$/, /^zahlungsempf(ä|ae)nger$/],
    payer: [/^zahlungspflichtige\*r$/], payee: [/^zahlungsempf(ä|ae)nger\*in$/],
    purpose: [/^verwendungszweck$/, /^payment reference$/, /^reference$/, /^description$/, /^beschreibung$/],
    text: [/^buchungstext$/, /^transaction type$/, /^umsatztyp$/],
    currency: [/^w(ä|ae)hrung$/, /^currency$/]
  };
  function findCol(head, list) {
    for (var i = 0; i < head.length; i++) { var h = head[i].toLowerCase(); for (var j = 0; j < list.length; j++) if (list[j].test(h)) return i; }
    return -1;
  }
  // → { rows: [{ date, amount, name, purpose, currency }], format, skipped, error? }
  function parseCsv(text) {
    var lines = String(text || '').replace(/^﻿/, '').split(/\r?\n/);
    for (var i = 0; i < Math.min(lines.length, 40); i++) {
      var line = lines[i];
      var d = (line.match(/;/g) || []).length >= (line.match(/,/g) || []).length ? ';' : ',';
      var head = splitLine(line, d);
      var c = { date: findCol(head, COLS.date), amount: findCol(head, COLS.amount), name: findCol(head, COLS.name), payer: findCol(head, COLS.payer), payee: findCol(head, COLS.payee),
        purpose: findCol(head, COLS.purpose), text: findCol(head, COLS.text), currency: findCol(head, COLS.currency) };
      if (c.date < 0 || c.amount < 0 || (c.name < 0 && c.payee < 0 && c.purpose < 0)) continue;
      var low = line.toLowerCase();
      var format = /beguenstigter\/zahlungspflichtiger/.test(low) ? 'sparkasse' : /auftraggeber\/empf/.test(low) ? 'ing' : /zahlungsempf(ä|ae)nger\*in/.test(low) ? 'dkb' : 'generic';
      var rows = [], skipped = 0;
      for (var k = i + 1; k < lines.length; k++) {
        if (!lines[k].trim()) continue;
        var f = splitLine(lines[k], d);
        var date = parseDate(f[c.date]), amount = parseAmount(f[c.amount]);
        if (!date || amount == null || amount === 0) { skipped++; continue; }
        var name = c.payee >= 0 ? (amount < 0 ? f[c.payee] : f[c.payer]) : (c.name >= 0 ? f[c.name] : '');
        var purpose = c.purpose >= 0 ? f[c.purpose] : '';
        if (!purpose && c.text >= 0) purpose = f[c.text];
        rows.push({ date: date, amount: r2(amount), name: str(name), purpose: str(purpose), currency: c.currency >= 0 && /^[A-Z]{3}$/.test(str(f[c.currency])) ? str(f[c.currency]) : 'EUR' });
      }
      return { rows: rows, format: format, skipped: skipped };
    }
    return { rows: [], format: null, skipped: 0, error: 'no-header' };
  }

  // FinTS (bank-sync.js) and GoCardless (aggregators.js) rows → budget rows.
  function fromBankRows(account, rows) {
    var acc = str(account && (account.iban || account.accountNo || account.name));
    return (rows || []).filter(function (r) { return r && /^\d{4}-\d{2}-\d{2}$/.test(r.date || '') && Math.abs(num(r.amount)) > 0; }).map(function (r) {
      var o = { date: r.date, amount: r2(num(r.amount)), name: str(r.name), purpose: str(r.purpose || r.bookingText), currency: str(r.currency) || str(account && account.currency) || 'EUR', account: acc };
      if (r.id) o.externalId = String(r.id);
      return o;
    });
  }

  // ---- ingest and categories ---------------------------------------------------------------
  function ingest(state, rows, opts) {
    opts = opts || {};
    var s = normalize(state);
    var have = {}, seen = {}, added = 0;
    s.txs.forEach(function (t) { have[t.source + '|' + t.externalId] = true; });
    (rows || []).forEach(function (r) {
      if (!r || !/^\d{4}-\d{2}-\d{2}$/.test(r.date || '') || !(Math.abs(num(r.amount)) > 0)) return;
      var account = str(r.account || opts.account);
      var source = str(opts.source) || 'csv';
      var ext = r.externalId;
      if (!ext) {
        var base = [account, r.date, r2(num(r.amount)).toFixed(2), str(r.name), str(r.purpose)].join('|');
        seen[base] = (seen[base] || 0) + 1;
        ext = fnv(base) + '-' + seen[base];
      }
      if (have[source + '|' + ext]) return;
      have[source + '|' + ext] = true;
      s.txs.push({ id: 'b' + fnv(source + '|' + ext) + fnv(ext + '|' + source).slice(0, 4), date: r.date, amount: r2(num(r.amount)), currency: str(r.currency) || 'EUR',
        name: str(r.name).slice(0, 140), purpose: str(r.purpose).slice(0, 280), account: account, source: source, externalId: ext });
      added++;
    });
    s.txs.sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; });
    return { state: s, added: added };
  }
  function ruleMatch(rule, tx) {
    var hay = (rule.field === 'name' ? tx.name : rule.field === 'purpose' ? tx.purpose : tx.name + ' ' + tx.purpose).toLowerCase();
    return hay.indexOf(rule.contains.toLowerCase()) >= 0;
  }
  function categoryOf(state, tx) {
    if (!tx) return null;
    if (tx.category && catById(state, tx.category)) return tx.category;
    for (var i = 0; i < state.rules.length; i++) if (ruleMatch(state.rules[i], tx)) return state.rules[i].category;
    var hay = tx.name + ' ' + tx.purpose;
    for (var j = 0; j < BUILTIN.length; j++) {
      var b = BUILTIN[j];
      if (b[2] === 'in' && tx.amount < 0) continue;
      if (b[1].test(hay)) return b[0];
    }
    return tx.amount > 0 ? 'other-income' : 'uncategorized';
  }
  function update(state, id, fn) {
    var s = normalize(state);
    s.txs = s.txs.map(function (t) { return t.id === id ? fn(Object.assign({}, t)) : t; });
    return s;
  }
  function setCategory(state, id, category) { return update(state, id, function (t) { if (category) t.category = category; else delete t.category; delete t.splits; return t; }); }
  function setSplits(state, id, splits) {
    var s = normalize(state), tx = s.txs.filter(function (t) { return t.id === id; })[0];
    if (!tx) throw new Error('unknown');
    if (splits && splits.length) {
      var sum = splits.reduce(function (a, p) { return a + num(p.amount); }, 0);
      if (Math.abs(sum - tx.amount) > EPS) throw new Error('split-sum');
    }
    return update(s, id, function (t) { if (splits && splits.length) { t.splits = splits.map(function (p) { return { category: p.category, amount: r2(num(p.amount)) }; }); delete t.category; } else delete t.splits; return t; });
  }
  function addRule(state, rule) { var s = normalize(state); s.rules.push({ id: 'r' + Date.now().toString(36) + s.rules.length, field: rule.field || 'any', contains: rule.contains, category: rule.category }); return normalize(s); }
  function removeRule(state, id) { var s = normalize(state); s.rules = s.rules.filter(function (r) { return r.id !== id; }); return s; }
  function setBudget(state, category, amount) { var s = normalize(state); var v = parseFloat(amount); if (isFinite(v) && v > 0) s.budgets[category] = r2(v); else delete s.budgets[category]; return s; }
  function addCategory(state, name, kind) {
    var s = normalize(state), id = 'c-' + fnv(name + Date.now());
    s.categories.push({ id: id, kind: kind || 'expense', name: str(name).slice(0, 60), custom: true });
    return normalize(s);
  }

  // ---- figures -----------------------------------------------------------------------------
  function partsOf(state, tx) { return tx.splits && tx.splits.length ? tx.splits : [{ category: categoryOf(state, tx), amount: tx.amount }]; }
  function monthSummary(state, month) {
    var s = normalize(state);
    var income = 0, expenses = 0, savings = 0, spent = {}, earned = {}, count = 0;
    s.txs.forEach(function (t) {
      if (t.date.slice(0, 7) !== month) return;
      count++;
      partsOf(s, t).forEach(function (p) {
        var c = catById(s, p.category) || catById(s, 'uncategorized');
        if (c.kind === 'income') { income += p.amount; earned[c.id] = (earned[c.id] || 0) + p.amount; }
        else if (c.kind === 'expense') { expenses -= p.amount; spent[c.id] = (spent[c.id] || 0) - p.amount; }
        else if (c.kind === 'saving') savings -= p.amount;
      });
    });
    var byCategory = s.categories.filter(function (c) { return c.kind === 'expense' && (Math.abs(spent[c.id] || 0) > EPS || s.budgets[c.id]); }).map(function (c) {
      var sp = r2(spent[c.id] || 0), bud = s.budgets[c.id] || null;
      return { id: c.id, name: catName(c), spent: sp, budget: bud, remaining: bud != null ? r2(bud - sp) : null, over: bud != null && sp > bud + EPS, pct: bud ? sp / bud : null };
    }).sort(function (a, b) { return b.spent - a.spent; });
    var incomeBy = Object.keys(earned).map(function (id) { return { id: id, name: catName(catById(s, id)), amount: r2(earned[id]) }; }).sort(function (a, b) { return b.amount - a.amount; });
    return { month: month, count: count, income: r2(income), expenses: r2(expenses), savings: r2(savings), net: r2(income - expenses - savings),
      savingsRate: income > 0 ? (income - expenses) / income : null, byCategory: byCategory, incomeBy: incomeBy };
  }
  // Income sources → budget → expense categories, savings and the rest (or a deficit in).
  function sankey(m) {
    var nodes = [{ id: 'budget', name: __('bgBudgetNode', 'Budget') }], links = [];
    m.incomeBy.forEach(function (x) { if (x.amount > EPS) { nodes.push({ id: x.id, name: x.name, side: 'in' }); links.push({ source: x.id, target: 'budget', value: x.amount }); } });
    m.byCategory.forEach(function (x) { if (x.spent > EPS) { nodes.push({ id: x.id, name: x.name, side: 'out' }); links.push({ source: 'budget', target: x.id, value: x.spent }); } });
    if (m.savings > EPS) { nodes.push({ id: 'savings', name: __('bgCatSavings', 'Savings & investments'), side: 'out' }); links.push({ source: 'budget', target: 'savings', value: m.savings }); }
    var inflow = links.filter(function (l) { return l.target === 'budget'; }).reduce(function (a, l) { return a + l.value; }, 0);
    var outflow = links.filter(function (l) { return l.source === 'budget'; }).reduce(function (a, l) { return a + l.value; }, 0);
    if (inflow - outflow > EPS) { nodes.push({ id: 'rest', name: __('bgRest', 'Left over'), side: 'out' }); links.push({ source: 'budget', target: 'rest', value: r2(inflow - outflow) }); }
    else if (outflow - inflow > EPS) { nodes.push({ id: 'deficit', name: __('bgDeficit', 'From reserves'), side: 'in' }); links.push({ source: 'deficit', target: 'budget', value: r2(outflow - inflow) }); }
    return { nodes: nodes, links: links };
  }

  // ---- recurring payments -----------------------------------------------------------------
  var STOP = { gmbh: 1, ag: 1, bv: 1, inc: 1, ltd: 1, se: 1, kg: 1, co: 1, sagt: 1, danke: 1, mbh: 1, llc: 1, sarl: 1, ohg: 1, ev: 1 };
  function payeeKey(name) {
    return String(name || '').toLowerCase().replace(/[^a-z0-9äöüß]+/g, ' ').split(' ').filter(function (w) { return w.length > 1 && !STOP[w] && !/^\d+$/.test(w); }).join(' ');
  }
  function days(a, b) { return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000); }
  function addMonths(iso, n) {
    var y = +iso.slice(0, 4), m = +iso.slice(5, 7) - 1 + n, d = +iso.slice(8, 10);
    y += Math.floor(m / 12); m = ((m % 12) + 12) % 12;
    var last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    return y + '-' + ('0' + (m + 1)).slice(-2) + '-' + ('0' + Math.min(d, last)).slice(-2);
  }
  var CADENCES = [['monthly', 25, 35, 1, 3], ['quarterly', 85, 97, 3, 3], ['yearly', 350, 380, 12, 2]];
  function recurring(state, opts) {
    opts = opts || {};
    var s = normalize(state), groups = {};
    s.txs.forEach(function (t) { if (t.amount >= 0) return; var k = payeeKey(t.name) || payeeKey(t.purpose); if (!k) return; (groups[k] = groups[k] || []).push(t); });
    var out = [];
    Object.keys(groups).forEach(function (k) {
      var list = groups[k].slice().sort(function (a, b) { return a.date < b.date ? -1 : 1; });
      if (list.length < 2) return;
      var amts = list.map(function (t) { return -t.amount; });
      var sorted = amts.slice().sort(function (a, b) { return a - b; }), med = sorted[Math.floor(sorted.length / 2)];
      if (!amts.every(function (a) { return Math.abs(a - med) <= 0.1 * med + EPS; })) return;
      for (var i = 0; i < CADENCES.length; i++) {
        var c = CADENCES[i];
        if (list.length < c[4]) continue;
        var okGaps = true;
        for (var j = 1; j < list.length; j++) { var g = days(list[j - 1].date, list[j].date); if (g < c[1] || g > c[2]) { okGaps = false; break; } }
        if (!okGaps) continue;
        var last = list[list.length - 1];
        out.push({ key: k, name: last.name, category: categoryOf(s, last), cadence: c[0], count: list.length, amount: r2(-last.amount), last: last.date, next: addMonths(last.date, c[3]),
          monthlyCost: -last.amount / c[3] });
        break;
      }
    });
    return out.sort(function (a, b) { return b.monthlyCost - a.monthlyCost; });
  }
  function recurringMonthly(list) { return (list || []).reduce(function (a, x) { return a + x.monthlyCost; }, 0); }

  // ---- view ------------------------------------------------------------------------------------
  // Income sources on the left, the budget in the middle, the uses on the
  // right. Each node is at least MIN_H tall so its label stays readable (the
  // bands are then not exactly to scale for very small flows). On a narrow
  // screen the labels move into a legend under the chart.
  function SankeyChart(props) {
    var React = window.React, e = React.createElement;
    var sk = props.data, th = props.theme || {}, money = props.money;
    var narrow = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(max-width: 640px)').matches;
    var W = narrow ? 360 : 780, MIN_H = narrow ? 6 : 16, GAP = narrow ? 3 : 4, SCALE = narrow ? 200 : 300;
    var ins = sk.links.filter(function (l) { return l.target === 'budget'; }), outs = sk.links.filter(function (l) { return l.source === 'budget'; });
    var total = Math.max(ins.reduce(function (a, l) { return a + l.value; }, 0), outs.reduce(function (a, l) { return a + l.value; }, 0)) || 1;
    var k = SCALE / total;
    var hIn = ins.map(function (l) { return Math.max(MIN_H, l.value * k); }), hOut = outs.map(function (l) { return Math.max(MIN_H, l.value * k); });
    var sum = function (a) { return a.reduce(function (s, x) { return s + x; }, 0); };
    var top = 8;
    var colIn = sum(hIn) + GAP * Math.max(0, hIn.length - 1), colOut = sum(hOut) + GAP * Math.max(0, hOut.length - 1);
    var H = Math.max(colIn, colOut) + 2 * top;
    var lx = narrow ? 14 : 200, rx = narrow ? W - 24 : W - 220, bw = 14, bx = (lx + rx) / 2 - bw / 2;
    var budgetH = Math.max(sum(hIn), sum(hOut));
    var by = top + (Math.max(colIn, colOut) - budgetH) / 2;
    var name = function (id) { var n = sk.nodes.filter(function (x) { return x.id === id; })[0]; return n ? n.name : id; };
    var palette = ['#8b7cff', '#22c55e', '#f59e0b', '#3b82f6', '#ef4444', '#14b8a6', '#ec4899', '#a3e635', '#f97316', '#06b6d4', '#eab308', '#6366f1'];
    var col = function (i) { return palette[i % palette.length]; };
    var band = function (x0, y0, h0, x1, y1, h1) {
      var cx = (x0 + x1) / 2;
      return 'M' + x0 + ',' + y0 + ' C' + cx + ',' + y0 + ' ' + cx + ',' + y1 + ' ' + x1 + ',' + y1 + ' L' + x1 + ',' + (y1 + h1) + ' C' + cx + ',' + (y1 + h1) + ' ' + cx + ',' + (y0 + h0) + ' ' + x0 + ',' + (y0 + h0) + ' Z';
    };
    var parts = [e('rect', { key: 'b', x: bx, y: by, width: bw, height: budgetH, rx: 3, fill: th.accent || '#8b7cff' })];
    var legend = [];
    // Left: ribbons enter the budget stacked, scaled so they fill its height.
    var y = top + (Math.max(colIn, colOut) - colIn) / 2, bin = by, fin = budgetH / (sum(hIn) || 1);
    ins.forEach(function (l, i) {
      var h = hIn[i], hb = h * fin, c = col(i);
      parts.push(e('rect', { key: 'in' + i, x: lx, y: y, width: 10, height: h, rx: 2, fill: c }));
      parts.push(e('path', { key: 'pi' + i, d: band(lx + 10, y, h, bx, bin, hb), fill: c, opacity: 0.32 }));
      if (!narrow) parts.push(e('text', { key: 'ti' + i, x: lx - 8, y: y + h / 2 + 4, textAnchor: 'end', fontSize: 12, fill: th.text || '#e6edf3' }, name(l.source) + '  ' + money(l.value)));
      legend.push({ c: c, n: name(l.source), v: l.value });
      y += h + GAP; bin += hb;
    });
    y = top + (Math.max(colIn, colOut) - colOut) / 2;
    var bout = by, fout = budgetH / (sum(hOut) || 1);
    outs.forEach(function (l, i) {
      var h = hOut[i], hb = h * fout, c = col(i + ins.length);
      parts.push(e('rect', { key: 'out' + i, x: rx, y: y, width: 10, height: h, rx: 2, fill: c }));
      parts.push(e('path', { key: 'po' + i, d: band(bx + bw, bout, hb, rx, y, h), fill: c, opacity: 0.32 }));
      if (!narrow) parts.push(e('text', { key: 'to' + i, x: rx + 18, y: y + h / 2 + 4, fontSize: 12, fill: th.text || '#e6edf3' }, name(l.target) + '  ' + money(l.value)));
      legend.push({ c: c, n: name(l.target), v: l.value });
      y += h + GAP; bout += hb;
    });
    var svg = e('svg', { key: 'svg', 'data-testid': 'bg-sankey', viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': __('bgSankeyLabel', 'Cash flow of the month'), style: { width: '100%', maxWidth: W + 'px', height: 'auto', display: 'block' } }, parts);
    if (!narrow) return svg;
    return e('div', null, svg, e('div', { style: { display: 'grid', gap: '0.2rem', marginTop: '0.5rem' } }, legend.map(function (x, i) {
      return e('div', { key: i, style: { display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: 'var(--text-xs)', color: th.text || '#e6edf3' } },
        e('span', { style: { width: '10px', height: '10px', borderRadius: '2px', background: x.c, flex: '0 0 auto' } }), e('span', { style: { flex: 1 } }, x.n), e('span', { style: { fontWeight: 700 } }, money(x.v)));
    })));
  }

  // props: { theme, privacy, addToast }
  function View(props) {
    var React = (typeof window !== 'undefined') ? window.React : null;
    if (!React) return null;
    var e = React.createElement, useState = React.useState;
    var th = props.theme || {};
    var text = th.text || '#e6edf3', dim = th.textSecondary || '#9aa4b2', border = th.cardBorder || 'rgba(255,255,255,0.1)';
    var good = th.success || '#22c55e', warn = th.warning || '#f59e0b', bad = th.danger || '#ef4444';
    var toast = props.addToast || function () {};
    var money = function (v) { return props.privacy ? '••••' : window.MaerminI18n.money(v, 'EUR'); };
    var s0 = useState(load); var st = s0[0], setSt = s0[1];
    var latest = st.txs.reduce(function (a, t) { return t.date > a ? t.date : a; }, '').slice(0, 7) || new Date().toISOString().slice(0, 7);
    var s1 = useState(latest); var month = s1[0], setMonth = s1[1];
    var s2 = useState(null); var splitFor = s2[0], setSplitFor = s2[1];
    var s3 = useState([]); var parts = s3[0], setParts = s3[1];
    var s4 = useState({ contains: '', category: 'groceries' }); var newRule = s4[0], setNewRule = s4[1];
    var s5 = useState(''); var catName2 = s5[0], setCatName2 = s5[1];
    function commit(next) { setSt(save(next)); }
    var m = monthSummary(st, month);
    var rec = recurring(st, {});
    var card = { background: th.card || th.cardBg, border: '1px solid ' + border, borderRadius: '14px', padding: '1rem 1.25rem', marginBottom: '1rem' };
    var input = { boxSizing: 'border-box', padding: '0.35rem 0.5rem', background: th.inputBg, border: '1px solid ' + (th.inputBorder || border), borderRadius: '8px', color: text, fontSize: '0.8rem', fontFamily: 'inherit' };
    var btn = { padding: '0.4rem 0.8rem', borderRadius: '8px', border: '1px solid ' + border, background: th.inputBg, color: text, cursor: 'pointer', fontSize: '0.78rem', fontWeight: 600 };
    var h3 = function (t) { return e('h3', { style: { color: text, fontSize: 'var(--text-body)', fontWeight: 700, margin: '0 0 0.6rem' } }, t); };
    var kpi = function (lbl, val, color, tid) { return e('div', { 'data-testid': tid, style: Object.assign({}, card, { marginBottom: 0, flex: '1 1 150px' }) }, e('div', { style: { color: dim, fontSize: 'var(--text-xs)' } }, lbl), e('div', { style: { color: color || text, fontSize: 'var(--text-title)', fontWeight: 800 } }, val)); };
    function shift(n) { var d = new Date(Date.UTC(+month.slice(0, 4), +month.slice(5, 7) - 1 + n, 1)); setMonth(d.toISOString().slice(0, 7)); }
    function onFile(ev) {
      var f = ev.target.files && ev.target.files[0];
      if (!f) return;
      var read = function (enc) { return new Promise(function (res) { var fr = new FileReader(); fr.onload = function () { res(String(fr.result || '')); }; fr.readAsText(f, enc); }); };
      read('utf-8').then(function (t) { return /�/.test(t) ? read('windows-1252') : t; }).then(function (t) {
        var p = parseCsv(t);
        if (!p.rows.length) { toast(__('bgCsvNone', 'No bookings found. Export the account as CSV from your online banking.'), 'error'); return; }
        var r = ingest(st, p.rows, { source: 'csv', account: f.name.replace(/\.csv$/i, '').slice(0, 40) });
        commit(r.state);
        if (r.state.txs.length) setMonth(p.rows[0].date.slice(0, 7));
        toast(__('bgCsvAdded', '{n} new bookings added ({skip} already there)', { n: r.added, skip: p.rows.length - r.added }), 'success');
      });
      ev.target.value = '';
    }
    var cats = st.categories;
    var monthTx = st.txs.filter(function (t) { return t.date.slice(0, 7) === month; });
    var catOptions = function () { return cats.map(function (c) { return e('option', { key: c.id, value: c.id }, catName(c)); }); };
    return e('div', { 'data-testid': 'budget-view', style: { padding: '1.5rem' } },
      e('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.5rem' } },
        e('h2', { style: { color: text, fontSize: 'var(--text-xl)', fontWeight: 700, margin: 0 } }, __('bgTitle', 'Budget')),
        e('div', { style: { display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' } },
          e('button', { style: btn, 'aria-label': __('bgPrevMonth', 'Previous month'), onClick: function () { shift(-1); } }, '‹'),
          e('span', { 'data-testid': 'bg-month', style: { color: text, fontWeight: 700, minWidth: '7rem', textAlign: 'center' } }, window.MaerminI18n.date(month + '-01', 'monthLong')),
          e('button', { style: btn, 'aria-label': __('bgNextMonth', 'Next month'), onClick: function () { shift(1); } }, '›'),
          e('label', { style: Object.assign({}, btn, { background: th.accentFill || th.accent, color: '#fff', border: 'none' }) }, __('bgImportCsv', 'Import bank CSV'),
            e('input', { type: 'file', accept: '.csv,text/csv', 'data-testid': 'bg-csv', onChange: onFile, style: { display: 'none' } })))),
      e('p', { style: { color: dim, fontSize: 'var(--text-sm)', margin: '0 0 1rem', lineHeight: 1.5 } },
        __('bgIntro', 'Spending from your bank accounts, separate from your portfolio. Import a CSV export from online banking (Sparkasse, ING, DKB, N26, …) or add the transactions of a bank sync. Everything stays encrypted on this device.')),
      e('div', { style: { display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '1rem' } },
        kpi(__('bgIncome', 'Income'), money(m.income), good, 'bg-income'),
        kpi(__('bgExpenses', 'Expenses'), money(m.expenses), bad, 'bg-expenses'),
        kpi(__('bgSavings', 'Saved & invested'), money(m.savings), text, 'bg-savings'),
        kpi(__('bgSavingsRate', 'Savings rate'), m.savingsRate == null ? '–' : window.MaerminI18n.num(m.savingsRate * 100, 1) + ' %', m.savingsRate != null && m.savingsRate < 0 ? bad : good, 'bg-rate')),
      !st.txs.length ? e('div', { style: Object.assign({}, card, { color: dim, fontSize: '0.85rem' }) }, __('bgEmpty', 'No bookings yet. Import a bank CSV export to start.')) : null,
      m.count ? e('div', { style: card }, h3(__('bgCashFlow', 'Cash flow')), e(SankeyChart, { data: sankey(m), theme: th, money: money })) : null,
      m.byCategory.length ? e('div', { style: card }, h3(__('bgByCategory', 'Spending by category')),
        m.byCategory.map(function (c) {
          var pct = c.budget ? Math.min(100, c.spent / c.budget * 100) : 0;
          return e('div', { key: c.id, 'data-testid': 'bg-cat-' + c.id, style: { padding: '0.35rem 0', borderTop: '1px solid ' + border } },
            e('div', { style: { display: 'flex', justifyContent: 'space-between', gap: '0.5rem', alignItems: 'center', fontSize: 'var(--text-sm)', flexWrap: 'wrap' } },
              e('span', { style: { color: text, fontWeight: 600 } }, c.name),
              e('span', { style: { display: 'flex', gap: '0.5rem', alignItems: 'center' } },
                e('span', { style: { color: c.over ? bad : text, fontWeight: 700 } }, money(c.spent) + (c.budget ? ' / ' + money(c.budget) : '')),
                e('input', { key: 'bud' + c.id + (st.budgets[c.id] || ''), inputMode: 'decimal', placeholder: __('bgBudgetPh', 'Budget'), 'aria-label': __('bgBudgetFor', 'Monthly budget for {c}', { c: c.name }), defaultValue: st.budgets[c.id] || '',
                  style: Object.assign({}, input, { width: '80px' }), onBlur: function (ev) { commit(setBudget(st, c.id, String(ev.target.value).replace(',', '.'))); } }))),
            c.budget ? e('div', { style: { height: '6px', borderRadius: '3px', background: th.inputBg || 'rgba(255,255,255,0.08)', marginTop: '0.3rem', overflow: 'hidden' } },
              e('div', { style: { width: pct + '%', height: '100%', background: c.over ? bad : pct > 85 ? warn : good } })) : null);
        })) : null,
      monthTx.length ? e('div', { style: card }, h3(__('bgBookings', 'Bookings')),
        monthTx.map(function (t) {
          var cid = categoryOf(st, t);
          return e('div', { key: t.id, 'data-testid': 'bg-tx', style: { borderTop: '1px solid ' + border, padding: '0.35rem 0' } },
            e('div', { style: { display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap', fontSize: 'var(--text-sm)' } },
              e('span', { style: { color: dim, minWidth: '5.5rem' } }, window.MaerminI18n.date(t.date)),
              e('span', { style: { color: text, flex: '1 1 160px', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, title: t.purpose }, t.name ? t.name : t.purpose),
              e('span', { style: { color: t.amount < 0 ? text : good, fontWeight: 700, minWidth: '6rem', textAlign: 'right' } }, money(t.amount)),
              t.splits ? e('span', { style: { color: dim, fontSize: 'var(--text-xs)' } }, __('bgSplitN', 'split in {n}', { n: t.splits.length }))
                : e('select', { value: cid, style: input, 'aria-label': __('bgCategory', 'Category'), onChange: function (ev) { commit(setCategory(st, t.id, ev.target.value)); } }, catOptions()),
              e('button', { style: btn, onClick: function () { setSplitFor(t.id); setParts(t.splits ? t.splits.map(function (p) { return Object.assign({}, p); }) : [{ category: cid, amount: t.amount }, { category: 'uncategorized', amount: 0 }]); } }, __('bgSplit', 'Split'))),
            splitFor === t.id ? e('div', { style: { padding: '0.4rem 0 0.2rem 1rem' } },
              parts.map(function (p, i) {
                return e('div', { key: i, style: { display: 'flex', gap: '0.4rem', marginBottom: '0.3rem' } },
                  e('select', { value: p.category, style: input, onChange: function (ev) { var n = parts.slice(); n[i] = Object.assign({}, p, { category: ev.target.value }); setParts(n); } }, catOptions()),
                  e('input', { value: p.amount, inputMode: 'decimal', style: Object.assign({}, input, { width: '90px' }), onChange: function (ev) { var n = parts.slice(); n[i] = Object.assign({}, p, { amount: String(ev.target.value).replace(',', '.') }); setParts(n); } }));
              }),
              e('div', { style: { display: 'flex', gap: '0.4rem' } },
                e('button', { style: btn, onClick: function () { setParts(parts.concat([{ category: 'uncategorized', amount: 0 }])); } }, __('bgSplitAdd', 'Add part')),
                e('button', { style: btn, onClick: function () {
                  try { commit(setSplits(st, t.id, parts.filter(function (p) { return Math.abs(num(p.amount)) > 0; }))); setSplitFor(null); }
                  catch (err) { toast(__('bgSplitSum', 'The parts must add up to {v}.', { v: money(t.amount) }), 'error'); }
                } }, __('bgSplitSave', 'Save split')),
                t.splits ? e('button', { style: btn, onClick: function () { commit(setSplits(st, t.id, [])); setSplitFor(null); } }, __('bgSplitRemove', 'Remove split')) : null,
                e('button', { style: btn, onClick: function () { setSplitFor(null); } }, __('bgCancel', 'Cancel')))) : null);
        })) : null,
      rec.length ? e('div', { 'data-testid': 'bg-recurring', style: card }, h3(__('bgRecurring', 'Recurring payments')),
        e('div', { style: { color: dim, fontSize: 'var(--text-xs)', marginBottom: '0.4rem' } }, __('bgRecurringTotal', 'About {v} a month', { v: money(recurringMonthly(rec)) })),
        rec.map(function (x) {
          return e('div', { key: x.key, style: { display: 'flex', justifyContent: 'space-between', gap: '0.5rem', borderTop: '1px solid ' + border, padding: '0.3rem 0', fontSize: 'var(--text-sm)', flexWrap: 'wrap' } },
            e('span', { style: { color: text } }, x.name),
            e('span', { style: { color: dim } }, (x.cadence === 'monthly' ? __('bgMonthly', 'monthly') : x.cadence === 'quarterly' ? __('bgQuarterly', 'quarterly') : __('bgYearly', 'yearly')) + ' · ' + money(x.amount) + ' · ' + __('bgNext', 'next {d}', { d: window.MaerminI18n.date(x.next) })));
        })) : null,
      e('div', { style: card }, h3(__('bgRules', 'Rules')),
        e('div', { style: { color: dim, fontSize: 'var(--text-xs)', marginBottom: '0.4rem' } }, __('bgRulesHint', 'A booking whose payee or purpose contains the text gets the category. Your rules come before the built-in ones; a category you pick by hand wins over both.')),
        st.rules.map(function (r) {
          return e('div', { key: r.id, style: { display: 'flex', justifyContent: 'space-between', gap: '0.5rem', borderTop: '1px solid ' + border, padding: '0.3rem 0', fontSize: 'var(--text-sm)' } },
            e('span', { style: { color: text } }, '"' + r.contains + '" → ' + catName(catById(st, r.category))),
            e('button', { style: btn, onClick: function () { commit(removeRule(st, r.id)); } }, __('bgRemove', 'Remove')));
        }),
        e('div', { style: { display: 'flex', gap: '0.4rem', marginTop: '0.5rem', flexWrap: 'wrap' } },
          e('input', { 'data-testid': 'bg-rule-text', value: newRule.contains, placeholder: __('bgRuleText', 'Text, e.g. Bäckerei'), style: Object.assign({}, input, { flex: '1 1 140px' }), onChange: function (ev) { setNewRule(Object.assign({}, newRule, { contains: ev.target.value })); } }),
          e('select', { value: newRule.category, style: input, onChange: function (ev) { setNewRule(Object.assign({}, newRule, { category: ev.target.value })); } }, catOptions()),
          e('button', { style: btn, onClick: function () { if (!newRule.contains.trim()) return; commit(addRule(st, { contains: newRule.contains.trim(), category: newRule.category })); setNewRule({ contains: '', category: newRule.category }); } }, __('bgAddRule', 'Add rule'))),
        e('div', { style: { display: 'flex', gap: '0.4rem', marginTop: '0.5rem', flexWrap: 'wrap' } },
          e('input', { value: catName2, placeholder: __('bgNewCategory', 'New category'), style: Object.assign({}, input, { flex: '1 1 140px' }), onChange: function (ev) { setCatName2(ev.target.value); } }),
          e('button', { style: btn, onClick: function () { if (!catName2.trim()) return; commit(addCategory(st, catName2.trim(), 'expense')); setCatName2(''); } }, __('bgAddCategory', 'Add category')))));
  }

  // From a bank sync result: add the account's rows to the budget.
  function addBankRows(account, rows, source) {
    var r = ingest(load(), fromBankRows(account, rows), { source: source || 'fints' });
    save(r.state);
    return r.added;
  }

  var api = { KEY: KEY, normalize: normalize, load: load, save: save, parseCsv: parseCsv, fromBankRows: fromBankRows, ingest: ingest, categoryOf: categoryOf,
    setCategory: setCategory, setSplits: setSplits, addRule: addRule, removeRule: removeRule, setBudget: setBudget, addCategory: addCategory,
    monthSummary: monthSummary, sankey: sankey, recurring: recurring, recurringMonthly: recurringMonthly, payeeKey: payeeKey, addBankRows: addBankRows, View: View };
  if (typeof window !== 'undefined') window.MaerminBudget = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
