// Regression test for the callback-number backstop in netlify/functions/zgloszenie.js
// Run: node scripts/test-normalize-phone.cjs
//
// Guards the production bug where the voice agent passed the parish's OWN number
// (caller-ID of a forwarded call) or spoken number-words as the callback number.
// Real cases taken from docs/voice-agent/call-log.md (08.06. Grzegorz, 12.06. Adela).
const { normalizePhone } = require('../netlify/functions/zgloszenie.js');

const cases = [
  // [input, expected, label]
  ['+49 30 7593 8358', '',                 'own KI/Twilio line (Grzegorz 08.06.) -> stripped'],
  ['0049 30 7593 8358', '',                'own KI line, 0049 form -> stripped'],
  ['030 7593 8358', '',                    'own KI line, national 030 form -> stripped'],
  ['+49 30 7524 080', '',                  'office forwarding line (caller-ID) -> stripped'],
  ['030 7524 080', '',                     'office line, national form -> stripped'],
  ['0152 043 14 717', '+49 15204314717',   'real dictated mobile (Sylwia) -> +49 text'],
  ['0176 2467 4094', '+49 17624674094',    'real dictated mobile -> +49 text'],
  // A2: poln. 9-stellige Nummern (ohne 0/+48-Präfix) wurden bisher roh durchgereicht
  //     -> phone_usable=false -> Buchstabier-Schleifen (echte Fälle 27.06. Krise / Chrzest).
  ['736 354 227', '+48 736354227',         'PL national 9-digit mobile -> +48'],
  ['519 200 100', '+48 519200100',         'PL national 9-digit (kein Präfix) -> +48'],
  ['+48 736 354 227', '+48 736354227',     'PL bereits +48 -> bleibt +48 (Regression-Guard)'],
  ['dwadzieścia trzy', 'dwadzieścia trzy', 'number-words pass through unchanged (agent must fix, not backstop)'],
  ['', '',                                 'empty stays empty'],
  // A3 (28.08.2026): Seit die KI bei jedem Anruf aktiv nach der Rueckrufnummer
  // fragt, ist DAS der haeufigste Fall — und er fiel bisher durch. Anrufer
  // diktieren "eins fuenf zwei ..." ohne die fuehrende Null. Echter Fall vom
  // 21.08.: ein Anrufer wollte einen Priester nach Hause und hat seine Nummer
  // in vier Anlaeufen diktiert, keiner wurde gespeichert.
  ['15226634489', '+49 15226634489',       'DE-Mobil ohne fuehrende 0 (echter Fall 21.08.) -> +49'],
  ['152 266 34489', '+49 15226634489',     'dito, mit Leerzeichen gruppiert'],
  ['1722345678', '+49 1722345678',         'DE-Mobil 10-stellig ohne 0 -> +49'],
  ['17612345678', '+49 17612345678',       'DE-Mobil 11-stellig ohne 0 -> +49'],
  ['16098765432', '+49 16098765432',       'DE-Mobil Vorwahl 160 ohne 0 -> +49'],
  // Abgrenzung: 9-stellig bleibt polnisch, 12-stellig ist Muell (Fehlhoerer).
  ['736354227', '+48 736354227',           'PL 9-stellig bleibt +48 (Regression-Guard)'],
  ['952266344489', '952266344489',         '12-stellig (Verhoerer) -> unveraendert, Agent muss nachfragen'],
];

let fail = 0;
for (const [input, expected, label] of cases) {
  const got = normalizePhone(input);
  const ok = got === expected;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${JSON.stringify(input)} -> ${JSON.stringify(got)}`
    + `${ok ? '' : `  (expected ${JSON.stringify(expected)})`}  [${label}]`);
}
console.log(`\n${cases.length - fail}/${cases.length} passed`);
process.exit(fail ? 1 : 0);
