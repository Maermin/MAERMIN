// ============================================================================
// MAERMIN — Broker statement PDF import  (window.MaerminPdfImport)
// ----------------------------------------------------------------------------
// Parse broker settlement PDFs (Wertpapierabrechnungen) fully CLIENT-SIDE and
// feed the result into the EXISTING import pipeline — the PDF never leaves the
// device. Layouts: Trade Republic, Scalable Capital, ING, DKB, Comdirect, and
// (P5-3.2) flatex, Consorsbank, DEGIRO, onvista bank - buys, sells, dividends,
// taxes withheld (dividend withholding / a tax row next to a sale), tax and fee
// documents (cash rows), several settlements per PDF, and DEGIRO's
// Transaktionsübersicht and Kontoauszug tables (one entry per row).
//
// Architecture (no second import engine):
//   1. pdf.js (CDN, version-pinned + SRI on BOTH files, lazy-loaded on first
//      use) extracts the text. The worker file is loaded as a plain script so
//      pdf.js uses its main-thread fallback — no CSP worker-src change, and
//      both files stay integrity-pinned.
//   2. The PURE layer (Node-tested against frozen text fixtures) detects the
//      broker and pattern-matches the settlement into candidate transactions.
//      German layouts share most of their vocabulary, so one generic core
//      runs per-broker configs instead of five hand-rolled parsers.
//   3. candidatesToCSV() serialises the candidates, and the EXISTING
//      MaerminImportMapping preview/commit flow takes over — editable mapping,
//      row errors, duplicate detection, confirmation. Number/date parsing is
//      reused from that module (single source of truth for locale handling).
//
// Parsers are best-effort by nature (layouts shift); the editable preview is
// the safety net, and every missing field is reported, never guessed silently.
// ============================================================================
(function () {
  'use strict';
// Translation lookup (i18n.js): __('key', 'English fallback', { slot: value }).
function __(k, f, v) { return (typeof window !== 'undefined' && window.MaerminI18n ? window.MaerminI18n : require('./i18n.js')).t(k, f, v); }

  // Reuse the import-mapping primitives (locale numbers/dates). In the browser
  // the script loads after import-mapping.js; under Node the tests require it.
  function mapping() {
    if (typeof window !== 'undefined' && window.MaerminImportMapping) return window.MaerminImportMapping;
    if (typeof require === 'function') { try { return require('./import-mapping.js'); } catch (e) { /* fall through */ } }
    return null;
  }

  // ---- pdf.js (pinned + SRI, lazy) ------------------------------------------
  // pdf.js ships as ES modules. The library is loaded as a module <script> with
  // SRI and exposes `globalThis.pdfjsLib`. The parser runs in a real Web Worker
  // (SEC-021): the worker file is fetched with the same SRI check, turned into a
  // same-origin blob: URL and handed to pdf.js as a port, so a parser bug runs
  // off the page that holds the unlocked data. CSP: the pinned folder is in
  // script-src and connect-src, and worker-src allows blob:.
  // index.html opened from disk (file://, origin "null") cannot start a module
  // worker from a blob: URL; there the worker file is loaded as a module
  // <script> (same SRI) and pdf.js runs it on the main thread, as before.
  var PDFJS_DIR = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/';
  var PDFJS_LIB = { src: PDFJS_DIR + 'pdf.min.mjs',
    integrity: 'sha384-+0ti2moQlmLN7WZHE2RHIf5lV8hHxhxEalN0il3YZceG26fUPyOkR0hp9daxk1i7' };
  var PDFJS_WORKER = { src: PDFJS_DIR + 'pdf.worker.min.mjs',
    integrity: 'sha384-ToeVvShCxKc6CEvhHeMt0Q8A06pSPDbAlngO9nokrDmh914gk/pYd0N7D0a4Lz2o' };
  var _pdfjsPromise = null;

  function loadModuleScript(lib) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.type = 'module';
      s.src = lib.src;
      s.integrity = lib.integrity;
      s.crossOrigin = 'anonymous';
      s.onload = resolve;
      s.onerror = function () { reject(new Error('Failed to load ' + lib.src)); };
      document.head.appendChild(s);
    });
  }

  function loadWorkerUrl(lib) {
    return fetch(lib.src, { integrity: lib.integrity, mode: 'cors', credentials: 'omit' }).then(function (res) {
      if (!res.ok) throw new Error('Failed to load ' + lib.src);
      return res.blob();
    }).then(function (blob) {
      return URL.createObjectURL(new Blob([blob], { type: 'text/javascript' }));
    });
  }

  // Resolves to { lib, workerUrl } (workerUrl null: main-thread fallback).
  function ensurePdfJs() {
    if (typeof window === 'undefined') return Promise.reject(new Error('browser only'));
    if (_pdfjsPromise) return _pdfjsPromise;
    var inPage = !window.location || window.location.protocol === 'file:' || window.location.origin === 'null';
    _pdfjsPromise = Promise.all([
      window.pdfjsLib ? Promise.resolve() : loadModuleScript(PDFJS_LIB),
      inPage ? (window.pdfjsWorker ? null : loadModuleScript(PDFJS_WORKER).then(function () { return null; })) : loadWorkerUrl(PDFJS_WORKER)
    ]).then(function (r) {
      if (!window.pdfjsLib) throw new Error('pdf.js did not initialise');
      return { lib: window.pdfjsLib, workerUrl: r[1] || null };
    }).catch(function (e) { _pdfjsPromise = null; throw e; });
    return _pdfjsPromise;
  }

  // Extract text from a PDF ArrayBuffer, reconstructing LINES from the glyph
  // positions (group items by their y coordinate, then sort by x) — the regex
  // layer below depends on values staying on one line as printed.
  function extractText(arrayBuffer) {
    var worker = null, pdfWorker = null;
    function cleanup() {
      try { if (pdfWorker) pdfWorker.destroy(); } catch (e) { /* already gone */ }
      if (worker) worker.terminate();
    }
    return ensurePdfJs().then(function (pdf) {
      var opts = { data: arrayBuffer, isEvalSupported: false, verbosity: 0 }; // verbosity 0: errors only
      if (!pdf.workerUrl) return pdf.lib.getDocument(opts).promise;
      worker = new Worker(pdf.workerUrl, { type: 'module', name: 'pdf.js' });
      opts.worker = pdfWorker = new pdf.lib.PDFWorker({ port: worker });
      // pdf.js waits forever for a port that never starts; fail instead.
      var failed = new Promise(function (resolve, reject) {
        worker.addEventListener('error', function () { reject(new Error('pdf.js worker could not start')); });
      });
      return Promise.race([pdf.lib.getDocument(opts).promise, failed]);
    }).then(function (doc) {
      var pages = [];
      var chain = Promise.resolve();
      for (var p = 1; p <= doc.numPages; p++) {
        (function (pageNo) {
          chain = chain.then(function () { return doc.getPage(pageNo); })
            .then(function (page) { return page.getTextContent(); })
            .then(function (content) {
              var rows = {};
              (content.items || []).forEach(function (item) {
                if (!item.str || !item.transform) return;
                var y = Math.round(item.transform[5]);
                (rows[y] || (rows[y] = [])).push({ x: item.transform[4], str: item.str });
              });
              var lines = Object.keys(rows).map(Number).sort(function (a, b) { return b - a; })
                .map(function (y) {
                  return rows[y].sort(function (a, b) { return a.x - b.x; })
                    .map(function (i) { return i.str; }).join(' ').replace(/\s+/g, ' ').trim();
                }).filter(Boolean);
              pages.push(lines.join('\n'));
            });
        })(p);
      }
      return chain.then(function () { return pages.join('\n\n'); });
    }).then(function (text) { cleanup(); return text; }, function (e) { cleanup(); throw e; });
  }

  // ---- pure layer: broker detection + statement parsing ----------------------
  var ISIN_RX = /\b([A-Z]{2}[A-Z0-9]{9}[0-9])\b/;

  // Shared German settlement vocabulary; per-broker configs only add their
  // detection strings and quirks. All matching is best-effort and reported.
  var PDF_BROKERS = [
    { id: 'traderepublic', name: 'Trade Republic', detect: ['trade republic'] },
    { id: 'scalable', name: 'Scalable Capital', detect: ['scalable capital'] },
    { id: 'ing', name: 'ING', detect: ['ing-diba', 'ing bank', 'wertpapierabrechnung'], weak: ['wertpapierabrechnung'] },
    { id: 'dkb', name: 'DKB', detect: ['deutsche kreditbank', 'dkb'] },
    { id: 'comdirect', name: 'Comdirect', detect: ['comdirect'] }
  ];
  // P5-3.2 (brand name: detection words; the first word is the id). flatex and
  // DEGIRO share the "flatexDEGIRO Bank AG" letterhead: it is ignored in the
  // detection and decided there (a DEGIRO table means DEGIRO).
  var BATCH_A = { 'flatex': ['flatex'], 'DEGIRO': ['degiro'], 'Consorsbank': ['consorsbank', 'consors'], 'onvista bank': ['onvista'] };
  Object.keys(BATCH_A).forEach(function (name) { PDF_BROKERS.push({ id: BATCH_A[name][0], name: name, detect: BATCH_A[name] }); });
  var DEGIRO_TABLE_RX = /transaktions(?:ü|ue)bersicht|kontoauszug/i;

  function detectBrokerFromText(text) {
    var full = String(text || '').toLowerCase();
    var t = full.replace(/flatexdegiro/g, ' ');
    if (full !== t && t.indexOf('flatex') < 0 && t.indexOf('degiro') < 0) t += DEGIRO_TABLE_RX.test(full) ? ' degiro' : ' flatex';
    var best = null;
    PDF_BROKERS.forEach(function (b) {
      var hits = b.detect.filter(function (d) { return t.indexOf(d) > -1; });
      if (!hits.length) return;
      // A broker matched only via a weak/generic marker loses to a named hit.
      var strong = hits.some(function (h) { return !(b.weak || []).includes(h); });
      var score = (strong ? 2 : 1) + hits.length;
      if (!best || score > best.score) best = { id: b.id, name: b.name, score: score };
    });
    return best ? { id: best.id, name: best.name } : null;
  }

  function num(IM, raw) {
    if (raw == null) return NaN;
    return IM ? IM.parseNumber(raw, 'de') : parseFloat(String(raw).replace(/\./g, '').replace(',', '.'));
  }

  function firstMatch(text, regexes) {
    for (var i = 0; i < regexes.length; i++) {
      var m = text.match(regexes[i]);
      if (m) return m;
    }
    return null;
  }

  // Parse ONE settlement text into a candidate transaction. Returns
  // { candidate|null, errors:[..] } — missing fields are reported, not guessed.
  // Statement text is capped (whole document and each line) before any
  // pattern runs, so a crafted file cannot stall the tab (SEC-022).
  var MAX_TEXT = 200000, MAX_LINE = 1000;
  function capText(text) {
    return String(text || '').slice(0, MAX_TEXT).split(/\r?\n/).map(function (l) { return l.length > MAX_LINE ? l.slice(0, MAX_LINE) : l; }).join('\n');
  }
  function parseStatement(text, brokerId) {
    var IM = mapping();
    var t = capText(text).replace(/ /g, ' ');
    var errors = [];

    // Type: dividends first (their documents also contain the word "Stück").
    var type = 'buy';
    if (/dividendengutschrift|ertragsgutschrift|aussch(ü|ue)ttung|dividende\b/i.test(t)) type = 'dividend';
    else if (/wertpapierabrechnung\s*:?\s*verkauf|\bverkauf\b/i.test(t)) type = 'sell';
    else if (/\bkauf\b|sparplanausf(ü|ue)hrung|sparplan|wertpapierkauf/i.test(t)) type = 'buy';
    else errors.push(__('piNoType', 'transaction type not recognised (assumed buy)'));

    // Security: ISIN is the canonical symbol (the mapping layer normalises it);
    // the human name is whatever precedes the ISIN on its line.
    var isinMatch = t.match(ISIN_RX);
    var symbol = isinMatch ? isinMatch[1] : '';
    if (!symbol) errors.push(__('piNoIsin', 'no ISIN found'));
    var symbolName = '';
    if (isinMatch) {
      var lines = t.split('\n');
      var idx = lines.findIndex(function (l) { return l.indexOf(symbol) > -1; });
      var line = idx > -1 ? lines[idx] : '';
      symbolName = line.split(symbol)[0]
        .replace(/st(ü|ue)ck\s+[\d.,]+/i, '').replace(/[\d.,]+\s*(stk\.?|st\.)/i, '')
        .replace(/isin\s*\(?wkn\)?\s*:?/i, '').replace(/isin\s*:?/i, '')
        .replace(/wertpapier-?bezeichnung\s*:?/i, '').replace(/[():]/g, '')
        .replace(/^nr\.?\s*\d+\s*/i, '').replace(/^bestand\s+[\d.,]+\s*st(?:ü|ue)ck\s*/i, '').trim();
      // Trade-Republic-style layouts print the security name on its OWN line
      // above the ISIN line — fall back to it when the prefix carried nothing.
      if (!symbolName && idx > 0) {
        var prev = lines[idx - 1].trim();
        if (prev && !/abrechnung|position\s+anzahl|market-order|gesamt|gutschrift/i.test(prev) && /[a-z]/i.test(prev)) {
          symbolName = prev;
        }
      }
    }

    // Quantity: "2 Stk.", "Stück 10", "St. 10".
    var qtyM = firstMatch(t, [
      /(?:^|[^A-Za-z0-9.,])([\d.,]{1,20})[ \t]*(?:stk\.?|st(?:ü|ue)ck)\b/im,
      /st(?:ü|ue)ck\s*:?\s+([\d.,]{1,20})/i,
      /\bst\.\s*([\d.,]{1,20})/i,
      /([\d.,]{1,20})\s+st\.\s/i,          // flatex "Ausgeführt : 12 St."
      /\bstk\.?\s+([\d.,]{1,20})/i          // onvista "STK 8,000"
    ]);
    var quantity = qtyM ? Math.abs(num(IM, qtyM[1])) : NaN;
    if (!(quantity > 0)) errors.push(__('piNoQty', 'quantity not found'));

    // Price per share + currency. Order matters: the explicit execution-price
    // labels first, the bare Trade-Republic layout ("2 Stk. 80,46 EUR") last.
    var priceM = firstMatch(t, [
      /ausf(?:ü|ue)hrungskurs\s*:?\s*([\d.,]{1,20})\s*(EUR|USD)/i,
      /zum kurs von\s*:?\s*([\d.,]{1,20})\s*(EUR|USD)/i,
      /\bkurs\b\s*:?\s*([\d.,]{1,20})\s*(EUR|USD)/i,
      /(?:stk\.?|st(?:ü|ue)ck)\s+([\d.,]{1,20})\s*(EUR|USD)/i,
      /dividende\s+je\s+st(?:ü|ue)ck\s*:?\s*([\d.,]{1,20})\s*(EUR|USD)/i,
      /(?:aussch(?:ü|ue)ttung|bruttobetrag)\s+je\s+anteil\s*:?\s*([\d.,]{1,20})\s*(EUR|USD)/i,
      /dividende\s+pro\s+st(?:ü|ue)ck\s*:?\s*([\d.,]{1,20})\s*(EUR|USD)/i
    ]);
    var price = priceM ? Math.abs(num(IM, priceM[1])) : NaN;
    var currency = priceM ? priceM[2].toUpperCase() : 'EUR';
    // onvista: "STK 8,000 EUR 230,15" - the currency before the price
    // (upper-case STK without a dot: Trade Republic's "2 Stk. 80,46 EUR 160,92 EUR" is price then total)
    var stkM = t.match(/\bSTK\s+[\d.,]{1,20}\s+(EUR|USD)\s+([\d.,]{1,20})/);
    if (stkM) { price = Math.abs(num(IM, stkM[2])); currency = stkM[1].toUpperCase(); }

    // Dividends often state only the gross total — derive per-share when needed.
    if (type === 'dividend' && !(price > 0) && quantity > 0) {
      var grossM = t.match(/bruttobetrag\s*:?\s*([\d.,]{1,20})\s*(EUR|USD)/i);
      if (grossM) { price = Math.abs(num(IM, grossM[1])) / quantity; currency = grossM[2].toUpperCase(); }
    }
    if (!(price > 0)) errors.push(__('piNoPrice', 'price not found'));

    // Fees: every known fee label, summed.
    var fees = 0;
    var FEE_LABELS = /(orderprovision|fremdkostenzuschlag|provision|orderentgelt|transaktionsentgelt|handelsentgelt|grundgeb(?:ü|ue)hr|ausgabeaufschlag|kosten des kreditinstituts|b(?:ö|oe)rsengeb(?:ü|ue)hr|handelsplatzgeb(?:ü|ue)hr|maklercourtage|fremde spesen)/.source;
    var feeRx = new RegExp(FEE_LABELS + '\\s*:?\\s*-?\\s*([\\d.,]{1,20})\\s*(?:EUR|USD)', 'gi');
    var feeM;
    while ((feeM = feeRx.exec(t)) !== null) fees += Math.abs(num(IM, feeM[2])) || 0;
    // onvista: "Orderprovision EUR 1,00" - the currency before the amount
    var feeRx2 = new RegExp(FEE_LABELS + '\\s*:?\\s*(?:EUR|USD)\\s+-?([\\d.,]{1,20})', 'gi');
    while ((feeM = feeRx2.exec(t)) !== null) fees += Math.abs(num(IM, feeM[2])) || 0;

    // Date: the trade-date labels, then any German date as a fallback.
    var dateM = firstMatch(t, [
      /(?:schlusstag(?:\s*\/\s*-?zeit)?|handelstag(?:\s*\/\s*-?zeit)?|ausf(?:ü|ue)hrungstag|gesch(?:ä|ae)ftstag|zahltag|datum)\s*:?\s*(\d{1,2}\.\d{1,2}\.\d{2,4})/i,
      /\bam\s+(\d{1,2}\.\d{1,2}\.\d{4})/i,
      /(\d{1,2}\.\d{1,2}\.\d{4})/
    ]);
    var date = dateM ? (IM ? IM.parseDate(dateM[1], 'de') : null) : null;
    if (!date) errors.push(__('piNoDate', 'date not found'));

    if (!symbol || !(quantity > 0) || !(price > 0) || !date) {
      return { candidate: null, errors: errors };
    }
    // P5-3.2: taxes withheld - on a dividend they are its withholding tax, next
    // to a trade a tax (or tax refund) row of the same day.
    var tx = taxesOf(t, currency, IM);
    tx.errors.forEach(function (e) { errors.push(e); });
    var extra = [];
    if (type !== 'dividend') {
      if (tx.paid > 0) extra.push(cashRow('tax', tx.paid, currency, date, brokerId));
      if (tx.refunded > 0) extra.push(cashRow('tax_refund', tx.refunded, currency, date, brokerId));
    }
    return {
      extra: extra,
      candidate: {
        category: 'stocks',
        type: type,
        symbol: symbol,
        symbolName: symbolName,
        quantity: quantity,
        price: price,
        fees: fees,
        currency: currency,
        date: date,
        withholdingTax: type === 'dividend' && tx.paid > 0 ? r6(tx.paid) : undefined,
        source: brokerId || null
      },
      errors: errors
    };
  }

  // ---- P5-3.2: taxes, cash documents, DEGIRO tables, several per PDF ----------
  function r6(n) { return Math.round(n * 1e6) / 1e6; }
  function cashRow(type, amount, currency, date, brokerId) {
    return { category: 'cashflow', type: type, amount: r6(amount), currency: currency || 'EUR', date: date, source: brokerId || null };
  }
  var CUR = /(EUR|USD|CHF|GBP)/.source;
  var AMOUNT_RX = /-?\d{1,3}(?:\.\d{3})*,\d{2,6}|-?\d+,\d{2,6}/g;
  // The money amount of a line: its last German-decimal number, and the last
  // currency code on the line.
  function lineAmount(IM, line) {
    var nums = String(line).match(AMOUNT_RX);
    var curs = String(line).match(new RegExp('\\b' + CUR + '\\b', 'g'));
    if (!nums) return null;
    var v = Math.abs(num(IM, nums[nums.length - 1]));
    return isFinite(v) ? { value: v, currency: curs ? curs[curs.length - 1] : null } : null;
  }
  var TAX_LINE_RX = /^(?:erstattung\s+|erstattete\s+|einbehaltene\s+|us-)?(kapitalertrag(?:s)?steuer|solidarit(?:ä|ae)tszuschlag|kirchensteuer|quellensteuer|dividendensteuer)\b/i;
  var TAX_INFO_RX = /anrechenbar|erstattungsf(?:ä|ae)hig|bemessungsgrundlage|verrechnet|verlusttopf|topf/i;
  // Sum of the taxes withheld (paid) or refunded, in the given currency. EUR
  // taxes on a USD payout are converted at the document's Devisenkurs; with no
  // rate the line is left out and reported, never guessed.
  function taxesOf(t, currency, IM) {
    var out = { paid: 0, refunded: 0, errors: [] };
    var rateM = t.match(/devisenkurs\s*:?\s*(?:EUR\s*\/\s*[A-Z]{3}\s*)?:?\s*([\d.,]{1,20})/i);
    var rate = rateM ? num(IM, rateM[1]) : NaN;
    var missingRate = false;
    t.split('\n').forEach(function (raw) {
      var line = raw.trim();
      if (!TAX_LINE_RX.test(line) || TAX_INFO_RX.test(line)) return;
      var a = lineAmount(IM, line);
      if (!a || !(a.value > 0)) return;
      var v = a.value, c = a.currency || currency;
      if (c !== currency) {
        if (c === 'EUR' && rate > 0) v = v * rate;
        else if (currency === 'EUR' && rate > 0) v = v / rate;
        else { missingRate = true; return; }
      }
      if (/^erstatt|erstattung/i.test(line)) out.refunded += v; else out.paid += v;
    });
    out.paid = r6(out.paid); out.refunded = r6(out.refunded);
    if (missingRate) out.errors.push(__('piTaxNoRate', 'tax in another currency left out: no exchange rate on the document'));
    return out;
  }

  // Tax and fee documents (no trade): one cash row each. Only the head of the
  // document decides, so a settlement that mentions such words stays a trade.
  var TAX_DOC_RX = /steuerausgleich|steuerkorrektur|ausgleichsrechnung|vorabpauschale|steuerliche\s+(?:korrektur|abrechnung)|nachbelastung|steuererstattung/i;
  var FEE_DOC_RX = /depotentgelt|depotgeb(?:ü|ue)hr|kontof(?:ü|ue)hrungs(?:entgelt|geb(?:ü|ue)hr)|\brechnung\b/i;
  var TOTAL_RX = /^(rechnungsbetrag|gesamtbetrag|endbetrag|summe|betrag zu ihren (?:lasten|gunsten)|ausmachender betrag)\b/i;
  function docKind(t) {
    var head = t.split('\n').slice(0, 5).join('\n');
    if (/wertpapierabrechnung|dividendengutschrift|ertragsgutschrift/i.test(head) && !TAX_DOC_RX.test(head)) return 'trade';
    if (TAX_DOC_RX.test(head)) return 'tax';
    if (FEE_DOC_RX.test(head)) return 'fee';
    return 'trade';
  }
  function docDate(t, IM) {
    var m = t.match(/(?:datum|buchungstag|valuta)\s*:?\s*(\d{1,2}\.\d{1,2}\.\d{4})/i) || t.match(/(\d{1,2}\.\d{1,2}\.\d{4})/);
    return m && IM ? IM.parseDate(m[1], 'de') : null;
  }
  function parseCashDoc(t, kind, brokerId) {
    var IM = mapping();
    var errors = [];
    var date = docDate(t, IM);
    if (!date) errors.push(__('piNoDate', 'date not found'));
    var lines = t.split('\n').map(function (l) { return l.trim(); });
    var totalLine = lines.filter(function (l) { return TOTAL_RX.test(l); })[0];
    var total = totalLine ? lineAmount(IM, totalLine) : null;
    var currency = (total && total.currency) || 'EUR';
    var rows = [];
    if (kind === 'tax') {
      var tx = taxesOf(t, currency, IM);
      tx.errors.forEach(function (e) { errors.push(e); });
      var refund = /zu ihren gunsten|erstattung/i.test(t) && !(tx.paid > 0);
      var amount = total ? total.value : (refund ? tx.refunded : tx.paid);
      if (!(amount > 0)) errors.push(__('piNoAmount', 'amount not found'));
      else if (date) rows.push(cashRow(refund ? 'tax_refund' : 'tax', amount, currency, date, brokerId));
    } else {
      var fee = total ? total.value : 0;
      if (!total) lines.forEach(function (l) { if (FEE_DOC_RX.test(l)) { var a = lineAmount(IM, l); if (a) { fee += a.value; currency = a.currency || currency; } } });
      if (!(fee > 0)) errors.push(__('piNoAmount', 'amount not found'));
      else if (date) rows.push(cashRow('fee', fee, currency, date, brokerId));
    }
    return { candidates: rows, errors: errors };
  }

  // DEGIRO dates are "15-01-2025".
  function dmy(s) { var m = String(s).match(/^(\d{2})-(\d{2})-(\d{4})$/); return m ? m[3] + '-' + m[2] + '-' + m[1] : null; }
  // Transaktionsübersicht: date time name ISIN [exchange venue] qty price CUR
  // local CUR, value EUR, [rate], [costs EUR], total EUR - one trade per row.
  function parseDegiroTransactions(t) {
    var IM = mapping();
    var out = { candidates: [], errors: [] };
    var rowRx = new RegExp('^(\\d{2}-\\d{2}-\\d{4})\\s+\\d{1,2}:\\d{2}\\s+(.+?)\\s+([A-Z]{2}[A-Z0-9]{9}[0-9])\\s+(?:\\S+\\s+){0,3}?(-?\\d[\\d.]*(?:,\\d+)?)\\s+(\\d[\\d.]*(?:,\\d+)?)\\s+' + CUR + '\\s+(.*)$');
    t.split('\n').forEach(function (raw) {
      var m = raw.trim().match(rowRx);
      if (!m) return;
      var qty = num(IM, m[4]), price = Math.abs(num(IM, m[5])), currency = m[6];
      var money = (m[7].match(new RegExp('-?[\\d.]+,\\d+\\s+' + CUR, 'g')) || []).map(function (x) { var p = x.trim().split(/\s+/); return { v: Math.abs(num(IM, p[0])), c: p[1] }; });
      var fees = 0;
      if (money.length >= 4) {
        var cost = money[money.length - 2];
        fees = cost.v;
        if (cost.c !== currency) {
          var local = money[0], eur = money[1];
          if (local.c === currency && eur.v > 0) fees = cost.v * (local.v / eur.v);
          else { fees = 0; out.errors.push(__('piTaxNoRate', 'tax in another currency left out: no exchange rate on the document')); }
        }
      }
      if (!(qty !== 0 && isFinite(qty)) || !(price > 0)) return;
      out.candidates.push({ category: 'stocks', type: qty < 0 ? 'sell' : 'buy', symbol: m[3], symbolName: m[2].trim(),
        quantity: Math.abs(qty), price: price, fees: r6(fees), currency: currency, date: dmy(m[1]), source: 'degiro' });
    });
    if (!out.candidates.length) out.errors.push(__('piNoRows', 'no transaction rows recognised'));
    return out;
  }
  // Kontoauszug: date time value-date product [ISIN] description CUR change CUR
  // balance. Dividends (with their Dividendensteuer) and fees; trades come from
  // the Transaktionsübersicht, so they are skipped here and said so.
  function parseDegiroAccount(t) {
    var IM = mapping();
    var out = { candidates: [], errors: [] };
    var rowRx = /^(\d{2}-\d{2}-\d{4})\s+\d{1,2}:\d{2}\s+\d{2}-\d{2}-\d{4}\s+(.*)$/;
    var divs = {}, taxes = [], skipped = 0;
    t.split('\n').forEach(function (raw) {
      var m = raw.trim().match(rowRx);
      if (!m) return;
      var pairs = m[2].match(new RegExp(CUR + '\\s+-?[\\d.]+,\\d+', 'g')) || [];
      if (pairs.length < 2) return;
      var ch = pairs[pairs.length - 2].split(/\s+/);
      var amount = Math.abs(num(IM, ch[1])), currency = ch[0];
      var body = m[2].slice(0, m[2].indexOf(pairs[pairs.length - 2]));
      var isinM = body.match(ISIN_RX);
      var date = dmy(m[1]);
      if (/dividendensteuer|quellensteuer/i.test(body)) taxes.push({ isin: isinM && isinM[1], date: date, amount: amount, currency: currency });
      else if (/dividende|aussch(?:ü|ue)ttung/i.test(body) && isinM) {
        var k = isinM[1] + '|' + date;
        if (divs[k]) divs[k].price = r6(divs[k].price + amount);
        else {
          divs[k] = { category: 'stocks', type: 'dividend', symbol: isinM[1], symbolName: body.split(isinM[1])[0].trim(),
            quantity: 1, price: amount, fees: 0, currency: currency, date: date, source: 'degiro' };
          out.candidates.push(divs[k]);
        }
      } else if (/geb(?:ü|ue)hr|entgelt/i.test(body) && !/transaktionskosten/i.test(body)) out.candidates.push(cashRow('fee', amount, currency, date, 'degiro'));
      else skipped++;
    });
    taxes.forEach(function (x) {
      var d = x.isin && divs[x.isin + '|' + x.date];
      if (d && d.currency === x.currency) d.withholdingTax = r6((d.withholdingTax || 0) + x.amount);
      else out.candidates.push(cashRow('tax', x.amount, x.currency, x.date, 'degiro'));
    });
    if (Object.keys(divs).length) out.errors.push(__('piNoShareCount', 'DEGIRO account statement: no share count per dividend - booked as 1 × the amount; correct the quantity if you need per-share figures'));
    if (skipped) out.errors.push(__('piSkippedRows', '{n} {n:row|rows} skipped (trades come from the Transaktionsübersicht, transfers are not booked)', { n: skipped }));
    return out;
  }

  // Several settlements in one PDF: split at each document heading at the start
  // of a line; the lines above the first heading (letterhead) go with each part.
  var DOC_START_RX = /^(?:wertpapierabrechnung|dividendengutschrift|ertragsgutschrift|ertragsmitteilung)\b/i;
  function splitDocuments(text) {
    var lines = text.split('\n');
    var starts = [];
    lines.forEach(function (l, i) { if (DOC_START_RX.test(l.trim())) starts.push(i); });
    if (starts.length < 2) return [text];
    var head = lines.slice(0, starts[0]);
    return starts.map(function (s, k) { return head.concat(lines.slice(s, k + 1 < starts.length ? starts[k + 1] : lines.length)).join('\n'); });
  }

  // Full pure pipeline for one document's text: detect broker, parse, report.
  function parseText(text) {
    text = capText(text);
    var broker = detectBrokerFromText(text);
    var id = broker && broker.id;
    if (id === 'degiro' && /transaktions(?:ü|ue)bersicht/i.test(text)) return Object.assign({ broker: broker }, parseDegiroTransactions(text));
    if (id === 'degiro' && /kontoauszug/i.test(text)) return Object.assign({ broker: broker }, parseDegiroAccount(text));
    var out = { broker: broker, candidates: [], errors: [] };
    splitDocuments(text).forEach(function (doc) {
      var t = doc.replace(/\u00a0/g, ' ');
      var kind = docKind(t);
      var res = kind === 'trade' ? parseStatement(t, id) : parseCashDoc(t, kind, id);
      if (res.candidate) out.candidates.push(res.candidate);
      (res.extra || res.candidates || []).forEach(function (c) { out.candidates.push(c); });
      res.errors.forEach(function (e) { if (out.errors.indexOf(e) < 0) out.errors.push(e); });
    });
    return out;
  }

  // Serialise candidates for the EXISTING CSV mapping flow (semicolon-delimited,
  // names quoted, en-US decimals so parseNumber is unambiguous downstream).
  function candidatesToCSV(candidates) {
    // P5-3.2: WithholdingTax (dividends) and Amount (tax / fee cash rows, no symbol)
    // (column names the mapping flow reads, not UI text)
    var lines = ['Date;Type;Symbol;Name;Quantity;Price;Fee;Currency;WithholdingTax;Amount'];
    (candidates || []).forEach(function (c) {
      var cash = c.category === 'cashflow';
      lines.push([
        c.date, c.type, cash ? '' : c.symbol,
        '"' + String(c.symbolName || '').replace(/"/g, '""') + '"',
        cash ? '' : String(c.quantity), cash ? '' : String(c.price), String(c.fees || 0), c.currency || 'EUR',
        c.withholdingTax > 0 ? String(c.withholdingTax) : '', cash ? String(c.amount) : ''
      ].join(';'));
    });
    return lines.join('\n');
  }

  // Browser convenience: File objects in, ready-to-preview result out.
  // Several statements can be selected at once; per-file failures are reported
  // per file name, the rest still imports.
  function parseFiles(files) {
    var list = Array.prototype.slice.call(files || []);
    var out = { candidates: [], errors: [], brokers: [] };
    var chain = Promise.resolve();
    list.forEach(function (file) {
      chain = chain.then(function () {
        return new Promise(function (resolve, reject) {
          var r = new FileReader();
          r.onload = function (ev) { resolve(ev.target.result); };
          r.onerror = function () { reject(new Error('read failed')); };
          r.readAsArrayBuffer(file);
        }).then(extractText).then(function (text) {
          var res = parseText(text);
          if (res.broker && out.brokers.indexOf(res.broker.name) === -1) out.brokers.push(res.broker.name);
          out.candidates = out.candidates.concat(res.candidates);
          res.errors.forEach(function (e) { out.errors.push(file.name + ': ' + e); });
        }).catch(function (e) {
          out.errors.push(file.name + ': ' + ((e && e.message) || 'could not parse PDF'));
        });
      });
    });
    return chain.then(function () {
      out.csv = out.candidates.length ? candidatesToCSV(out.candidates) : '';
      return out;
    });
  }

  var api = {
    PDF_BROKERS: PDF_BROKERS,
    PDFJS_LIB: PDFJS_LIB,
    PDFJS_WORKER: PDFJS_WORKER,
    detectBrokerFromText: detectBrokerFromText,
    parseStatement: parseStatement,
    parseText: parseText,
    candidatesToCSV: candidatesToCSV,
    ensurePdfJs: ensurePdfJs,
    extractText: extractText,
    parseFiles: parseFiles
  };
  if (typeof window !== 'undefined') window.MaerminPdfImport = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
