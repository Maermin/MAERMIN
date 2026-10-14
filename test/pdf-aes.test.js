// Node harness for P5-4.8: AES-256 PDF encryption (PDF 2.0 standard security
// handler, revision 6) on top of a jsPDF-style PDF. The PDF is decrypted here
// with an independent implementation on node:crypto (ISO 32000-2, 7.6.4.3.3
// and Algorithm 2.B); when poppler's pdftotext is installed it must also open
// the file with the password.
// Run: node test/pdf-aes.test.js
'use strict';

let passed = 0, failed = 0;
function ok(name, cond, info) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.error('  ✗ ' + name + (info !== undefined ? ' -> ' + JSON.stringify(info) : '')); }
}

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const AES = require('../pdf-aes.js');

// A small PDF like jsPDF writes it: Info strings, a content stream with a
// text string, a binary stream, xref and trailer with an /ID.
function samplePdf() {
  const content = 'BT /F1 18 Tf 72 712 Td (Vermoegensaufstellung 2026) Tj ET';
  const bin = Buffer.from([0, 1, 2, 255, 254, 10, 13, 40, 41, 92]).toString('latin1') + 'endstream inside';
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    '<< /Length ' + content.length + ' >>\nstream\n' + content + '\nendstream',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Producer (jsPDF 4.2.1) /Title (Statement \\(test\\) \\\\ 2026) /CreationDate (D:20261014120000+02\'00\') >>',
    '<< /Length ' + bin.length + ' >>\nstream\n' + bin + '\nendstream'
  ];
  let out = '%PDF-1.3\n%\xBA\xDF\xAC\xE0\n';
  const offs = [];
  objs.forEach((o, i) => { offs.push(out.length); out += (i + 1) + ' 0 obj\n' + o + '\nendobj\n'; });
  const xref = out.length;
  out += 'xref\n0 ' + (objs.length + 1) + '\n0000000000 65535 f \n' + offs.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('');
  out += 'trailer\n<<\n/Size ' + (objs.length + 1) + '\n/Root 1 0 R\n/Info 6 0 R\n/ID [ <00112233445566778899AABBCCDDEEFF> <00112233445566778899AABBCCDDEEFF> ]\n>>\nstartxref\n' + xref + '\n%%EOF';
  return { bytes: Uint8Array.from(Buffer.from(out, 'latin1')), content, bin };
}

// ---- independent decryptor (node:crypto) -------------------------------------
function hash2B(pw, salt, udata) {
  let k = crypto.createHash('sha256').update(Buffer.concat([pw, salt, udata])).digest();
  let i = 0, e = null;
  while (i < 64 || e[e.length - 1] > i - 32) {
    const k1 = Buffer.concat(Array(64).fill(Buffer.concat([pw, k, udata])));
    const c = crypto.createCipheriv('aes-128-cbc', k.subarray(0, 16), k.subarray(16, 32)); c.setAutoPadding(false);
    e = Buffer.concat([c.update(k1), c.final()]);
    let sum = 0; for (let j = 0; j < 16; j++) sum += e[j];
    k = crypto.createHash(['sha256', 'sha384', 'sha512'][sum % 3]).update(e).digest();
    i++;
  }
  return k.subarray(0, 32);
}
function aes256cbcDecryptNoPad(key, iv, data) {
  const d = crypto.createDecipheriv('aes-256-cbc', key, iv); d.setAutoPadding(false);
  return Buffer.concat([d.update(data), d.final()]);
}
function aesDecrypt(fileKey, data) {
  const d = crypto.createDecipheriv('aes-256-cbc', fileKey, data.subarray(0, 16));
  return Buffer.concat([d.update(data.subarray(16)), d.final()]);
}
function hexOf(dict, name) { const m = new RegExp('/' + name + '\\s*<([0-9A-Fa-f]+)>').exec(dict); return m ? Buffer.from(m[1], 'hex') : null; }
function openWith(buf, password) {
  const s = buf.toString('latin1');
  const em = /\/Encrypt\s+(\d+)\s+0\s+R/.exec(s.slice(s.lastIndexOf('trailer')));
  if (!em) return { error: 'no /Encrypt' };
  const om = new RegExp('(?:^|\\n)' + em[1] + ' 0 obj\\s*(<<[\\s\\S]*?>>)\\s*endobj').exec(s);
  const enc = om[1];
  const U = hexOf(enc, 'U'), UE = hexOf(enc, 'UE'), O = hexOf(enc, 'O'), OE = hexOf(enc, 'OE'), Perms = hexOf(enc, 'Perms');
  const pw = Buffer.from(password, 'utf8').subarray(0, 127);
  let fileKey = null, who = null;
  if (hash2B(pw, O.subarray(32, 40), U).equals(O.subarray(0, 32))) {
    fileKey = aes256cbcDecryptNoPad(hash2B(pw, O.subarray(40, 48), U), Buffer.alloc(16), OE); who = 'owner';
  } else if (hash2B(pw, U.subarray(32, 40), Buffer.alloc(0)).equals(U.subarray(0, 32))) {
    fileKey = aes256cbcDecryptNoPad(hash2B(pw, U.subarray(40, 48), Buffer.alloc(0)), Buffer.alloc(16), UE); who = 'user';
  } else return { error: 'wrong password', enc };
  const d = crypto.createDecipheriv('aes-256-ecb', fileKey, null); d.setAutoPadding(false);
  const perms = Buffer.concat([d.update(Perms), d.final()]);
  return { who, fileKey, perms, enc, s };
}

(async function main() {
  console.log('pdf-aes:');
  const { bytes, content, bin } = samplePdf();
  const out = Buffer.from(await AES.encryptPdf(bytes, { userPassword: 's3cret-Paß' }));
  const s = out.toString('latin1');

  ok('PDF 2.0 header, trailer with /Encrypt and the original /ID', s.startsWith('%PDF-2.0') && /\/Encrypt \d+ 0 R/.test(s) && /\/ID \[\s*<00112233445566778899AABBCCDDEEFF>/i.test(s));
  ok('no plaintext left (content, Info title)', s.indexOf('Vermoegensaufstellung') < 0 && s.indexOf('Statement') < 0 && s.indexOf('jsPDF 4.2.1') < 0);
  const o = openWith(out, 's3cret-Paß');
  ok('Encrypt dict: /Standard, V 5, R 6, AESV3', !!o.enc && /\/Filter\s*\/Standard/.test(o.enc) && /\/V\s+5/.test(o.enc) && /\/R\s+6/.test(o.enc) && /\/CFM\s*\/AESV3/.test(o.enc), o.enc);
  ok('the user password opens it (Algorithm 2.B, UE)', o.who === 'user' && o.fileKey && o.fileKey.length === 32);
  ok('Perms decrypts to P, FFFFFFFF, T, "adb"', o.perms && o.perms.readInt32LE(0) === -4 && o.perms.readUInt32LE(4) === 0xffffffff && o.perms.toString('latin1', 8, 12) === 'Tadb', o.perms && o.perms.toString('hex'));
  ok('a wrong password does not open it', openWith(out, 'nope').error === 'wrong password');

  // Streams and strings decrypt back to the original bytes; xref offsets point at the objects.
  const objs = {};
  const re = /(?:^|\n)(\d+) 0 obj\n/g; let m;
  while ((m = re.exec(s))) objs[m[1]] = m.index + (s[m.index] === '\n' ? 1 : 0);
  const streamOf = (n) => {
    const at = objs[n]; const dictEnd = s.indexOf('stream\n', at);
    const len = parseInt(/\/Length (\d+)/.exec(s.slice(at, dictEnd))[1], 10);
    return out.subarray(dictEnd + 7, dictEnd + 7 + len);
  };
  ok('content stream decrypts to the original', aesDecrypt(o.fileKey, streamOf(4)).toString('latin1') === content);
  ok('binary stream (with "endstream" inside) decrypts to the original', aesDecrypt(o.fileKey, streamOf(7)).toString('latin1') === bin);
  const info = s.slice(objs[6], s.indexOf('endobj', objs[6]));
  const title = /\/Title\s*<([0-9a-f]+)>/i.exec(info);
  ok('Info strings are encrypted hex strings and decrypt to the original (escapes resolved)', !!title && aesDecrypt(o.fileKey, Buffer.from(title[1], 'hex')).toString('latin1') === 'Statement (test) \\ 2026', info);
  const xrefAt = parseInt(/startxref\s+(\d+)/.exec(s)[1], 10);
  const rows = s.slice(xrefAt).split('\n').filter((l) => / 00000 n $/.test(l)).map((l) => parseInt(l.slice(0, 10), 10));
  ok('xref offsets point at "N 0 obj"', s.slice(xrefAt, xrefAt + 4) === 'xref' && rows.length >= 8 && rows.every((off, i) => s.startsWith((i + 1) + ' 0 obj', off)), rows);
  ok('the owner password (if given) opens it too', openWith(Buffer.from(await AES.encryptPdf(bytes, { userPassword: 'u', ownerPassword: 'own' })), 'own').who === 'owner');
  let threw = false; try { await AES.encryptPdf(bytes, { userPassword: '' }); } catch (e) { threw = true; }
  ok('an empty password is refused', threw);
  ok('two runs give different keys (random salts and IVs)', Buffer.compare(out, Buffer.from(await AES.encryptPdf(bytes, { userPassword: 's3cret-Paß' }))) !== 0);

  // Independent reader: pdftotext (poppler or xpdf, when installed; `-v`
  // exits with 99 on xpdf, so only a missing binary means "not installed").
  const probe = require('child_process').spawnSync('pdftotext', ['-v'], { stdio: 'ignore' });
  const pdftotext = probe.error && probe.error.code === 'ENOENT' ? null : 'pdftotext';
  if (pdftotext) {
    const f = path.join(os.tmpdir(), 'maermin-aes-' + process.pid + '.pdf');
    fs.writeFileSync(f, out);
    let txt = '', bad = '';
    try { txt = require('child_process').execFileSync(pdftotext, ['-upw', 's3cret-Paß', f, '-'], { encoding: 'latin1' }); } catch (e) { txt = 'ERR ' + e.message; }
    try { require('child_process').execFileSync(pdftotext, ['-upw', 'wrong', f, '-'], { stdio: 'pipe' }); bad = 'opened'; } catch (e) { bad = 'refused'; }
    fs.unlinkSync(f);
    ok('pdftotext opens it with the password and reads the text', /Vermoegensaufstellung 2026/.test(txt), txt.slice(0, 200));
    ok('pdftotext refuses a wrong password', bad === 'refused');
  } else {
    console.log('  (pdftotext not installed: independent reader check skipped)');
  }

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed) process.exit(1);
})();
