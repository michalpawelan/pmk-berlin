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

// Ein zugesagter Rueckruf ist ein Versprechen, das die Pfarrei faktisch nicht
// haelt (Audit 20.08.: 115 von 117 Tickets unbearbeitet). Entscheidung des
// Users am 21.08.: NIE einen Rueckruf zusagen, auch nicht mit Nummer. Die KI
// sagt nur zu, dass sie das Anliegen weiterleitet. Die Nummer wird weiterhin
// erfasst, damit die Pfarrei ueberhaupt jemanden erreichen KANN.
const PROMISE_RE = /oddzwonimy|oddzwoni\b|rufen sie|rufen wir|zurückrufen|zurueckrufen|melden uns/i;
const FORWARD_RE = /przekaz|weiterleit|weitergeleitet|leite/i;

const cases = [
  {
    label: 'PL, Nummer verwertbar -> KEINE Rueckruf-Zusage, nur Weiterleitung',
    input: { phoneProvided: true, phoneUsable: true, phoneSource: 'dictated', lang: 'pl' },
    expect: (r) => !PROMISE_RE.test(r.message) && FORWARD_RE.test(r.message)
      && !r.phone_warning && !r.next_action,
  },
  {
    label: 'PL, Caller-ID war die eigene Bueronummer -> keine Zusage, Agent muss Nummer erfragen',
    input: { phoneProvided: false, phoneUsable: false, phoneSource: '', lang: 'pl' },
    expect: (r) => !PROMISE_RE.test(r.message) && /numer/i.test(r.message)
      && typeof r.next_action === 'string' && /create_zgloszenie/.test(r.next_action)
      && typeof r.phone_warning === 'string',
  },
  {
    label: 'PL, Anrufer diktierte unbrauchbare Nummer -> erneut erfragen, keine Zusage',
    input: { phoneProvided: true, phoneUsable: false, phoneSource: '', lang: 'pl' },
    expect: (r) => !PROMISE_RE.test(r.message)
      && /ponownie|cyfra/i.test(r.phone_warning || '')
      && typeof r.next_action === 'string',
  },
  {
    label: 'DE, keine Nummer -> nach Nummer fragen, keine Zusage',
    input: { phoneProvided: false, phoneUsable: false, phoneSource: '', lang: 'de' },
    expect: (r) => !PROMISE_RE.test(r.message) && /nummer/i.test(r.message),
  },
  {
    label: 'DE, Nummer verwertbar -> Weiterleitung zusagen, NICHT den Rueckruf',
    input: { phoneProvided: true, phoneUsable: true, phoneSource: 'caller_id', lang: 'de' },
    expect: (r) => !PROMISE_RE.test(r.message) && FORWARD_RE.test(r.message),
  },
  {
    label: 'ohne lang -> faellt auf Polnisch zurueck, nie eine Zusage',
    input: { phoneProvided: false, phoneUsable: false, phoneSource: '', lang: '' },
    expect: (r) => !PROMISE_RE.test(r.message) && /numer/i.test(r.message),
  },
  {
    label: 'KEINE Variante darf je einen Rueckruf zusagen',
    input: null,
    expect: () => [
      { phoneProvided: true, phoneUsable: true, lang: 'pl' },
      { phoneProvided: true, phoneUsable: true, lang: 'de' },
      { phoneProvided: false, phoneUsable: false, lang: 'pl' },
      { phoneProvided: false, phoneUsable: false, lang: 'de' },
      { phoneProvided: true, phoneUsable: false, lang: 'pl' },
    ].every((i) => {
      const r = require('../netlify/functions/zgloszenie.js').buildToolResponse(i);
      return !PROMISE_RE.test([r.message, r.phone_warning, r.next_action].filter(Boolean).join(' '));
    }),
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
    got = input ? buildToolResponse(input) : null;
    ok = !!expect(got);
  } catch (e) {
    got = `THREW ${e.message}`;
  }
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) console.log(`      got: ${JSON.stringify(got)}`);
}
console.log(`\n${cases.length - fail}/${cases.length} passed`);

// --------------------------------------------------------- Zeitbudget (29.08.)
// Mail und Sheet-Eintrag laufen jetzt parallel, und der Mailversand hat ein
// Budget. Grund: nacheinander riss die Summe Netlifys Function-Timeout, der
// Agent bekam 504 und sagte dem Anrufer "hat nicht geklappt" — obwohl Ticket
// und Mail draussen waren (21.08. Priesterbesuch, 13.08. obdachloser Anrufer).
const { withTimeout } = require('../netlify/functions/zgloszenie.js');
const slow = (ms, v) => new Promise(r => setTimeout(() => r(v), ms));
(async () => {
  let f = 0;
  const t = async (label, cond) => { const ok = await cond; if (!ok) { f++; console.log(`FAIL  ${label}`); } else console.log(`PASS  ${label}`); };

  await t('withTimeout: schnelle Antwort kommt durch',
    withTimeout(slow(10, { sent: true }), 200, { sent: false }).then(r => r.sent === true));
  await t('withTimeout: haengender Versand liefert den Fallback',
    withTimeout(slow(500, { sent: true }), 60, { sent: false, reason: 'smtp_timeout' })
      .then(r => r.sent === false && r.reason === 'smtp_timeout'));
  await t('withTimeout: Fehler kippt die Function nicht',
    withTimeout(Promise.reject(new Error('boom')), 200, { sent: false })
      .then(r => r.sent === false && /boom/.test(r.detail || '')));
  await t('withTimeout: haelt das Budget wirklich ein',
    (async () => { const s = Date.now();
      await withTimeout(slow(2000, {}), 80, { sent: false });
      return Date.now() - s < 900; })());

  console.log(f === 0 ? '\nZeitbudget: alle Tests gruen' : `\nZeitbudget: ${f} FEHLER`);
  process.exit((f + fail) ? 1 : 0);
})();
