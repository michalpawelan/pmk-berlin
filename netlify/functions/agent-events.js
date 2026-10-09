const SHEET_ID = process.env.GOOGLE_SHEET_ID || '1tPc4twR0CoefnHDoODo-a5opSK35ogDmZHyzB_uhb1w';
const SHEET_NAME = process.env.GOOGLE_SHEET_NAME || 'Tabellenblatt1';

const GVIZ_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json&sheet=${encodeURIComponent(SHEET_NAME)}&headers=1`;

const PL_WEEKDAYS = ['niedziela','poniedziałek','wtorek','środa','czwartek','piątek','sobota'];
const DE_WEEKDAYS = ['Sonntag','Montag','Dienstag','Mittwoch','Donnerstag','Freitag','Samstag'];

// Defensive Korrektur stale Daten aus den Sheet-Event-Beschreibungen:
// alte PLZ 12049 -> 10965 (sitewide-verifiziert), tote /events.html-Links -> /events.
// Greift unabhängig davon, was Admins ins Sheet tippen. Verifizierter Bug 2026-06-24.
function normalizeEventText(str) {
  return String(str == null ? '' : str)
    .replace(/\b12049\b/g, '10965')
    .replace(/events\.html/g, 'events');
}
exports.normalizeEventText = normalizeEventText;

function cellValue(cell) {
  if (!cell) return '';
  return cell.v ?? cell.f ?? '';
}

function parseSheetDate(cell) {
  if (!cell) return '';
  const raw = String(cell.v ?? '');
  const fmt = cell.f ?? '';
  const m = raw.match(/Date\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (m) return `${m[1]}-${String(+m[2]+1).padStart(2,'0')}-${String(+m[3]).padStart(2,'0')}`;
  const iso = String(fmt).match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return iso[0];
  const de = String(fmt).match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (de) return `${de[3]}-${de[2].padStart(2,'0')}-${de[1].padStart(2,'0')}`;
  return '';
}

function parseTime(cell) {
  if (!cell) return '';
  const raw = String(cell.v ?? '');
  const fmt = cell.f ?? '';
  const range = (fmt || raw).match(/(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/);
  if (range) {
    // Drop bogus ranges like "10:00-20:01" / "10:00-20:03" used as IDs
    const endMin = parseInt(range[2].split(':')[1], 10);
    if (endMin >= 0 && endMin <= 5) return '';
    return `${range[1]}-${range[2]}`;
  }
  const m = raw.match(/Date\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (m) return `${String(+m[1]).padStart(2,'0')}:${String(+m[2]).padStart(2,'0')}`;
  if (fmt && /\d{1,2}:\d{2}/.test(fmt)) return fmt;
  if (raw && /\d{1,2}:\d{2}/.test(raw)) return raw;
  return '';
}

function parseEvents(text) {
  const m = text.match(/google\.visualization\.Query\.setResponse\(([\s\S]*)\);?/);
  if (!m) throw new Error('Invalid gviz response');
  const data = JSON.parse(m[1]);
  const rows = data.table?.rows || [];
  const out = [];
  for (const row of rows) {
    if (!row.c?.[0]) continue;
    const published = String(cellValue(row.c[7])).toUpperCase();
    if (published === 'NIE') continue;
    const title = String(cellValue(row.c[0])).trim();
    const date = parseSheetDate(row.c[1]);
    if (!title || !date) continue;
    out.push({
      title: normalizeEventText(title),
      date,
      time: parseTime(row.c[2]),
      description: normalizeEventText(String(cellValue(row.c[3])).trim()),
      location: normalizeEventText(String(cellValue(row.c[5])).trim()) || 'Johannes-Basilika',
      address: normalizeEventText(String(cellValue(row.c[6])).trim()) || 'Lilienthalstraße 5, 10965 Berlin'
    });
  }
  return out;
}

// "Heute" ist der Kalendertag in Berlin, nicht in UTC (Netlify laeuft in UTC):
// zwischen 00:00 und 02:00 Berliner Zeit waere sonst noch "gestern".
const berlinDay = d => d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });

function enrich(events, lang, now = new Date()) {
  const today = berlinDay(now);
  const wd = lang === 'de' ? DE_WEEKDAYS : PL_WEEKDAYS;
  return events
    .filter(e => e.date >= today)
    .sort((a,b) => a.date.localeCompare(b.date))
    .map(e => {
      const d = new Date(`${e.date}T12:00:00Z`);
      return {
        ...e,
        weekday: wd[d.getUTCDay()],
        date_human: lang === 'de'
          ? d.toLocaleDateString('de-DE', { day:'numeric', month:'long', year:'numeric', timeZone: 'UTC' })
          : d.toLocaleDateString('pl-PL', { day:'numeric', month:'long', year:'numeric', timeZone: 'UTC' })
      };
    });
}
exports.enrich = enrich;

// In-Memory-Cache (sprachunabhängig: parseEvents liefert Rohdaten, enrich pro lang).
// Ein warmer Netlify-Container serviert wiederholte Tool-Calls sofort, statt den
// 1–3 s langen gviz-Roundtrip zum Google Sheet zu wiederholen — das reduziert die
// Tool-Latenz, die im Telefonat als Stille ankommt ("halo?"). Bei gviz-Fehler wird
// der letzte gültige Stand serviert (resilienter als ein harter 502).
let _eventsCache = { events: null, ts: 0 };
const EVENTS_CACHE_TTL_MS = 120000; // 2 Minuten

async function getEventsCached() {
  const now = Date.now();
  if (_eventsCache.events && (now - _eventsCache.ts) < EVENTS_CACHE_TTL_MS) {
    return _eventsCache.events;
  }
  try {
    const res = await fetch(GVIZ_URL);
    const text = await res.text();
    const events = parseEvents(text);
    _eventsCache = { events, ts: now };
    return events;
  } catch (err) {
    if (_eventsCache.events) return _eventsCache.events; // stale > Fehler
    throw err;
  }
}

// Suchbegriff als Datum lesen: "2026-10-10", "10.10.", "10.10", "10.10.26" oder
// "10.10.2026". Die Agenten uebergeben fuer Fragen wie "Ist heute Messe?" fast
// immer ein Datum. Ohne Jahr gilt das naechste Vorkommen ab heute (Berlin).
// Unmoegliche Daten ("31.02.") sind kein Datum.
const validYmd = (y, m, d) => {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
};
const ymd = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
function queryAsDate(query, today) {
  const iso = query.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return validYmd(+iso[1], +iso[2], +iso[3]) ? iso[0] : null;
  const de = query.match(/^(\d{1,2})\.(\d{1,2})(?:\.(\d{4}|\d{2})?)?$/);
  if (!de) return null;
  const d = +de[1], m = +de[2];
  if (de[3]) {
    const y = de[3].length === 2 ? 2000 + +de[3] : +de[3];
    return validYmd(y, m, d) ? ymd(y, m, d) : null;
  }
  const todayIso = berlinDay(today);
  const year = +todayIso.slice(0, 4);
  for (const y of [year, year + 1, year + 2, year + 3, year + 4]) { // 29.02. -> naechstes Schaltjahr
    if (validYmd(y, m, d) && ymd(y, m, d) >= todayIso) return ymd(y, m, d);
  }
  return null;
}

// Wochentag und lesbares Datum fuer das abgefragte Datum. Der Prompt verbietet
// der KI, Wochentage selbst zu rechnen — bisher kam ein Wochentag aber nur fuer
// Tage zurueck, an denen ein Sondertermin steht.
function describeDate(date, lang) {
  const d = new Date(`${date}T12:00:00Z`);
  if (isNaN(d)) return null;
  const wd = lang === 'de' ? DE_WEEKDAYS : PL_WEEKDAYS;
  return {
    date,
    weekday: wd[d.getUTCDay()],
    date_human: d.toLocaleDateString(lang === 'de' ? 'de-DE' : 'pl-PL',
      { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
  };
}

// Der Feed enthaelt NUR Sonderveranstaltungen. Audit 08.10.2026: Beide Agenten
// lasen eine leere Trefferliste als "heute keine Messe" und verneinten regulaere
// Messen. Deshalb (a) steht der Hinweis in JEDER Antwort, und (b) liefert ein
// Suchbegriff ohne Treffer alle kommenden Termine statt einer leeren Liste.
const FEED_NOTE = 'This feed lists ONLY special events (catechesis, concerts, retreats, pilgrimages, parish celebrations). '
  + 'Regular Masses and confession times are NOT in this feed — always take them from the knowledge base (regular schedule). '
  + 'An empty or non-matching result never means there is no Mass. '
  + 'Use the description field for the actual schedule — the time field may be empty or a coarse range. Only upcoming, published events are returned.';

const ANNOUNCEMENTS_NOTE = 'Parish announcements (Ogłoszenia duszpasterskie), newest first. Words like "this week", '
  + '"next Sunday" or "today" inside a bulletin refer to the week of the bulletin (see published / valid_until), not to today. '
  + 'Use them for current devotions (e.g. the October rosary), registrations, groups and events. Regular Mass times are in the knowledge base.';

const isoDay = d => (d instanceof Date && !isNaN(d)) ? berlinDay(d) : null;

function buildResponseBody(events, { query = '', limit = 10, lang = 'pl', today = new Date(), announcements = null } = {}) {
  const q = String(query || '').toLowerCase().trim();
  let list = events;
  let queryMatched;
  let requestedDate;
  if (q) {
    const date = queryAsDate(q, today);
    if (date) requestedDate = describeDate(date, lang) || undefined;
    const hits = date
      ? events.filter(e => e.date === date)
      : events.filter(e =>
          e.title.toLowerCase().includes(q) ||
          e.description.toLowerCase().includes(q) ||
          e.location.toLowerCase().includes(q));
    queryMatched = hits.length > 0;
    list = queryMatched ? hits : events;
  }
  list = list.slice(0, limit);

  const body = {
    count: list.length,
    events: list.map(e => ({
      title: e.title,
      date: e.date,
      date_human: e.date_human,
      weekday: e.weekday,
      time: e.time || null,
      location: e.location,
      address: e.address,
      description: e.description
    })),
    fetched_at: new Date().toISOString(),
    source_url: 'https://www.pmk-berlin.de/events',
    note: FEED_NOTE
  };
  if (requestedDate) body.requested_date = requestedDate;
  if (Array.isArray(announcements) && announcements.length) {
    body.announcements = announcements.map(a => ({
      current: !!a.current,
      published: isoDay(a.publishedAt),
      valid_until: isoDay(a.expiresAt),
      title: a.title,
      text: a.body
    }));
    body.announcements_note = ANNOUNCEMENTS_NOTE;
  }
  if (queryMatched !== undefined) {
    body.query_matched = queryMatched;
    if (!queryMatched) {
      body.query_note = `No special event matched "${query}". Showing all upcoming special events instead. `
        + 'This says nothing about regular Masses — answer those from the knowledge base.';
    }
  }
  return body;
}
exports.buildResponseBody = buildResponseBody;

// Aktuelle Ogloszenia (aktueller + vorheriger Aushang) mit eigenem Cache. Faellt der
// Tab aus, fehlt das Feld einfach — die Termine kommen trotzdem.
// Code-Review 09.10.2026: Der Abruf ist begrenzt (sonst haengt das ganze Werkzeug
// mit). Re-Review: Ein nur LANGSAMER Abruf laeuft im Hintergrund weiter und fuellt
// den Zwischenspeicher fuer den naechsten Aufruf; als Fehlschlag gemerkt werden nur
// echte Fehler. Ein alter Stand wird hoechstens sechs Stunden lang ausgeliefert.
let _annCache = { items: null, ts: 0, failTs: 0 };
let _annInflight = null, _annInflightStart = 0;
const ANN_CACHE_TTL_MS = 300000;          // 5 Minuten
const ANN_BUDGET_MS = parseInt(process.env.AGENT_EVENTS_ANN_BUDGET_MS || '2500', 10);
const ANN_FAIL_TTL_MS = 60000;            // 1 Minute
const ANN_STALE_MAX_MS = 6 * 3600 * 1000; // 6 Stunden
async function getAnnouncementsCached(now) {
  const t = Date.now();
  if (_annCache.items && (t - _annCache.ts) < ANN_CACHE_TTL_MS) return _annCache.items;
  const stale = () => (_annCache.items && (Date.now() - _annCache.ts) < ANN_STALE_MAX_MS) ? _annCache.items : null;
  if (_annCache.failTs && (t - _annCache.failTs) < ANN_FAIL_TTL_MS) return stale();
  if (!_annInflight) {
    _annInflightStart = t;
    _annInflight = Promise.resolve()
      .then(() => require('./_ogloszenia.js').fetchOgloszenia())
      .then(all => {
        const { selectForKi } = require('./_ogloszenia.js');
        _annCache = { items: selectForKi(all, now, { max: 2 }), ts: Date.now(), failTs: 0 };
        return _annCache.items;
      })
      .catch(err => {
        _annCache.failTs = Date.now();
        console.warn('agent-events: Aushaenge nicht abrufbar', err && err.message);
        return null;
      })
      .finally(() => { _annInflight = null; });
  } else if (t - _annInflightStart >= ANN_BUDGET_MS) {
    return stale(); // laeuft schon laenger als das Budget — nicht noch einmal warten
  }
  let timer;
  const TIMEOUT = Symbol('timeout');
  const res = await Promise.race([
    _annInflight,
    new Promise(resolve => { timer = setTimeout(() => resolve(TIMEOUT), Math.max(0, ANN_BUDGET_MS - (t - _annInflightStart))); })
  ]);
  clearTimeout(timer);
  if (res === TIMEOUT) {
    console.warn('agent-events: Aushang-Abruf langsamer als ' + ANN_BUDGET_MS + ' ms — Antwort ohne neue Aushaenge');
    return stale();
  }
  return res || stale();
}

exports.handler = async (event) => {
  const params = event.queryStringParameters || {};
  const lang = (params.lang || 'pl').toLowerCase() === 'de' ? 'de' : 'pl';
  const limit = Math.min(parseInt(params.limit, 10) || 10, 30);
  const query = (params.query || '').trim();

  try {
    const now = new Date();
    const [rawEvents, announcements] = await Promise.all([getEventsCached(), getAnnouncementsCached(now)]);
    const events = enrich(rawEvents, lang, now);
    const body = buildResponseBody(events, { query, limit, lang, announcements });

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'public, max-age=300',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify(body)
    };
  } catch (err) {
    return {
      statusCode: 502,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Failed to fetch events', message: String(err.message || err) })
    };
  }
};
