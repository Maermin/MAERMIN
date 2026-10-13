// ============================================================================
// MAERMIN — FinTS 3.0 client, PIN/TAN  (window.MaerminFints)
// ----------------------------------------------------------------------------
// P5-3.4. The browser builds every FinTS message itself; the user's own Worker
// only relays the base64 text to the bank's FinTS URL (`action=fints`, bank
// host allowlist in cf-worker/fints-banks.js). PIN and TAN are held in memory
// for one sync and never stored; nothing here touches storage.
//
//   - syntax: segments ', data elements +, groups :, escape ?, binary @len@
//   - messages: HNHBK / HNVSK / HNVSD (PIN/TAN "dummy" envelope) / HNSHK ...
//     HNSHA (PIN, TAN) / HNHBS
//   - dialogs: first contact (HKSYN: system id, TAN methods), then a dialog
//     with strong customer authentication (HKTAN process 4; TAN entry =
//     process 2, decoupled app confirmation = polling with process S)
//   - business: SEPA accounts (HKSPA), balances (HKSAL), transactions (HKKAZ,
//     MT940, touchdown paging), depot statement (HKWPD, MT535)
//
// Pure and Node-tested against a synthetic bank (test/fints.test.js,
// test/fints-bank-sim.js); real banks need the owner's FinTS product id
// (Worker variable FINTS_PRODUCT_ID). The transport is injected.
// ============================================================================
(function () {
  'use strict';

  // ---- syntax ---------------------------------------------------------------
  function esc(v) { return String(v == null ? '' : v).replace(/([?@':+])/g, '?$1'); }
  function bin(s) { s = String(s); return '@' + s.length + '@' + s; }
  // Parse a message into segments: [[DE, DE, ...], ...], each DE an array of
  // group elements (strings). Binary data stays raw.
  function parse(text) {
    var s = String(text || ''), segs = [], seg = [], de = [], cur = '', i = 0, n = s.length;
    while (i < n) {
      var c = s[i];
      if (c === '?' && i + 1 < n) { cur += s[i + 1]; i += 2; continue; }
      if (c === '@' && cur === '') {
        var j = s.indexOf('@', i + 1), len = parseInt(s.slice(i + 1, j), 10);
        if (j > i && isFinite(len) && len >= 0) { cur = s.substr(j + 1, len); i = j + 1 + len; continue; }
      }
      if (c === ':') { de.push(cur); cur = ''; i++; continue; }
      if (c === '+') { de.push(cur); seg.push(de); de = []; cur = ''; i++; continue; }
      if (c === "'") { de.push(cur); seg.push(de); segs.push(seg); seg = []; de = []; cur = ''; i++; continue; }
      cur += c; i++;
    }
    if (cur || de.length || seg.length) { de.push(cur); seg.push(de); segs.push(seg); }
    return segs.map(function (sg) { return { type: sg[0][0], no: sg[0][1], version: sg[0][2], ref: sg[0][3] || null, des: sg.slice(1) }; });
  }
  // The segments inside the HNVSD envelope replace it.
  function unwrap(segs) {
    var out = [];
    segs.forEach(function (sg) {
      if (sg.type === 'HNVSD' && sg.des[0]) out = out.concat(parse(sg.des[0][0]));
      else out.push(sg);
    });
    return out;
  }

  // ---- messages -------------------------------------------------------------
  function pad(n, w) { n = String(n); while (n.length < w) n = '0' + n; return n; }
  function stamp(d) {
    d = d || new Date();
    return { date: d.getFullYear() + pad(d.getMonth() + 1, 2) + pad(d.getDate(), 2), time: pad(d.getHours(), 2) + pad(d.getMinutes(), 2) + pad(d.getSeconds(), 2) };
  }
  // o = { blz, user, pin, tan?, systemId, dialogId, msgNo, secFunc, segments:
  //       ['HKIDN:{n}:2+...'] with {n} as the segment number, now?, ctrlRef? }
  function buildMessage(o) {
    var ts = stamp(o.now), sys = esc(o.systemId || '0'), blz = esc(o.blz), user = esc(o.user);
    var secFunc = String(o.secFunc || '999');
    var profile = secFunc === '999' ? 'PIN:1' : 'PIN:2';
    var ref = String(o.ctrlRef || Math.floor(1000000 + Math.random() * 8999999));
    var n = 2, body = [];
    body.push('HNSHK:2:4+' + profile + '+' + secFunc + '+' + ref + '+1+1+1::' + sys + '+1+1:' + ts.date + ':' + ts.time + '+1:999:1+6:10:16+280:' + blz + ':' + user + ':S:0:0');
    (o.segments || []).forEach(function (sg) { n++; body.push(sg.replace('{n}', n)); });
    n++;
    body.push('HNSHA:' + n + ':2+' + ref + '++' + esc(o.pin) + (o.tan ? ':' + esc(o.tan) : ''));
    var inner = body.join("'") + "'";
    var env = 'HNVSK:998:3+' + profile + '+998+1+1::' + sys + '+1:' + ts.date + ':' + ts.time + '+2:2:13:@8@00000000:5:1+280:' + blz + ':' + user + ":V:0:0+0'" +
      'HNVSD:999:1+' + bin(inner) + "'";
    var tail = 'HNHBS:' + (n + 1) + ':1+' + o.msgNo + "'";
    var headFor = function (size) { return 'HNHBK:1:3+' + pad(size, 12) + '+300+' + esc(o.dialogId || '0') + '+' + o.msgNo + "'"; };
    var rest = env + tail;
    var size = headFor(0).length + rest.length;
    return headFor(size) + rest;
  }

  // ---- segments -------------------------------------------------------------
  var SEG = {
    HKIDN: function (c) { return 'HKIDN:{n}:2+280:' + esc(c.blz) + '+' + esc(c.user) + '+' + esc(c.systemId || '0') + '+1'; },
    HKVVB: function (c) { return 'HKVVB:{n}:3+0+0+0+' + esc(c.productId) + '+' + esc(c.productVersion || '1'); },
    HKSYN: function () { return 'HKSYN:{n}:3+0'; },
    HKTAN4: function (ref, medium) { return 'HKTAN:{n}:6+4+' + ref + (medium ? '+++++++++' + esc(medium) : ''); },
    HKTAN2: function (taskRef) { return 'HKTAN:{n}:6+2++++' + esc(taskRef) + '+N'; },
    HKTANS: function (taskRef) { return 'HKTAN:{n}:7+S++++' + esc(taskRef) + '+N'; },
    HKSPA: function () { return 'HKSPA:{n}:1'; },
    HKSAL: function (a) { return 'HKSAL:{n}:7+' + esc(a.iban) + ':' + esc(a.bic || '') + '+N'; },
    HKKAZ: function (a, from, to, touch) { return 'HKKAZ:{n}:7+' + esc(a.iban) + ':' + esc(a.bic || '') + '+N+' + from + '+' + to + (touch ? '++' + esc(touch) : ''); },
    HKWPD: function (a, touch) { return 'HKWPD:{n}:6+' + esc(a.accountNo) + '::280:' + esc(a.blz) + '+' + esc(a.currency || 'EUR') + (touch ? '+++' + esc(touch) : ''); },
    HKEND: function (dialogId) { return 'HKEND:{n}:1+' + esc(dialogId); }
  };

  // ---- responses ------------------------------------------------------------
  function returnsOf(segs) {
    var out = [];
    segs.forEach(function (sg) {
      if (sg.type !== 'HIRMG' && sg.type !== 'HIRMS') return;
      sg.des.forEach(function (de) { out.push({ code: de[0], ref: sg.ref, text: de[2] || '', params: de.slice(3), global: sg.type === 'HIRMG' }); });
    });
    return out;
  }
  function first(segs, type) { for (var i = 0; i < segs.length; i++) if (segs[i].type === type) return segs[i]; return null; }
  function all(segs, type) { return segs.filter(function (s) { return s.type === type; }); }
  // TAN methods: the security functions the bank allows (3920) with their
  // names from HITANS ("<code>:<1|2>:<tech id>:<zka id>:<zka version>:<name>").
  function tanMethods(segs) {
    var allowed = [];
    returnsOf(segs).forEach(function (r) { if (r.code === '3920') allowed = allowed.concat(r.params.filter(Boolean)); });
    var names = {};
    all(segs, 'HITANS').forEach(function (sg) {
      var flat = [];
      sg.des.forEach(function (de) { flat = flat.concat(de); });
      for (var i = 0; i + 5 < flat.length; i++) {
        if (/^9\d\d$/.test(flat[i]) && (flat[i + 1] === '1' || flat[i + 1] === '2') && !names[flat[i]]) names[flat[i]] = flat[i + 5];
      }
    });
    return allowed.filter(function (c) { return c !== '999'; }).map(function (c) { return { secFunc: c, name: names[c] || c }; });
  }
  // HIPINS: which business segments need a TAN ("HKSAL:N:HKKAZ:J:...").
  function tanRequired(segs) {
    var out = {}, sg = first(segs, 'HIPINS');
    if (!sg) return out;
    var flat = [];
    sg.des.forEach(function (de) { flat = flat.concat(de); });
    for (var i = 0; i + 1 < flat.length; i++) if (/^HK[A-Z]{3}$/.test(flat[i]) && (flat[i + 1] === 'J' || flat[i + 1] === 'N')) out[flat[i]] = flat[i + 1] === 'J';
    return out;
  }
  // Accounts from HIUPD (UPD) and HISPA (SEPA): number, IBAN, BIC, type, name.
  function accountsOf(segs, blz) {
    var byNo = {};
    all(segs, 'HIUPD').forEach(function (sg) {
      var ktv = sg.des[0] || [], type = parseInt((sg.des[3] || [])[0], 10);
      var acc = { accountNo: ktv[0] || '', blz: ktv[3] || blz || '', iban: (sg.des[1] || [])[0] || '', type: isFinite(type) ? type : null,
        currency: (sg.des[4] || [])[0] || 'EUR', owner: (sg.des[5] || [])[0] || '', product: (sg.des[7] || [])[0] || '', bic: '' };
      acc.allowed = sg.des.slice(9).map(function (de) { return de[0]; }).filter(function (x) { return /^HK[A-Z]{3}$/.test(x); });
      if (acc.accountNo) byNo[acc.accountNo] = acc;
    });
    all(segs, 'HISPA').forEach(function (sg) {
      sg.des.forEach(function (de) {
        var no = de[3] || '';
        var a = byNo[no] || (byNo[no] = { accountNo: no, blz: de[6] || blz || '', type: null, currency: 'EUR', owner: '', product: '', allowed: [] });
        a.iban = de[1] || a.iban; a.bic = de[2] || a.bic;
      });
    });
    return Object.keys(byNo).map(function (k) {
      var a = byNo[k];
      a.depot = (a.type >= 30 && a.type <= 39) || a.allowed.indexOf('HKWPD') > -1;
      return a;
    });
  }
  function num(s) { var v = parseFloat(String(s || '').replace(/\./g, '').replace(',', '.')); return isFinite(v) ? v : NaN; }
  function isoOf(yyyymmdd) { var s = String(yyyymmdd || ''); return /^\d{8}$/.test(s) ? s.slice(0, 4) + '-' + s.slice(4, 6) + '-' + s.slice(6, 8) : null; }
  // HISAL: the booked balance "C:1234,56:EUR:20250101"
  function balanceOf(segs) {
    var sg = first(segs, 'HISAL');
    if (!sg) return null;
    var b = sg.des[3] || [];
    var v = num(b[1]);
    if (!isFinite(v)) return null;
    return { amount: b[0] === 'D' ? -v : v, currency: b[2] || 'EUR', date: isoOf(b[3]) };
  }
  // HITAN: process, task reference, challenge
  function hitanOf(segs) {
    var sg = first(segs, 'HITAN');
    if (!sg) return null;
    return { process: (sg.des[0] || [])[0], taskRef: (sg.des[2] || [])[0] || '', challenge: (sg.des[3] || [])[0] || '' };
  }
  function touchdownOf(rets, ref) {
    for (var i = 0; i < rets.length; i++) if (rets[i].code === '3040' && (!ref || rets[i].ref === ref || !rets[i].ref)) return rets[i].params[0] || null;
    return null;
  }
  function errorsOf(rets) { return rets.filter(function (r) { return /^9/.test(r.code); }); }

  // ---- MT940 / MT535 --------------------------------------------------------
  function swiftFields(text) {
    var out = [], cur = null;
    String(text || '').split(/\r?\n/).forEach(function (line) {
      var m = line.match(/^:(\d{2}[A-Z]?):(.*)$/);
      if (m) { cur = { tag: m[1], value: m[2] }; out.push(cur); }
      else if (cur && line !== '-' && line.trim() !== '') cur.value += '\n' + line;
    });
    return out;
  }
  function yymmdd(s) { return s && s.length === 6 ? '20' + s.slice(0, 2) + '-' + s.slice(2, 4) + '-' + s.slice(4, 6) : null; }
  // MT940 → [{ date, valueDate, amount (signed), currency, gvc, bookingText, purpose, name }]
  function mt940(text) {
    var rows = [], currency = 'EUR', last = null;
    swiftFields(text).forEach(function (f) {
      if (f.tag === '60F' || f.tag === '60M') { var cm = f.value.match(/^[CD]\d{6}([A-Z]{3})/); if (cm) currency = cm[1]; }
      if (f.tag === '61') {
        var m = f.value.match(/^(\d{6})(\d{4})?(R?[CD])[A-Z]?([\d,]+)N/);
        if (!m) { last = null; return; }
        var amt = num(m[4]);
        var debit = m[3] === 'D' || m[3] === 'RC';
        var valueDate = yymmdd(m[1]);
        var date = valueDate;
        if (m[2]) {
          // the booking date has no year: across the year turn it is the next
          // (valued 31.12., booked 02.01.) or the previous year
          var y = +valueDate.slice(0, 4), bm = m[2].slice(0, 2), vm = valueDate.slice(5, 7);
          if (bm === '01' && vm === '12') y++; else if (bm === '12' && vm === '01') y--;
          date = y + '-' + bm + '-' + m[2].slice(2, 4);
        }
        last = { date: date, valueDate: valueDate, amount: debit ? -amt : amt, currency: currency, gvc: '', bookingText: '', purpose: '', name: '' };
        rows.push(last);
      } else if (f.tag === '86' && last) {
        var v = f.value.replace(/\n/g, '');
        last.gvc = v.slice(0, 3);
        var parts = v.slice(3).split('?').slice(1), purpose = [], name = [];
        parts.forEach(function (p) {
          var k = p.slice(0, 2), val = p.slice(2);
          if (k === '00') last.bookingText = val;
          else if (/^2\d$|^6[0-3]$/.test(k)) purpose.push(val);
          else if (k === '32' || k === '33') name.push(val);
        });
        last.purpose = purpose.join('').trim(); last.name = name.join('').trim();
      }
    });
    return rows;
  }
  // MT535 → { date, positions: [{ isin, name, quantity, price, priceCurrency, priceDate, value, valueCurrency }] }
  function mt535(text) {
    var out = { date: null, positions: [] }, pos = null;
    swiftFields(text).forEach(function (f) {
      var v = f.value;
      if (f.tag === '16R' && v === 'FIN') { pos = { isin: '', name: '', quantity: NaN, price: NaN, priceCurrency: '', priceDate: null, value: NaN, valueCurrency: '' }; return; }
      if (f.tag === '16S' && v === 'FIN') { if (pos && pos.isin) out.positions.push(pos); pos = null; return; }
      if (f.tag === '98A' && /^:PREP\/\/|^:STAT\/\//.test(v) && !pos) { out.date = isoOf(v.split('//')[1]); return; }
      if (!pos) return;
      if (f.tag === '35B') {
        var m = v.match(/^ISIN ([A-Z]{2}[A-Z0-9]{9}\d)(?:\/[A-Z]{2}\/[A-Z0-9]{6})?\s*([\s\S]*)$/);
        if (m) { pos.isin = m[1]; pos.name = m[2].replace(/\s*\n\s*/g, ' ').trim(); }
      } else if (f.tag === '93B') {
        var q = v.match(/\/\/(?:UNIT|FAMT)\/(N?)([\d,]+)/);
        if (q) pos.quantity = (q[1] ? -1 : 1) * num(q[2]);
      } else if (f.tag === '90B' || f.tag === '90A') {
        var p = v.match(/\/\/(?:ACTU|PRCT)\/([A-Z]{3})?([\d,]+)/);
        if (p) { pos.price = num(p[2]); pos.priceCurrency = p[1] || ''; }
      } else if (f.tag === '98A' && /^:PRIC\/\//.test(v)) pos.priceDate = isoOf(v.split('//')[1]);
      else if (f.tag === '19A' && /^:HOLD\/\//.test(v)) {
        var h = v.match(/\/\/(N?)([A-Z]{3})([\d,]+)/);
        if (h) { pos.valueCurrency = h[2]; pos.value = (h[1] ? -1 : 1) * num(h[3]); }
      }
    });
    return out;
  }

  // ---- dialogs --------------------------------------------------------------
  // cfg = { blz, user, pin, systemId?, secFunc?, productId, productVersion?, tanMedium? }
  // transport(messageText) → Promise<responseText>
  // hooks = { chooseMethod(methods) → Promise<secFunc>, tan({ challenge }) →
  //           Promise<tan|null>, waiting({ challenge, poll }) (decoupled), sleep(ms) }
  function FintsError(message, code) { var e = new Error(message); e.code = code || null; e.fints = true; return e; }

  function Dialog(cfg, transport) {
    this.cfg = cfg; this.transport = transport; this.dialogId = '0'; this.msgNo = 0; this.secFunc = cfg.secFunc || '999';
  }
  Dialog.prototype.send = function (segments, tan) {
    var self = this;
    self.msgNo++;
    var msg = buildMessage({ blz: self.cfg.blz, user: self.cfg.user, pin: self.cfg.pin, tan: tan, systemId: self.cfg.systemId, dialogId: self.dialogId,
      msgNo: self.msgNo, secFunc: self.secFunc, segments: segments, now: self.cfg.now && self.cfg.now() });
    return Promise.resolve(self.transport(msg)).then(function (text) {
      var segs = unwrap(parse(text));
      var head = first(segs, 'HNHBK');
      if (head && head.des[2] && head.des[2][0] && head.des[2][0] !== '0') self.dialogId = head.des[2][0];
      var rets = returnsOf(segs);
      var errs = errorsOf(rets);
      if (errs.length) throw FintsError(errs.map(function (r) { return r.code + ' ' + r.text; }).join('; '), errs[0].code);
      return { segs: segs, rets: rets };
    });
  };
  // A response that asks for strong authentication: enter a TAN, or wait for
  // the app (decoupled: poll with HKTAN process S until it is no longer 3956).
  Dialog.prototype.authorize = function (resp, hooks) {
    var self = this, codes = resp.rets.map(function (r) { return r.code; });
    if (codes.indexOf('0030') < 0 && codes.indexOf('3955') < 0) return Promise.resolve(resp);
    var hitan = hitanOf(resp.segs) || { taskRef: '', challenge: '' };
    var decoupled = codes.indexOf('3955') > -1;
    if (decoupled) {
      var polls = 0;
      var poll = function () {
        polls++;
        if (polls > 60) return Promise.reject(FintsError('confirmation in the banking app timed out', 'timeout'));
        if (hooks.waiting) hooks.waiting({ challenge: hitan.challenge, poll: polls });
        return Promise.resolve(hooks.sleep ? hooks.sleep(polls === 1 ? 1000 : 2000) : null)
          .then(function () { if (hooks.cancelled && hooks.cancelled()) throw FintsError('cancelled', 'cancelled'); return self.send([SEG.HKTANS(hitan.taskRef)]); })
          .then(function (r) { return r.rets.some(function (x) { return x.code === '3956'; }) ? poll() : r; });
      };
      return poll();
    }
    return Promise.resolve(hooks.tan ? hooks.tan({ challenge: hitan.challenge }) : null).then(function (tan) {
      if (!tan) throw FintsError('no TAN entered', 'cancelled');
      return self.send([SEG.HKTAN2(hitan.taskRef)], tan);
    });
  };
  Dialog.prototype.end = function () {
    var self = this;
    if (!self.dialogId || self.dialogId === '0') return Promise.resolve();
    return self.send([SEG.HKEND(self.dialogId)]).then(function () {}, function () {});
  };

  // First contact: a new system id and the TAN methods the bank offers.
  function synchronize(cfg, transport) {
    var d = new Dialog(Object.assign({}, cfg, { systemId: '0' }), transport);
    d.secFunc = '999';
    return d.send([SEG.HKIDN(Object.assign({}, cfg, { systemId: '0' })), SEG.HKVVB(cfg), SEG.HKSYN()]).then(function (r) {
      var syn = first(r.segs, 'HISYN');
      var out = { systemId: syn && syn.des[0] ? syn.des[0][0] : '', methods: tanMethods(r.segs), accounts: accountsOf(r.segs, cfg.blz), bankName: (first(r.segs, 'HIBPA') || { des: [] }).des[2] ? first(r.segs, 'HIBPA').des[2][0] : '' };
      return d.end().then(function () { if (!out.systemId) throw FintsError('the bank sent no system id', 'nosystem'); return out; });
    });
  }

  // One authenticated dialog: open (HKIDN + HKVVB + HKTAN 4), then fetch
  // accounts, balances, transactions since `from` and depot statements.
  function fetchAll(cfg, transport, hooks, opts) {
    opts = opts || {};
    var d = new Dialog(cfg, transport);
    d.secFunc = cfg.secFunc;
    var need = {}, accounts = [], out = { accounts: [], warnings: [] };
    var withTan = function (seg, code) { return need[code] ? [seg, SEG.HKTAN4(code, cfg.tanMedium)] : [seg]; };
    var paged = function (build, code, collect) {
      var loop = function (touch, guard) {
        return d.send(withTan(build(touch), code)).then(function (r) { return d.authorize(r, hooks); }).then(function (r) {
          collect(r.segs);
          var next = touchdownOf(r.rets, null);
          return next && guard < 20 ? loop(next, guard + 1) : null;
        });
      };
      return loop(null, 0);
    };
    // The bank parameters (HIPINS) and accounts (HIUPD) come with the answer to
    // the opening message, before or after the strong authentication.
    var opened = [];
    return d.send([SEG.HKIDN(cfg), SEG.HKVVB(cfg), SEG.HKTAN4('HKIDN', cfg.tanMedium)]).then(function (r) { opened = r.segs; return d.authorize(r, hooks); }).then(function (r) {
      var segs = opened.concat(r.segs === opened ? [] : r.segs);
      need = tanRequired(segs);
      accounts = accountsOf(segs, cfg.blz);
      return d.send([SEG.HKSPA()]).then(function (sp) {
        var sepa = accountsOf(sp.segs.concat(all(segs, 'HIUPD')), cfg.blz);
        if (sepa.length) accounts = sepa;
      }, function () { /* no SEPA list: the UPD accounts stay */ });
    }).then(function () {
      return accounts.reduce(function (p, a) {
        return p.then(function () {
          var acc = { accountNo: a.accountNo, iban: a.iban || '', bic: a.bic || '', currency: a.currency, owner: a.owner, product: a.product, depot: a.depot, balance: null, transactions: [], positions: null, positionsDate: null };
          out.accounts.push(acc);
          if (a.depot) {
            var mt = '';
            return paged(function (touch) { return SEG.HKWPD(Object.assign({ blz: cfg.blz }, a), touch); }, 'HKWPD', function (segs) {
              all(segs, 'HIWPD').forEach(function (sg) { mt += (sg.des[0] || [])[0] || ''; });
            }).then(function () { var st = mt535(mt); acc.positions = st.positions; acc.positionsDate = st.date; },
              function (e) { out.warnings.push(acc.accountNo + ': ' + e.message); });
          }
          if (!a.iban) return null;
          return d.send(withTan(SEG.HKSAL(a), 'HKSAL')).then(function (r) { return d.authorize(r, hooks); }).then(function (r) { acc.balance = balanceOf(r.segs); },
            function (e) { out.warnings.push(acc.accountNo + ': ' + e.message); })
            .then(function () {
              if (!opts.from) return null;
              var text = '';
              return paged(function (touch) { return SEG.HKKAZ(a, opts.from.replace(/-/g, ''), (opts.to || '').replace(/-/g, ''), touch); }, 'HKKAZ', function (segs) {
                all(segs, 'HIKAZ').forEach(function (sg) { text += (sg.des[0] || [])[0] || ''; });
              }).then(function () { acc.transactions = mt940(text); }, function (e) { out.warnings.push(acc.accountNo + ': ' + e.message); });
            });
        });
      }, Promise.resolve());
    }).then(function () { return d.end(); }, function (e) { return d.end().then(function () { throw e; }); }).then(function () { return out; });
  }

  // ---- transport through the user's Worker ---------------------------------
  function toB64(s) {
    s = String(s).replace(/[^\x00-\xff]/g, '?');
    if (typeof btoa === 'function') return btoa(s);
    return Buffer.from(s, 'latin1').toString('base64');
  }
  function fromB64(b) {
    if (typeof atob === 'function') return atob(String(b || ''));
    return Buffer.from(String(b || ''), 'base64').toString('latin1');
  }
  function workerTransport(workerUrl, bankUrl, fetchImpl) {
    var base = String(workerUrl || '').replace(/\/+$/, '');
    return function (msg) {
      return (fetchImpl || fetch)(base + '/?action=fints', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: bankUrl, msg: toB64(msg) }) })
        .then(function (r) { return r.json().catch(function () { return null; }).then(function (j) { return { status: r.status, body: j }; }); })
        .then(function (x) {
          if (!x.body || x.body.error) throw FintsError((x.body && x.body.error) || ('Worker answered ' + x.status), 'relay');
          if (x.body.status >= 400 || !x.body.msg) throw FintsError('the bank answered ' + x.body.status, 'bank');
          return fromB64(x.body.msg);
        });
    };
  }

  var api = {
    esc: esc, bin: bin, parse: parse, unwrap: unwrap, buildMessage: buildMessage, SEG: SEG,
    returnsOf: returnsOf, tanMethods: tanMethods, tanRequired: tanRequired, accountsOf: accountsOf, balanceOf: balanceOf, hitanOf: hitanOf,
    mt940: mt940, mt535: mt535, synchronize: synchronize, fetchAll: fetchAll, Dialog: Dialog,
    toB64: toB64, fromB64: fromB64, workerTransport: workerTransport
  };
  if (typeof window !== 'undefined') window.MaerminFints = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
