// Regression test for the agent-events tool response (netlify/functions/agent-events.js)
// Run: node scripts/test-agent-events.cjs
// Guards the production bug found in the 2026-10-08 audit: both agents passed a
// date or "msza" as query, the text filter matched nothing (8/8 empty), and the
// model read the empty list as "there is no Mass today" — while the feed never
// contains regular Masses at all. Three chats and two calls told people a
// regular weekday/Sunday Mass did not exist.
const mod = require('../netlify/functions/agent-events.js');
const { buildResponseBody } = mod;

const EVENTS = [
  { title: 'Katecheza dla maluszków', date: '2026-10-10', date_human: '10 października 2026', weekday: 'sobota',
    time: '10:00', location: 'Johannes-Basilika', address: 'Lilienthalstraße 5, 10965 Berlin', description: 'Różaniec dla dzieci' },
  { title: 'Październik w Polskiej Misji Katolickiej', date: '2026-10-31', date_human: '31 października 2026', weekday: 'sobota',
    time: '10:00', location: 'Johannes-Basilika', address: 'Lilienthalstraße 5, 10965 Berlin', description: 'Zapraszamy' },
];

let fail = 0;
function check(label, ok, detail) {
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  -> ${detail}`}`);
}
const titles = b => b.events.map(e => e.title).join(' | ');

if (typeof buildResponseBody !== 'function') {
  check('buildResponseBody is exported', false, 'not a function');
} else {
  let b = buildResponseBody(EVENTS, { query: '2026-10-10', limit: 10 });
  check('ISO date query returns the event on that day', b.count === 1 && b.events[0].date === '2026-10-10', titles(b));
  check('ISO date query reports query_matched=true', b.query_matched === true, String(b.query_matched));

  b = buildResponseBody(EVENTS, { query: '31.10.', limit: 10 });
  check('DD.MM. date query returns the event on that day', b.count === 1 && b.events[0].date === '2026-10-31', titles(b));

  b = buildResponseBody(EVENTS, { query: '2026-09-22', limit: 10 });
  check('date without event falls back to all upcoming events', b.count === 2, titles(b));
  check('date without event reports query_matched=false', b.query_matched === false, String(b.query_matched));

  b = buildResponseBody(EVENTS, { query: 'msza', limit: 10 });
  check('text query without match falls back to all upcoming events', b.count === 2, titles(b));
  check('text query without match reports query_matched=false', b.query_matched === false, String(b.query_matched));

  b = buildResponseBody(EVENTS, { query: 'katecheza', limit: 10 });
  check('matching text query filters', b.count === 1 && /Katecheza/.test(b.events[0].title), titles(b));

  b = buildResponseBody(EVENTS, { query: '', limit: 10 });
  check('no query returns all events', b.count === 2, titles(b));
  check('no query has no query_matched flag', b.query_matched === undefined, String(b.query_matched));

  b = buildResponseBody(EVENTS, { query: '', limit: 1 });
  check('limit is respected', b.count === 1, titles(b));

  // Wochentag fuer ein abgefragtes Datum — auch wenn an dem Tag KEIN Sondertermin ist.
  // Der Prompt verbietet der KI, Wochentage selbst zu rechnen; bisher kam der
  // Wochentag nur fuer Tage mit Termin zurueck.
  const TODAY = new Date('2026-10-08T12:00:00Z');
  b = buildResponseBody(EVENTS, { query: '2026-10-13', lang: 'pl', today: TODAY });
  check('date query returns requested_date with PL weekday', b.requested_date && b.requested_date.date === '2026-10-13'
    && b.requested_date.weekday === 'wtorek', JSON.stringify(b.requested_date));
  b = buildResponseBody(EVENTS, { query: '2026-10-13', lang: 'de', today: TODAY });
  check('date query returns requested_date with DE weekday', b.requested_date && b.requested_date.weekday === 'Dienstag',
    JSON.stringify(b.requested_date));
  b = buildResponseBody(EVENTS, { query: '13.10.', lang: 'pl', today: TODAY });
  check('DD.MM. without event resolves to the next such date', b.requested_date && b.requested_date.date === '2026-10-13',
    JSON.stringify(b.requested_date));
  b = buildResponseBody(EVENTS, { query: '05.01.', lang: 'pl', today: TODAY });
  check('DD.MM. already past this year resolves to next year', b.requested_date && b.requested_date.date === '2027-01-05'
    && b.requested_date.weekday === 'wtorek', JSON.stringify(b.requested_date));
  b = buildResponseBody(EVENTS, { query: 'msza', lang: 'pl', today: TODAY });
  check('text query has no requested_date', b.requested_date === undefined, JSON.stringify(b.requested_date));

  b = buildResponseBody([], { query: '2026-10-12', limit: 10 });
  check('empty feed still answers with count 0', b.count === 0, String(b.count));
  const note = String(b.note || '');
  check('note says regular Masses are not in this feed', /regular Mass/i.test(note) && /NOT/.test(note), note);
  check('note says an empty result never means no Mass', /never means there is no Mass/i.test(note), note);
}

console.log(`\n${fail ? 'FAILED' : 'all passed'} (${fail} failing)`);
process.exit(fail ? 1 : 0);
