const SHEET_ID = process.env.GOOGLE_SHEET_ID || '1tPc4twR0CoefnHDoODo-a5opSK35ogDmZHyzB_uhb1w';
const SHEET_NAME = process.env.GOOGLE_SHEET_NAME || 'Tabellenblatt1';

const GVIZ_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json&sheet=${encodeURIComponent(SHEET_NAME)}&headers=1`;

const PL_WEEKDAYS = ['niedziela','poniedziałek','wtorek','środa','czwartek','piątek','sobota'];
const DE_WEEKDAYS = ['Sonntag','Montag','Dienstag','Mittwoch','Donnerstag','Freitag','Samstag'];

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
      title,
      date,
      time: parseTime(row.c[2]),
      description: String(cellValue(row.c[3])).trim(),
      location: String(cellValue(row.c[5])).trim() || 'Johannes-Basilika',
      address: String(cellValue(row.c[6])).trim() || 'Lilienthalstraße 5, 10965 Berlin'
    });
  }
  return out;
}

function enrich(events, lang) {
  const today = new Date(); today.setHours(0,0,0,0);
  const wd = lang === 'de' ? DE_WEEKDAYS : PL_WEEKDAYS;
  return events
    .filter(e => new Date(e.date) >= today)
    .sort((a,b) => new Date(a.date) - new Date(b.date))
    .map(e => {
      const d = new Date(e.date);
      return {
        ...e,
        weekday: wd[d.getDay()],
        date_human: lang === 'de'
          ? d.toLocaleDateString('de-DE', { day:'numeric', month:'long', year:'numeric' })
          : d.toLocaleDateString('pl-PL', { day:'numeric', month:'long', year:'numeric' })
      };
    });
}

exports.handler = async (event) => {
  const params = event.queryStringParameters || {};
  const lang = (params.lang || 'pl').toLowerCase() === 'de' ? 'de' : 'pl';
  const limit = Math.min(parseInt(params.limit, 10) || 10, 30);
  const query = (params.query || '').toLowerCase().trim();

  try {
    const res = await fetch(GVIZ_URL);
    const text = await res.text();
    let events = parseEvents(text);
    events = enrich(events, lang);
    if (query) {
      events = events.filter(e =>
        e.title.toLowerCase().includes(query) ||
        e.description.toLowerCase().includes(query) ||
        e.location.toLowerCase().includes(query)
      );
    }
    events = events.slice(0, limit);

    const body = {
      count: events.length,
      events: events.map(e => ({
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
      source_url: 'https://www.pmk-berlin.de/events.html',
      note: 'Use the description field for the actual schedule — the time field may be empty or a coarse range. Only upcoming, published events are returned.'
    };

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
