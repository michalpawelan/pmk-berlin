// Regression test for the tool response that create_zgloszenie hands back to the
// ElevenLabs agent. Run: node scripts/test-zgloszenie-response.cjs
//
// Hintergrund (Audit 20.08.2026): Seit dem 03.08. kommt bei JEDEM Anruf die
// eigene Bueronummer +49 30 752 40 80 als Caller-ID an. Sie steht auf
// OWN_NUMBERS und wird verworfen -> phone_usable=false, phone_provided=false.
// Die Function schickte trotzdem unveraendert "Oddzwonimy najszybciej, jak to
// mozliwe." zurueck, der Agent las das vor, und die Pfarrei bekam 7 Tickets
// ohne jede Rueckrufnummer. Die alte phone_warning griff nur, wenn der Anrufer
// selbst eine unbrauchbare Nummer diktiert hatte — also genau im haeufigsten
// Fall nicht.
//
// Kernregel, die dieser Test bewacht: ohne verwertbare Nummer darf in der
// message NIE eine Rueckruf-Zusage stehen.
const { buildToolResponse } = require('../netlify/functions/zgloszenie.js');

const PROMISE_RE = /oddzwonimy|rufen sie|rufen wir|zurückrufen|zurueckrufen/i;

const cases = [
  {
    label: 'PL, Nummer verwertbar -> Rueckruf-Zusage erlaubt (Regression-Guard)',
    input: { phoneProvided: true, phoneUsable: true, phoneSource: 'dictated', lang: 'pl' },
    expect: (r) => PROMISE_RE.test(r.message) && !r.phone_warning && !r.next_action,
  },
  {
    label: 'PL, Caller-ID war die eigene Bueronummer -> KEINE Zusage, Agent muss fragen',
    input: { phoneProvided: false, phoneUsable: false, phoneSource: '', lang: 'pl' },
    expect: (r) => !PROMISE_RE.test(r.message) && /numer/i.test(r.message)
      && typeof r.next_action === 'string' && /create_zgloszenie/.test(r.next_action)
      && typeof r.phone_warning === 'string',
  },
  {
    label: 'PL, Anrufer diktierte unbrauchbare Nummer -> KEINE Zusage, erneut erfragen',
    input: { phoneProvided: true, phoneUsable: false, phoneSource: '', lang: 'pl' },
    expect: (r) => !PROMISE_RE.test(r.message)
      && /ponownie|cyfra/i.test(r.phone_warning || '')
      && typeof r.next_action === 'string',
  },
  {
    label: 'DE, keine Nummer -> deutsche Aufforderung, keine Zusage',
    input: { phoneProvided: false, phoneUsable: false, phoneSource: '', lang: 'de' },
    expect: (r) => !PROMISE_RE.test(r.message) && /nummer/i.test(r.message),
  },
  {
    label: 'DE, Nummer verwertbar -> deutsche Zusage erlaubt',
    input: { phoneProvided: true, phoneUsable: true, phoneSource: 'caller_id', lang: 'de' },
    expect: (r) => /rufen/i.test(r.message),
  },
  {
    label: 'ohne lang -> faellt auf Polnisch zurueck, Zusage nur bei Nummer',
    input: { phoneProvided: false, phoneUsable: false, phoneSource: '', lang: '' },
    expect: (r) => !PROMISE_RE.test(r.message) && /numer/i.test(r.message),
  },
  {
    label: 'message ist immer vorhanden und nicht leer',
    input: { phoneProvided: false, phoneUsable: true, phoneSource: 'caller_id', lang: 'pl' },
    expect: (r) => typeof r.message === 'string' && r.message.trim().length > 0,
  },
];

let fail = 0;
for (const { label, input, expect } of cases) {
  let got, ok = false;
  try {
    got = buildToolResponse(input);
    ok = !!expect(got);
  } catch (e) {
    got = `THREW ${e.message}`;
  }
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) console.log(`      got: ${JSON.stringify(got)}`);
}
console.log(`\n${cases.length - fail}/${cases.length} passed`);
process.exit(fail ? 1 : 0);
