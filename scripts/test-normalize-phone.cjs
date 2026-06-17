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
  ['dwadzieścia trzy', 'dwadzieścia trzy', 'number-words pass through unchanged (agent must fix, not backstop)'],
  ['', '',                                 'empty stays empty'],
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
