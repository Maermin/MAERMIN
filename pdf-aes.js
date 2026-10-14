// ============================================================================
// MAERMIN — AES-256 PDF encryption  (window.MaerminPdfAes)
// ----------------------------------------------------------------------------
// P5-4.8. jsPDF's own password option is the old RC4 40-bit handler, which is
// broken in minutes. This module encrypts a finished PDF (jsPDF's output)
// with the PDF 2.0 standard security handler, revision 6 (ISO 32000-2,
// 7.6.4): a random 256-bit file key, AES-256-CBC with a random IV for every
// stream and every string, and the /U /UE /O /OE /Perms entries from
// Algorithm 2.B (SHA-256/384/512 with AES-128 rounds). Everything runs on the
// browser's WebCrypto; nothing leaves the device.
//
// The rewriter handles the classic file structure jsPDF writes (one object
// per "N 0 obj", a classic xref table); cross-reference streams and object
// streams are refused rather than mis-encrypted. Passwords are UTF-8,
// truncated to 127 bytes (SASLprep normalisation is not applied: ASCII and
// already-normalised Unicode work). Node-tested in test/pdf-aes.test.js with
// an independent decryptor and, where installed, poppler's pdftotext.
// ============================================================================
(function () {
  'use strict';

  function subtle() {
    var c = (typeof globalThis !== 'undefined' && globalThis.crypto) || (typeof window !== 'undefined' && window.crypto);
    if (!c || !c.subtle) throw new Error('WebCrypto is not available');
    return c;
  }
  function rand(n) { var b = new Uint8Array(n); subtle().getRandomValues(b); return b; }
  function concat(list) {
    var len = 0; list.forEach(function (a) { len += a.length; });
    var out = new Uint8Array(len), o = 0;
    list.forEach(function (a) { out.set(a, o); o += a.length; });
    return out;
  }
  function toLatin1(bytes) {
    var s = '', CH = 0x8000;
    for (var i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
    return s;
  }
  function fromLatin1(s) { var b = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 0xff; return b; }
  function hex(bytes) { var s = ''; for (var i = 0; i < bytes.length; i++) s += (bytes[i] < 16 ? '0' : '') + bytes[i].toString(16); return s.toUpperCase(); }

  function sha(name, data) { return subtle().subtle.digest(name, data).then(function (h) { return new Uint8Array(h); }); }
  // AES-CBC with PKCS#7 (WebCrypto's only CBC mode). For "no padding" callers
  // pass whole blocks and drop the last (padding) block of the result.
  function aesCbc(keyBytes, iv, data) {
    var S = subtle().subtle;
    return S.importKey('raw', keyBytes, { name: 'AES-CBC' }, false, ['encrypt']).then(function (k) {
      return S.encrypt({ name: 'AES-CBC', iv: iv }, k, data);
    }).then(function (c) { return new Uint8Array(c); });
  }
  function aesCbcNoPad(keyBytes, iv, data) { return aesCbc(keyBytes, iv, data).then(function (c) { return c.subarray(0, data.length); }); }

  // Algorithm 2.B (ISO 32000-2): the hash for the revision 6 handler.
  function hash2B(pw, salt, udata) {
    return sha('SHA-256', concat([pw, salt, udata])).then(function (k0) {
      var k = k0, i = 0, e = null;
      function round() {
        if (!(i < 64 || e[e.length - 1] > i - 32)) return Promise.resolve(k.subarray(0, 32));
        var block = concat([pw, k, udata]);
        var parts = []; for (var r = 0; r < 64; r++) parts.push(block);
        return aesCbcNoPad(k.subarray(0, 16), k.subarray(16, 32), concat(parts)).then(function (enc) {
          e = enc;
          var sum = 0; for (var j = 0; j < 16; j++) sum += e[j];
          return sha(['SHA-256', 'SHA-384', 'SHA-512'][sum % 3], e);
        }).then(function (h) { k = h; i++; return round(); });
      }
      return round();
    });
  }

  function pwBytes(p) {
    var b = typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(String(p)) : fromLatin1(unescape(encodeURIComponent(String(p))));
    return b.subarray(0, 127);
  }

  // The security handler entries for a new random file key.
  function securityEntries(userPassword, ownerPassword, P) {
    var fileKey = rand(32);
    var upw = pwBytes(userPassword), opw = pwBytes(ownerPassword);
    var uvs = rand(8), uks = rand(8), ovs = rand(8), oks = rand(8);
    var zero16 = new Uint8Array(16), empty = new Uint8Array(0);
    var U, UE, O, OE, Perms;
    return hash2B(upw, uvs, empty).then(function (h) {
      U = concat([h, uvs, uks]);
      return hash2B(upw, uks, empty);
    }).then(function (k) { return aesCbcNoPad(k, zero16, fileKey); }).then(function (ue) {
      UE = ue;
      return hash2B(opw, ovs, U);
    }).then(function (h) {
      O = concat([h, ovs, oks]);
      return hash2B(opw, oks, U);
    }).then(function (k) { return aesCbcNoPad(k, zero16, fileKey); }).then(function (oe) {
      OE = oe;
      var b = new Uint8Array(16);
      var p = P | 0;
      b[0] = p & 0xff; b[1] = (p >>> 8) & 0xff; b[2] = (p >>> 16) & 0xff; b[3] = (p >>> 24) & 0xff;
      b[4] = b[5] = b[6] = b[7] = 0xff;
      b[8] = 0x54; b[9] = 0x61; b[10] = 0x64; b[11] = 0x62; // 'T' (EncryptMetadata) 'adb'
      b.set(rand(4), 12);
      return aesCbcNoPad(fileKey, zero16, b); // one block: CBC with a zero IV is ECB
    }).then(function (perms) {
      Perms = perms;
      return { fileKey: fileKey, U: U, UE: UE, O: O, OE: OE, Perms: Perms, P: P | 0 };
    });
  }

  // ---- PDF rewriting -----------------------------------------------------------
  var WS = /[\x00\t\n\f\r ]/;
  var DELIM = /[()<>[\]{}/%]/;
  function isWs(c) { return WS.test(c); }

  // Decode a literal string body (between the outer parentheses).
  function decodeLiteral(body) {
    var out = [];
    for (var i = 0; i < body.length; i++) {
      var c = body[i];
      if (c !== '\\') { out.push(c.charCodeAt(0) & 0xff); continue; }
      var n = body[++i];
      if (n === undefined) break;
      if (n === 'n') out.push(10); else if (n === 'r') out.push(13); else if (n === 't') out.push(9);
      else if (n === 'b') out.push(8); else if (n === 'f') out.push(12);
      else if (n === '\r') { if (body[i + 1] === '\n') i++; }
      else if (n === '\n') { /* line continuation */ }
      else if (/[0-7]/.test(n)) {
        var oct = n;
        while (oct.length < 3 && /[0-7]/.test(body[i + 1] || '')) oct += body[++i];
        out.push(parseInt(oct, 8) & 0xff);
      } else out.push(n.charCodeAt(0) & 0xff);
    }
    return Uint8Array.from(out);
  }
  function decodeHex(body) {
    var h = body.replace(/[^0-9A-Fa-f]/g, '');
    if (h.length % 2) h += '0';
    var out = new Uint8Array(h.length / 2);
    for (var i = 0; i < out.length; i++) out[i] = parseInt(h.substr(i * 2, 2), 16);
    return out;
  }

  // Scan an object body from `start`: returns { end (index of 'stream' or
  // 'endobj' keyword), kind ('stream'|'endobj'), strings: [{ from, to, bytes }] }.
  function scanBody(s, start) {
    var i = start, strings = [];
    while (i < s.length) {
      var c = s[i];
      if (c === '%') { while (i < s.length && s[i] !== '\n' && s[i] !== '\r') i++; continue; }
      if (c === '(') {
        var depth = 1, j = i + 1;
        while (j < s.length && depth > 0) {
          if (s[j] === '\\') { j += 2; continue; }
          if (s[j] === '(') depth++; else if (s[j] === ')') depth--;
          j++;
        }
        strings.push({ from: i, to: j, bytes: decodeLiteral(s.slice(i + 1, j - 1)) });
        i = j; continue;
      }
      if (c === '<') {
        if (s[i + 1] === '<') { i += 2; continue; }
        var k = s.indexOf('>', i);
        strings.push({ from: i, to: k + 1, bytes: decodeHex(s.slice(i + 1, k)) });
        i = k + 1; continue;
      }
      if ((c === 's' && s.startsWith('stream', i)) || (c === 'e' && s.startsWith('endobj', i))) {
        var prev = i === 0 ? ' ' : s[i - 1], next = s[i + (c === 's' ? 6 : 6)] || ' ';
        if ((isWs(prev) || DELIM.test(prev)) && (isWs(next) || DELIM.test(next))) return { end: i, kind: c === 's' ? 'stream' : 'endobj', strings: strings };
      }
      i++;
    }
    throw new Error('PDF object without endobj');
  }

  // encryptPdf(bytes: Uint8Array, { userPassword, ownerPassword?, permissions? })
  //   -> Promise<Uint8Array>
  function encryptPdf(bytes, opts) {
    opts = opts || {};
    if (!opts.userPassword) return Promise.reject(new Error('A password is required'));
    var s = toLatin1(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
    if (!/^%PDF-\d\.\d/.test(s)) return Promise.reject(new Error('Not a PDF'));
    var tIdx = s.lastIndexOf('trailer');
    var trailer = tIdx >= 0 ? s.slice(tIdx) : '';
    var root = /\/Root\s+(\d+\s+\d+\s+R)/.exec(trailer), info = /\/Info\s+(\d+\s+\d+\s+R)/.exec(trailer);
    if (!root) return Promise.reject(new Error('PDF trailer without /Root (cross-reference streams are not supported)'));
    var idm = /\/ID\s*\[\s*(<[0-9A-Fa-f\s]*>)\s*(<[0-9A-Fa-f\s]*>)\s*\]/.exec(trailer);
    var ownerPassword = opts.ownerPassword || hex(rand(24));
    var P = opts.permissions != null ? opts.permissions : -4;

    // Header: the first line becomes %PDF-2.0; a binary comment line is kept.
    var firstEol = s.search(/\r\n|\n|\r/);
    var pos = firstEol + (s[firstEol] === '\r' && s[firstEol + 1] === '\n' ? 2 : 1);
    var head = '%PDF-2.0\n';
    if (s[pos] === '%') { var e2 = s.slice(pos).search(/\r\n|\n|\r/); head += s.slice(pos, pos + e2) + '\n'; }

    // Collect the objects (stream data skipped by /Length, never scanned).
    var objs = [];
    var objRe = /(\d+)\s+(\d+)\s+obj\b/g;
    objRe.lastIndex = pos;
    var m;
    while ((m = objRe.exec(s))) {
      var num = parseInt(m[1], 10), gen = parseInt(m[2], 10);
      var bodyStart = m.index + m[0].length;
      var sc = scanBody(s, bodyStart);
      var dict = s.slice(bodyStart, sc.end);
      if (/\/Type\s*\/(XRef|ObjStm)\b/.test(dict)) throw new Error('Object and xref streams are not supported');
      var o = { num: num, gen: gen, dict: dict, strings: sc.strings.map(function (x) { return { from: x.from - bodyStart, to: x.to - bodyStart, bytes: x.bytes }; }), stream: null };
      var after;
      if (sc.kind === 'stream') {
        var d0 = sc.end + 6;
        if (s[d0] === '\r' && s[d0 + 1] === '\n') d0 += 2; else if (s[d0] === '\n' || s[d0] === '\r') d0 += 1;
        var lm = /\/Length\s+(\d+)(\s+\d+\s+R)?/.exec(dict);
        var len = lm && !lm[2] ? parseInt(lm[1], 10) : -1;
        if (len < 0 || s.slice(d0 + len).search(/^\s*endstream/) !== 0) {
          var es = s.indexOf('endstream', d0);
          len = es - d0;
          if (s[d0 + len - 1] === '\n') len--;
          if (s[d0 + len - 1] === '\r') len--;
        }
        o.stream = fromLatin1(s.slice(d0, d0 + len));
        var endS = s.indexOf('endstream', d0 + len);
        after = s.indexOf('endobj', endS + 9);
      } else {
        after = sc.end;
      }
      objs.push(o);
      pos = after + 6;
      objRe.lastIndex = pos;
    }
    if (!objs.length) return Promise.reject(new Error('No objects found'));

    return securityEntries(opts.userPassword, ownerPassword, P).then(function (sec) {
      var S = subtle().subtle;
      return S.importKey('raw', sec.fileKey, { name: 'AES-CBC' }, false, ['encrypt']).then(function (key) {
        function enc(data) {
          var iv = rand(16);
          return S.encrypt({ name: 'AES-CBC', iv: iv }, key, data).then(function (c) { return concat([iv, new Uint8Array(c)]); });
        }
        var chain = Promise.resolve();
        objs.forEach(function (o) {
          chain = chain.then(function () {
            // Strings, back to front so the offsets stay valid.
            var p = Promise.resolve(o.dict);
            o.strings.slice().reverse().forEach(function (x) {
              p = p.then(function (d) { return enc(x.bytes).then(function (c) { return d.slice(0, x.from) + '<' + hex(c) + '>' + d.slice(x.to); }); });
            });
            return p.then(function (d) {
              o.out = d;
              if (!o.stream) return;
              return enc(o.stream).then(function (c) {
                o.streamOut = c;
                o.out = /\/Length\s+\d+(\s+\d+\s+R)?/.test(o.out) ? o.out.replace(/\/Length\s+\d+(\s+\d+\s+R)?/, '/Length ' + c.length) : o.out.replace(/<</, '<< /Length ' + c.length);
              });
            });
          });
        });
        return chain.then(function () {
          var maxNum = objs.reduce(function (mx, o) { return Math.max(mx, o.num); }, 0);
          var encNum = maxNum + 1;
          var parts = [head], offset = head.length, offsets = {};
          function push(str) { parts.push(str); offset += str.length; }
          objs.forEach(function (o) {
            offsets[o.num] = { off: offset, gen: o.gen };
            push(o.num + ' ' + o.gen + ' obj\n' + o.out.replace(/^\s+/, '').replace(/\s+$/, '') + '\n');
            if (o.streamOut) { push('stream\n'); push(toLatin1(o.streamOut)); push('\nendstream\n'); }
            push('endobj\n');
          });
          offsets[encNum] = { off: offset, gen: 0 };
          push(encNum + ' 0 obj\n<< /Filter /Standard /V 5 /R 6 /Length 256 /CF << /StdCF << /Type /CryptFilter /CFM /AESV3 /AuthEvent /DocOpen /Length 32 >> >> /StmF /StdCF /StrF /StdCF' +
            ' /U <' + hex(sec.U) + '> /UE <' + hex(sec.UE) + '> /O <' + hex(sec.O) + '> /OE <' + hex(sec.OE) + '> /P ' + sec.P + ' /Perms <' + hex(sec.Perms) + '> /EncryptMetadata true >>\nendobj\n');
          var xref = offset;
          var lines = ['xref', '0 ' + (encNum + 1), '0000000000 65535 f '];
          for (var n = 1; n <= encNum; n++) {
            var e = offsets[n];
            lines.push(e ? String(e.off).padStart(10, '0') + ' ' + String(e.gen).padStart(5, '0') + ' n ' : '0000000000 65535 f ');
          }
          var id = idm ? '[ ' + idm[1] + ' ' + idm[2] + ' ]' : (function () { var h = '<' + hex(rand(16)) + '>'; return '[ ' + h + ' ' + h + ' ]'; })();
          push(lines.join('\n') + '\ntrailer\n<< /Size ' + (encNum + 1) + ' /Root ' + root[1] + (info ? ' /Info ' + info[1] : '') +
            ' /Encrypt ' + encNum + ' 0 R /ID ' + id + ' >>\nstartxref\n' + xref + '\n%%EOF\n');
          return fromLatin1(parts.join(''));
        });
      });
    });
  }

  var api = { encryptPdf: encryptPdf, hash2B: hash2B };
  if (typeof window !== 'undefined') window.MaerminPdfAes = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
