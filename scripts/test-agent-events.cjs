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

  // Aktuelle Ogloszenia im Werkzeug (09.10.2026): Im Wissensabruf landeten die
  // Aushaenge hinter der FAQ (Platz 5-8 bei 3 Plaetzen) — "Mama w akcji" oder
  // "Oaza 21+" fand die KI nie. Das Werkzeug ruft sie aber bei jeder solchen Frage auf.
  const ANN = [
    { current: true, publishedAt: new Date('2026-10-05T07:45:00Z'), expiresAt: new Date('2026-10-12T07:45:00Z'),
      title: 'XXVII niedziela zwykła (04.10.2026)', body: '7. W środę 14 października o godz. 9:30 warsztaty „Mama w akcji”.' },
    { current: false, publishedAt: new Date('2026-09-21T07:00:00Z'), expiresAt: new Date('2026-09-28T07:00:00Z'),
      title: 'XXV niedziela zwykła (20.09.2026)', body: 'Kurs Emaus 2–4 października.' },
  ];
  b = buildResponseBody(EVENTS, { query: '', announcements: ANN });
  check('announcements: Aushaenge stehen in der Antwort', Array.isArray(b.announcements) && b.announcements.length === 2,
    JSON.stringify(b.announcements));
  check('announcements: aktueller zuerst, mit Text und Gueltigkeit', b.announcements && b.announcements[0].current === true
    && /Mama w akcji/.test(b.announcements[0].text) && b.announcements[0].valid_until === '2026-10-12', JSON.stringify(b.announcements && b.announcements[0]));
  check('announcements: Hinweis auf Aushangdatum', /date of the bulletin|week of the bulletin/i.test(b.announcements_note || ''), b.announcements_note);
  b = buildResponseBody(EVENTS, { query: 'msza' });
  check('announcements: ohne Aushaenge kein leeres Feld', b.announcements === undefined, JSON.stringify(b.announcements));

  // Code-Review 09.10.2026: Datumspruefung und Berliner Zeit.
  b = buildResponseBody(EVENTS, { query: '31.02.', today: TODAY });
  check('ungueltiges Datum 31.02. wird nicht als Datum behandelt', b.requested_date === undefined, JSON.stringify(b.requested_date));
  b = buildResponseBody(EVENTS, { query: '10.10', today: TODAY });
  check('DD.MM ohne Schlusspunkt wird als Datum erkannt', b.requested_date && b.requested_date.date === '2026-10-10', JSON.stringify(b.requested_date));
  b = buildResponseBody(EVENTS, { query: '10.10.26', today: TODAY });
  check('DD.MM.YY wird als Datum erkannt', b.requested_date && b.requested_date.date === '2026-10-10', JSON.stringify(b.requested_date));
  b = buildResponseBody(EVENTS, { query: '10.1026', today: TODAY });
  check('"10.1026" (Jahr ohne Punkt) ist kein Datum', b.requested_date === undefined, JSON.stringify(b.requested_date));
  const NEWYEAR = new Date('2026-12-31T23:30:00Z'); // Berlin: 1. Januar 2027, 00:30
  b = buildResponseBody(EVENTS, { query: '01.01.', today: NEWYEAR });
  check('Berliner Zeit: "01.01." kurz nach Mitternacht ist HEUTE, nicht naechstes Jahr', b.requested_date && b.requested_date.date === '2027-01-01', JSON.stringify(b.requested_date));
  b = buildResponseBody(EVENTS, { query: '31.12.', today: NEWYEAR });
  check('Berliner Zeit: "31.12." ist nach Mitternacht schon vorbei -> naechstes Jahr', b.requested_date && b.requested_date.date === '2027-12-31', JSON.stringify(b.requested_date));
  b = buildResponseBody(EVENTS, { query: '', announcements: [{ current: true, publishedAt: new Date('2026-10-04T22:30:00Z'),
    expiresAt: new Date('2026-10-11T22:30:00Z'), title: 't', body: 'x' }] });
  check('Berliner Zeit: Aushangdatum 00:30 Berlin = 5. Oktober', b.announcements && b.announcements[0].published === '2026-10-05', JSON.stringify(b.announcements));
  const { enrich } = mod;
  const late = enrich([{ title: 'Gestern', date: '2026-10-09', description: '', location: '', address: '' }], 'pl', new Date('2026-10-09T23:30:00Z'));
  check('Berliner Zeit: Termin von gestern ist um 01:30 nicht mehr "kommend"', Array.isArray(late) && late.length === 0, JSON.stringify(late));

  b = buildResponseBody([], { query: '2026-10-12', limit: 10 });
  check('empty feed still answers with count 0', b.count === 0, String(b.count));
  const note = String(b.note || '');
  check('note says regular Masses are not in this feed', /regular Mass/i.test(note) && /NOT/.test(note), note);
  check('note says an empty result never means no Mass', /never means there is no Mass/i.test(note), note);
}

// Handler: holt Termine UND Aushaenge; faellt der Aushang-Tab aus, liefert das
// Werkzeug trotzdem die Termine (der Agent darf nie ohne Antwort dastehen).
(async () => {
  const gviz = rows => 'google.visualization.Query.setResponse(' + JSON.stringify({ table: { rows } }) + ');';
  const EV = gviz([{ c: [{ v: 'Koncert' }, { v: 'Date(2099,0,10)' }, null, { v: 'opis' }, null, { v: 'Bazylika' }, { v: 'adres' }, { v: 'TAK' }] }]);
  const OG = gviz([{ c: [{ v: 'x' }, { v: 'XXVII niedziela zwykła' }, { v: JSON.stringify([{ t: 'txt', c: 'Warsztaty „Mama w akcji” 14.10.' }]) },
    null, { v: new Date(Date.now() - 86400000).toISOString() }, { v: new Date(Date.now() + 5 * 86400000).toISOString() }, { v: 'TAK' }] }]);
  let ogFails = false;
  global.fetch = async (url) => {
    const isOg = /sheet=Ogloszenia/.test(String(url));
    if (isOg && ogFails) throw new Error('down');
    return { ok: true, status: 200, text: async () => (isOg ? OG : EV) };
  };
  const fresh = () => { delete require.cache[require.resolve('../netlify/functions/agent-events.js')]; return require('../netlify/functions/agent-events.js'); };
  let r = await fresh().handler({ queryStringParameters: { lang: 'pl' } });
  let bd = JSON.parse(r.body);
  check('handler: Termine und aktueller Aushang in einer Antwort', r.statusCode === 200 && bd.count === 1
    && bd.announcements && /Mama w akcji/.test(bd.announcements[0].text), r.body.slice(0, 300));
  ogFails = true;
  r = await fresh().handler({ queryStringParameters: { lang: 'pl' } });
  bd = JSON.parse(r.body);
  check('handler: Aushang-Tab faellt aus -> Termine trotzdem da', r.statusCode === 200 && bd.count === 1 && bd.announcements === undefined, r.body.slice(0, 300));

  // Code-Review 09.10.2026: ein HAENGENDER Aushang-Abruf darf das Werkzeug nicht blockieren.
  process.env.AGENT_EVENTS_ANN_BUDGET_MS = '200';
  ogFails = false;
  global.fetch = async (url) => {
    if (/sheet=Ogloszenia/.test(String(url))) return new Promise(() => {}); // haengt fuer immer
    return { ok: true, status: 200, text: async () => EV };
  };
  const m2 = fresh();
  let t0 = Date.now(); r = await m2.handler({ queryStringParameters: { lang: 'pl' } }); let ms = Date.now() - t0;
  bd = JSON.parse(r.body);
  check('handler: haengender Aushang-Abruf -> Termine nach kurzem Budget', r.statusCode === 200 && bd.count === 1 && ms < 1000, `${r.statusCode} ${ms} ms`);
  t0 = Date.now(); r = await m2.handler({ queryStringParameters: { lang: 'pl' } }); ms = Date.now() - t0;
  check('handler: Fehlschlag wird kurz gemerkt -> zweiter Aufruf wartet nicht erneut', r.statusCode === 200 && ms < 150, `${ms} ms`);

  // Re-Review 09.10.2026: Ein LANGSAMER (nicht kaputter) Abruf soll den Zwischenspeicher
  // trotzdem fuellen, damit der naechste Aufruf die Aushaenge hat.
  global.fetch = async (url) => {
    if (/sheet=Ogloszenia/.test(String(url))) { await new Promise(r2 => setTimeout(r2, 400)); return { ok: true, status: 200, text: async () => OG }; }
    return { ok: true, status: 200, text: async () => EV };
  };
  const m3 = fresh();
  r = await m3.handler({ queryStringParameters: { lang: 'pl' } });
  check('handler: langsamer Abruf -> erste Antwort ohne Aushaenge, aber rechtzeitig', r.statusCode === 200 && JSON.parse(r.body).announcements === undefined, r.body.slice(0, 120));
  await new Promise(r2 => setTimeout(r2, 400));
  r = await m3.handler({ queryStringParameters: { lang: 'pl' } });
  check('handler: ... der laufende Abruf fuellt den Zwischenspeicher fuer den naechsten Aufruf', (JSON.parse(r.body).announcements || []).length === 1, r.body.slice(0, 160));
  console.log(`\n${fail ? 'FAILED' : 'all passed'} (${fail} failing)`);
  process.exit(fail ? 1 : 0);
})();
