// ============================================================================
// MAERMIN — Broker statement PDF import  (window.MaerminPdfImport)
// ----------------------------------------------------------------------------
// Parse broker settlement PDFs (Wertpapierabrechnungen) fully CLIENT-SIDE and
// feed the result into the EXISTING import pipeline — the PDF never leaves the
// device. First supported layouts: Trade Republic, Scalable Capital, ING, DKB,
// Comdirect (one settlement per document, buys/sells/dividends).
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

  function detectBrokerFromText(text) {
    var t = String(text || '').toLowerCase();
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
        .replace(/wertpapier-?bezeichnung\s*:?/i, '').replace(/[():]/g, '').trim();
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
      /([\d.,]{1,20})\s*(?:stk\.?|st(?:ü|ue)ck)\b/i,
      /st(?:ü|ue)ck\s*:?\s+([\d.,]{1,20})/i,
      /\bst\.\s*([\d.,]{1,20})/i
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
      /(?:aussch(?:ü|ue)ttung|bruttobetrag)\s+je\s+anteil\s*:?\s*([\d.,]{1,20})\s*(EUR|USD)/i
    ]);
    var price = priceM ? Math.abs(num(IM, priceM[1])) : NaN;
    var currency = priceM ? priceM[2].toUpperCase() : 'EUR';

    // Dividends often state only the gross total — derive per-share when needed.
    if (type === 'dividend' && !(price > 0) && quantity > 0) {
      var grossM = t.match(/bruttobetrag\s*:?\s*([\d.,]{1,20})\s*(EUR|USD)/i);
      if (grossM) { price = Math.abs(num(IM, grossM[1])) / quantity; currency = grossM[2].toUpperCase(); }
    }
    if (!(price > 0)) errors.push(__('piNoPrice', 'price not found'));

    // Fees: every known fee label, summed.
    var fees = 0;
    var feeRx = /(fremdkostenzuschlag|provision|orderentgelt|transaktionsentgelt|handelsentgelt|grundgeb(?:ü|ue)hr|ausgabeaufschlag|kosten des kreditinstituts)\s*:?\s*-?\s*([\d.,]{1,20})\s*(?:EUR|USD)/gi;
    var feeM;
    while ((feeM = feeRx.exec(t)) !== null) fees += Math.abs(num(IM, feeM[2])) || 0;

    // Date: the trade-date labels, then any German date as a fallback.
    var dateM = firstMatch(t, [
      /(?:schlusstag(?:\s*\/\s*-?zeit)?|handelstag(?:\s*\/\s*-?zeit)?|ausf(?:ü|ue)hrungstag|gesch(?:ä|ae)ftstag|datum)\s*:?\s*(\d{1,2}\.\d{1,2}\.\d{2,4})/i,
      /\bam\s+(\d{1,2}\.\d{1,2}\.\d{4})/i,
      /(\d{1,2}\.\d{1,2}\.\d{4})/
    ]);
    var date = dateM ? (IM ? IM.parseDate(dateM[1], 'de') : null) : null;
    if (!date) errors.push(__('piNoDate', 'date not found'));

    if (!symbol || !(quantity > 0) || !(price > 0) || !date) {
      return { candidate: null, errors: errors };
    }
    return {
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
        source: brokerId || null
      },
      errors: errors
    };
  }

  // Full pure pipeline for one document's text: detect broker, parse, report.
  function parseText(text) {
    text = capText(text);
    var broker = detectBrokerFromText(text);
    var parsed = parseStatement(text, broker && broker.id);
    return {
      broker: broker,
      candidates: parsed.candidate ? [parsed.candidate] : [],
      errors: parsed.errors
    };
  }

  // Serialise candidates for the EXISTING CSV mapping flow (semicolon-delimited,
  // names quoted, en-US decimals so parseNumber is unambiguous downstream).
  function candidatesToCSV(candidates) {
    var head = ['Date', 'Type', 'Symbol', 'Name', 'Quantity', 'Price', 'Fee', 'Currency'];
    var lines = [head.join(';')];
    (candidates || []).forEach(function (c) {
      lines.push([
        c.date, c.type, c.symbol,
        '"' + String(c.symbolName || '').replace(/"/g, '""') + '"',
        String(c.quantity), String(c.price), String(c.fees || 0), c.currency || 'EUR'
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
