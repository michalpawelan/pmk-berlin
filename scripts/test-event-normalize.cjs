// Regression test for the event-feed text normalizer in netlify/functions/agent-events.js
// Run: node scripts/test-event-normalize.cjs
// Guards the production bug where stale Sheet event descriptions leaked the OLD
// postal code 12049 (correct is 10965) and a dead /events.html link into the
// voice/chat agent output (verified in 3 chat conversations, 2026-06-24).
const { normalizeEventText } = require('../netlify/functions/agent-events.js');

const cases = [
  // [input, expected, label]
  ['Lilienthalstraße 5, 12049 Berlin', 'Lilienthalstraße 5, 10965 Berlin', 'old PLZ -> 10965'],
  ['…, 10965 Berlin', '…, 10965 Berlin',                                     'correct PLZ untouched'],
  ['Mehr: https://www.pmk-berlin.de/events.html heute', 'Mehr: https://www.pmk-berlin.de/events heute', 'dead .html link -> clean'],
  ['siehe /events.html', 'siehe /events',                                    'relative .html link -> clean'],
  ['Festyn am 21.06.', 'Festyn am 21.06.',                                    'unrelated text untouched'],
  ['', '',                                                                    'empty stays empty'],
];

let fail = 0;
for (const [input, expected, label] of cases) {
  const got = normalizeEventText(input);
  const ok = got === expected;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${JSON.stringify(input)} -> ${JSON.stringify(got)}`
    + `${ok ? '' : `  (expected ${JSON.stringify(expected)})`}  [${label}]`);
}
console.log(`\n${cases.length - fail}/${cases.length} passed`);
process.exit(fail ? 1 : 0);
