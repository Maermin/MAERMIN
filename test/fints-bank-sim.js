// A synthetic FinTS 3.0 bank (PIN/TAN) for the Node tests and the e2e run of
// P5-3.4. It answers the messages fints.js builds the way a German bank does:
// first contact (HKSYN → system id, TAN methods), a dialog with strong
// authentication (pushTAN = decoupled polling, or a TAN entered), SEPA
// accounts, balance, transactions (MT940, two pages with a touchdown point)
// and a depot statement (MT535). All data is made up.
'use strict';
const F = require('../fints.js');

const MT940_PAGES = [
  [':20:STARTUMSE', ':25:12030000/1234567890', ':28C:00000/001', ':60F:C250101EUR1000,00',
    ':61:2501150115D50,00NMSCNONREF', ':86:177?00SEPA-UEBERWEISUNG?20Miete Januar?32Max Mustermann',
    ':61:2501200120C1500,00NMSCNONREF', ':86:166?00GUTSCHRIFT?20Gehalt Januar?32Firma GmbH', ''].join('\r\n'),
  [':61:2501310131D4,90NMSCNONREF', ':86:805?00ENTGELT?20Kontofuehrung Januar',
    ':61:2502030203D25,00NMSCNONREF', ':86:191?00KAPITALERTRAGSTEUER?20Steuer auf Ertrag',
    ':62F:C250203EUR2420,10', '-'].join('\r\n')
];
const MT535 = [':16R:GENL', ':98A::PREP//20250203', ':16S:GENL',
  ':16R:FIN', ':35B:ISIN DE0005933931/DE/593393', 'iShares Core DAX UCITS', 'ETF (DE)', ':90B::MRKT//ACTU/EUR139,52', ':98A::PRIC//20250131', ':93B::AGGR//UNIT/12,', ':19A::HOLD//EUR1674,24', ':16S:FIN',
  ':16R:FIN', ':35B:ISIN US0378331005/DE/865985', 'Apple Inc.', ':90B::MRKT//ACTU/EUR210,', ':98A::PRIC//20250131', ':93B::AGGR//UNIT/3,5', ':19A::HOLD//EUR735,', ':16S:FIN',
  ':16R:ADDINFO', ':16S:ADDINFO', '-'].join('\r\n');

function createBank(opts) {
  opts = Object.assign({ blz: '12030000', user: 'demo-user', pin: '4711', tan: '123456', decoupled: true, pendingPolls: 2, kazNeedsTan: false }, opts || {});
  const st = { dialogs: 0, polls: 0, authorized: {}, log: [], pendingTask: null, kazAuthorized: false };
  let dialogSeq = 0;

  function respond(dialogId, msgNo, segs) {
    // number the inner segments, wrap them like a bank (HNVSD), add head and tail
    let n = 2;
    const inner = segs.map((s) => s.replace('{n}', String(++n))).join("'") + "'";
    const env = "HNVSK:998:3+PIN:2+998+1+2::sys+1:20250203:120000+2:2:13:@8@00000000:5:1+280:" + opts.blz + ':' + opts.user + ":V:0:0+0'" + 'HNVSD:999:1+' + F.bin(inner) + "'";
    const tail = 'HNHBS:' + (n + 1) + ':1+' + msgNo + "'";
    const head = (size) => 'HNHBK:1:3+' + String(size).padStart(12, '0') + '+300+' + dialogId + '+' + msgNo + '+' + dialogId + ':' + msgNo + "'";
    const size = head(0).length + env.length + tail.length;
    return head(size) + env + tail;
  }
  const rmg = (code, text) => 'HIRMG:{n}:2+' + code + '::' + text;
  const rms = (ref, list) => 'HIRMS:{n}:2:' + ref + '+' + list.map((x) => x.join(':')).join('+');

  return {
    state: st,
    MT940_PAGES, MT535,
    handle(text) {
      st.log.push(text);
      const segs = F.unwrap(F.parse(text));
      const by = (t) => segs.find((s) => s.type === t);
      const head = by('HNHBK'), sha = by('HNSHA'), shk = by('HNSHK');
      const msgNo = head.des[3][0];
      let dialogId = head.des[2][0];
      const pin = sha && sha.des[2] ? sha.des[2][0] : '', tan = sha && sha.des[2] ? sha.des[2][1] : '';
      const secFunc = shk ? shk.des[1][0] : '999';
      const user = (by('HKIDN') || { des: [[], ['']] }).des[1][0];
      if (pin !== opts.pin) return respond(dialogId === '0' ? 'D-ERR' : dialogId, msgNo, [rmg('9910', 'PIN falsch')]);
      if (by('HKIDN') && user !== opts.user) return respond('D-ERR', msgNo, [rmg('9931', 'Zugang gesperrt')]);
      const out = [];
      const nr = (t) => (by(t) || {}).no;
      if (by('HKIDN')) { st.dialogs++; dialogId = 'DLG' + (++dialogSeq); }
      const bpd = () => [
        'HIBPA:{n}:3:4+0+280:' + opts.blz + '+Synthetische Testbank+0+1+300+500',
        "HITANS:{n}:6:4+1+1+1+J:N:0:942:2:pushTAN:Decoupled::pushTAN 2.0:6:1:TAN-Nummer:999:N:1:N:0:2:N:J:00:2:N:2:0:921:2:smsTAN:::SMS-TAN:6:1:TAN:999:N:1:N:0:2:N:J:00:2:N:2:0",
        'HIPINS:{n}:1:4+1+1+0+5:20:6:Kunden ID::HKSPA:N:HKSAL:N:HKKAZ:' + (opts.kazNeedsTan ? 'J' : 'N') + ':HKWPD:N:HKTAN:N',
        'HIUPD:{n}:6:4+1234567890::280:' + opts.blz + '+DE02120300000000202051+' + opts.user + '+1+EUR+Erika Mustermann++Girokonto++HKSAL:1+HKKAZ:1+HKSPA:1',
        'HIUPD:{n}:6:4+9876543::280:' + opts.blz + '++' + opts.user + '+30+EUR+Erika Mustermann++Depot++HKWPD:1'
      ];
      if (by('HKSYN')) {
        out.push(rmg('0010', 'Nachricht entgegengenommen'), rms(nr('HKIDN'), [['0020', '', 'Auftrag ausgefuehrt'], ['3920', '', 'Zugelassene TAN-Verfahren', '942', '921']]));
        out.push(...bpd(), 'HISYN:{n}:4:' + nr('HKSYN') + '+SYS-' + opts.user);
        return respond(dialogId, msgNo, out);
      }
      if (by('HKEND')) return respond(dialogId, msgNo, [rmg('0100', 'Dialog beendet')]);
      const hktan = by('HKTAN');
      if (hktan && hktan.des[0][0] === 'S') {
        st.polls++;
        if (st.polls <= opts.pendingPolls) return respond(dialogId, msgNo, [rmg('3060', 'Teilweise Warnungen'), rms(hktan.no, [['3956', '', 'Freigabe ausstehend']])]);
        st.authorized[dialogId] = true;
        const done = st.pendingTask; st.pendingTask = null; st.polls = 0;
        return respond(dialogId, msgNo, [rmg('0010', 'Nachricht entgegengenommen'), rms(hktan.no, [['0020', '', 'Freigabe erfolgt']])].concat(done ? done() : []));
      }
      if (hktan && hktan.des[0][0] === '2') {
        if (tan !== opts.tan) return respond(dialogId, msgNo, [rmg('9941', 'TAN ungueltig')]);
        st.authorized[dialogId] = true;
        const done = st.pendingTask; st.pendingTask = null;
        return respond(dialogId, msgNo, [rmg('0010', 'Nachricht entgegengenommen'), rms(hktan.no, [['0020', '', 'TAN korrekt']])].concat(done ? done() : []));
      }
      const challenge = (later) => {
        st.pendingTask = later;
        const ref = 'TASK-' + msgNo;
        if (opts.decoupled && secFunc === '942') return [rmg('3060', 'Bitte beachten'), rms(hktan.no, [['3955', '', 'Bitte in der App freigeben']]), 'HITAN:{n}:6:' + hktan.no + '+4++' + ref + '+Bitte bestaetigen Sie den Zugriff in Ihrer App'];
        return [rmg('3060', 'Bitte beachten'), rms(hktan.no, [['0030', '', 'TAN erforderlich']]), 'HITAN:{n}:6:' + hktan.no + '+4++' + ref + '+Bitte geben Sie die TAN aus der SMS ein'];
      };
      if (by('HKIDN')) {
        if (secFunc === '999' || !hktan) return respond(dialogId, msgNo, [rmg('9075', 'Starke Kundenauthentifizierung notwendig')]);
        return respond(dialogId, msgNo, [rmg('0010', 'Nachricht entgegengenommen'), rms(nr('HKIDN'), [['0020', '', 'Auftrag ausgefuehrt']])].concat(bpd(), challenge(null)));
      }
      if (!st.authorized[dialogId]) return respond(dialogId, msgNo, [rmg('9800', 'Dialog nicht autorisiert')]);
      if (by('HKSPA')) return respond(dialogId, msgNo, [rmg('0010', 'ok'), rms(nr('HKSPA'), [['0020', '', 'ok']]), 'HISPA:{n}:1:' + nr('HKSPA') + '+J:DE02120300000000202051:BYLADEM1001:1234567890::280:' + opts.blz]);
      if (by('HKSAL')) return respond(dialogId, msgNo, [rmg('0010', 'ok'), rms(nr('HKSAL'), [['0020', '', 'ok']]), 'HISAL:{n}:7:' + nr('HKSAL') + '+DE02120300000000202051:BYLADEM1001+Girokonto+EUR+C:2420,1:EUR:20250203']);
      const kaz = by('HKKAZ');
      if (kaz) {
        const touch = (kaz.des[5] || [])[0];
        const page = () => touch === 'P2'
          ? ['HIKAZ:{n}:7:' + kaz.no + '+' + F.bin(MT940_PAGES[1])]
          : ['HIKAZ:{n}:7:' + kaz.no + '+' + F.bin(MT940_PAGES[0])];
        const rets = () => [rms(kaz.no, touch === 'P2' ? [['0020', '', 'ok']] : [['3040', '', 'Weitere Umsaetze', 'P2']])];
        if (opts.kazNeedsTan && !touch && !st.kazAuthorized) {
          st.kazAuthorized = true;
          return respond(dialogId, msgNo, challenge(() => rets().concat(page())));
        }
        return respond(dialogId, msgNo, [rmg('0010', 'ok')].concat(rets(), page()));
      }
      if (by('HKWPD')) return respond(dialogId, msgNo, [rmg('0010', 'ok'), rms(nr('HKWPD'), [['0020', '', 'ok']]), 'HIWPD:{n}:6:' + nr('HKWPD') + '+' + F.bin(MT535)]);
      return respond(dialogId, msgNo, [rmg('9010', 'Unbekannter Auftrag')]);
    }
  };
}

module.exports = { createBank, MT940_PAGES, MT535 };
