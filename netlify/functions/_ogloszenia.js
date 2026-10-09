// Gemeinsames Lesen der woechentlichen Ogloszenia aus dem Sheet (Tab "Ogloszenia").
// Genutzt von ki-ogloszenia.js (Wissensdokument fuer ElevenLabs) und agent-events.js
// (liefert den aktuellen Aushang direkt im Termin-Werkzeug mit).

const SHEET_ID = process.env.GOOGLE_SHEET_ID || '1tPc4twR0CoefnHDoODo-a5opSK35ogDmZHyzB_uhb1w';
const SHEET_NAME = process.env.GOOGLE_SHEET_NAME_OGLOSZENIA || 'Ogloszenia';
const GVIZ_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json&sheet=${encodeURIComponent(SHEET_NAME)}&headers=1`;

const MAX_ITEMS = 4;        // aktueller Aushang + drei vorherige
const MAX_AGE_DAYS = 42;    // aelter ist fuer "was gilt gerade" eher irrefuehrend als hilfreich

function cellValue(cell) {
  if (!cell) return '';
  return cell.v != null ? cell.v : (cell.f || '');
}

// gviz liefert "Date(2026,9,5,8,0,0)" mit Monat ab 0. Als UTC gelesen, damit das
// Ergebnis nicht von der Zeitzone des Servers abhaengt.
// Der Admin speichert die Daten als ISO-Text ("2026-10-05T07:45:41.912Z").
function parseGvizDate(cell) {
  if (!cell) return null;
  const raw = String(cell.v || '');
  const m = raw.match(/Date\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*(\d+))?)?/);
  if (m) return new Date(Date.UTC(+m[1], +m[2], +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)));
  for (const s of [raw, cell.f]) {
    if (s && /^\d{4}-\d{2}-\d{2}/.test(s)) { const d = new Date(s); if (!isNaN(d)) return d; }
  }
  return null;
}

// Der Text kommt aus dem Admin-Editor als JSON-Bloecke ({t:'txt',c} / {t:'img',u}),
// aeltere Eintraege als HTML. Fuer die KI zaehlt nur lesbarer Text; ein Plakat
// (Bild) kann sie nicht lesen — dann steht ein Hinweis da, damit sie das weiss.
function bodyToText(body) {
  const trimmed = String(body || '').trim();
  if (trimmed.startsWith('[')) {
    try {
      const blocks = JSON.parse(trimmed);
      if (Array.isArray(blocks)) {
        return blocks.map(b => {
          if (b && b.t === 'txt' && b.c) return String(b.c);
          if (b && b.t === 'img') return '(W ogłoszeniu był też plakat — jego treść jest dostępna tylko jako obraz.)';
          return '';
        }).filter(Boolean).join('\n\n');
      }
    } catch (_) { /* weiter als HTML/Text */ }
  }
  return trimmed
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/\s*(p|div|li|h\d)\s*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function parseOgloszenia(text) {
  const m = String(text || '').match(/google\.visualization\.Query\.setResponse\(([\s\S]*)\);?/);
  if (!m) throw new Error('Invalid gviz response');
  const data = JSON.parse(m[1]);
  // Google meldet Fehler (Rechte, Quota) im selben Wrapper — nie als leere Liste werten,
  // sonst ueberschreibt ElevenLabs das Wissensdokument mit einer leeren Seite.
  if (data.status === 'error' || !data.table) throw new Error('gviz error: ' + JSON.stringify(data.errors || data.status));
  const rows = data.table.rows || [];
  const out = [];
  for (const row of rows) {
    if (!row || !row.c) continue;
    const title = String(cellValue(row.c[1])).trim();
    const body = bodyToText(cellValue(row.c[2]));
    if (!title || !body) continue;
    out.push({
      id: String(cellValue(row.c[0])),
      title,
      body,
      publishedAt: parseGvizDate(row.c[4]),
      expiresAt: parseGvizDate(row.c[5]),
      published: String(cellValue(row.c[6])).toUpperCase() === 'TAK',
    });
  }
  return out;
}

function selectForKi(items, now, { max = MAX_ITEMS, maxAgeDays = MAX_AGE_DAYS } = {}) {
  const oldest = now.getTime() - maxAgeDays * 86400000;
  const list = (items || [])
    .filter(i => i.published && i.publishedAt && i.publishedAt.getTime() <= now.getTime()
      && i.publishedAt.getTime() >= oldest)
    .sort((a, b) => b.publishedAt - a.publishedAt)
    .slice(0, max)
    .map(i => Object.assign({}, i, { current: false }));
  const cur = list.find(i => i.expiresAt && i.expiresAt.getTime() > now.getTime());
  if (cur) cur.current = true;
  // Der gueltige Aushang steht immer oben, auch wenn ein aelterer spaeter ablaeuft.
  return cur ? [cur].concat(list.filter(i => i !== cur)) : list;
}

// Holt und parst den Tab; wirft bei Netz- oder Formatfehlern.
async function fetchOgloszenia() {
  const res = await fetch(GVIZ_URL);
  if (!res.ok) throw new Error('gviz http ' + res.status);
  return parseOgloszenia(await res.text());
}

module.exports = { GVIZ_URL, parseGvizDate, bodyToText, parseOgloszenia, selectForKi, fetchOgloszenia };
