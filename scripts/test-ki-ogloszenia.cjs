// Test fuer netlify/functions/ki-ogloszenia.js — die Seite, aus der ElevenLabs die
// woechentlichen Ogloszenia als Wissensdokument laedt (URL-Dokument mit Auto-Sync).
// Run: node scripts/test-ki-ogloszenia.cjs
//
// Hintergrund (Audit 08.10.2026): Die haeufigsten Wissensluecken des Chats standen
// alle in den Wochenaushaengen (Rosenkranz im Oktober taeglich 17:30, Oaza 21+,
// Fatima-Samstage, Spandau nur Oktober bis Mai). Die KI kannte sie nicht und hat
// Uhrzeiten erfunden.
const mod = require('../netlify/functions/ki-ogloszenia.js');
const { parseOgloszenia, selectForKi, renderKiPage } = mod;

let fail = 0;
const check = (label, ok, detail) => { if (!ok) fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : '  -> ' + detail}`); };

const row = (id, title, body, pub, exp, published) => ({ c: [
  { v: id }, { v: title }, { v: body }, { v: '' },
  { v: `Date(${pub[0]},${pub[1] - 1},${pub[2]},8,0,0)` },
  { v: `Date(${exp[0]},${exp[1] - 1},${exp[2]},8,0,0)` },
  { v: published }, null, null] });
const gviz = rows => 'google.visualization.Query.setResponse(' + JSON.stringify({ table: {
  cols: ['id', 'title', 'body', 'image_url', 'published_at', 'expires_at', 'published', 'H', 'I'].map(l => ({ label: l })), rows } }) + ');';

const TEXT = gviz([
  row('a', 'XXVII niedziela zwykła (04.10.2026)', '1. W październiku codziennie o godzinie 17.30 Różaniec.\n2. Oaza 21+ w niedzielę o 19:00. <script>x</script>', [2026, 10, 5], [2026, 10, 12], 'TAK'),
  row('b', 'XXV niedziela zwykła (20.09.2026)', 'Ogłoszenie B', [2026, 9, 21], [2026, 9, 28], 'TAK'),
  row('c', 'XXIV niedziela zwykła (13.09.2026)', 'Ogłoszenie C', [2026, 9, 14], [2026, 9, 21], 'TAK'),
  row('d', 'XXI niedziela zwykła', 'Ogłoszenie D', [2026, 8, 24], [2026, 8, 31], 'TAK'),
  row('e', 'Szkic', 'Nieopublikowane', [2026, 10, 6], [2026, 10, 13], 'NIE'),
  row('f', '', 'bez tytułu', [2026, 10, 1], [2026, 10, 8], 'TAK'),
]);

const items = parseOgloszenia(TEXT);
check('parse: liest veroeffentlichte und unveroeffentlichte, ueberspringt leere Titel', items.length === 5, items.length);
check('parse: Datum wird gelesen', items.find(i => i.id === 'a').publishedAt.getUTCDate() === 5, items.find(i => i.id === 'a').publishedAt);

const NOW = new Date('2026-10-09T12:00:00Z');
let sel = selectForKi(items, NOW);
check('select: aktueller Aushang zuerst', sel[0] && sel[0].id === 'a' && sel[0].current === true, JSON.stringify(sel.map(s => s.id)));
check('select: unveroeffentlicht fehlt', !sel.some(s => s.id === 'e'), JSON.stringify(sel.map(s => s.id)));
check('select: aeltere als 6 Wochen fehlen, max. 4', JSON.stringify(sel.map(s => s.id)) === '["a","b","c"]', JSON.stringify(sel.map(s => s.id)));
check('select: nur der aktuelle ist current', sel.filter(s => s.current).length === 1, JSON.stringify(sel.map(s => [s.id, s.current])));

const LATER = new Date('2026-10-20T12:00:00Z');
sel = selectForKi(items, LATER);
check('select: ohne gueltigen Aushang ist keiner current', sel.length > 0 && sel.every(s => !s.current), JSON.stringify(sel.map(s => [s.id, s.current])));

const html = renderKiPage(selectForKi(items, NOW), NOW);
check('render: noindex', /<meta name="robots" content="noindex/.test(html), 'kein noindex');
check('render: AKTUALNE-Markierung', /AKTUALNE/.test(html), 'fehlt');
check('render: Inhalt des Aushangs', /codziennie o godzinie 17\.30 Różaniec/.test(html) && /Oaza 21\+/.test(html), 'Text fehlt');
// Alt-Eintraege sind HTML (wie auf der Website): Tags fliegen raus, nichts kommt roh durch.
check('render: kein rohes HTML aus Alt-Eintraegen', !/<script>/.test(html), 'script-Tag im Output');
check('render: Datum des Aushangs lesbar', /5 października 2026/.test(html), 'Datum fehlt');
check('render: Hinweis, dass "w tym tygodniu" sich aufs Aushangdatum bezieht', /odnosi się do tygodnia/i.test(html), 'Hinweis fehlt');
check('render: Archiv-Kennzeichnung fuer aeltere', /archiwum/i.test(html), 'fehlt');
const htmlNone = renderKiPage(selectForKi(items, LATER), LATER);
check('render: ohne gueltigen Aushang steht das ausdruecklich da', /brak aktualnych ogłoszeń/i.test(htmlNone), 'fehlt');

// Echte Datenform (Sheet vom 09.10.2026): Datum als ISO-Text, Text als JSON-Bloecke
// aus dem Admin-Editor, teils mit Plakatbild; aeltere Eintraege als HTML.
const realRow = (id, body, pub, exp) => ({ c: [{ v: id }, { v: 'XXVII niedziela zwykła (04.10.2026)' }, { v: body }, null,
  { v: pub }, { v: exp }, { v: 'TAK' }, null, { v: null }] });
const blocks = JSON.stringify([
  { t: 'txt', c: '1.\tW październiku codziennie o godzinie 17.30 zapraszamy na nabożeństwo różańcowe.\n\n2.\tOaza 21+ w niedzielę.' },
  { t: 'img', u: 'https://drive.google.com/file/d/abc123/view' },
]);
const REAL = gviz([
  realRow('r1', blocks, '2026-10-05T07:45:41.912Z', '2026-10-12T07:45:41.912Z'),
  realRow('r2', '<p>Stare ogłoszenie <b>HTML</b></p><p>Druga linia</p>', '2026-09-28T07:00:00.000Z', '2026-10-05T07:00:00.000Z'),
]);
const real = parseOgloszenia(REAL);
check('real: ISO-Datum wird gelesen', real[0] && real[0].publishedAt && real[0].publishedAt.toISOString().startsWith('2026-10-05'), real[0] && real[0].publishedAt);
check('real: Text aus JSON-Bloecken', /codziennie o godzinie 17\.30/.test(real[0].body) && !/"t":"txt"/.test(real[0].body), real[0].body);
check('real: Plakatbild als Hinweis statt Link', /plakat/i.test(real[0].body) && !/drive\.google/.test(real[0].body), real[0].body);
check('real: Alt-HTML ohne Tags', /Stare ogłoszenie HTML/.test(real[1].body) && !/<b>/.test(real[1].body), real[1].body);
const realSel = selectForKi(real, NOW);
check('real: aktueller Aushang wird erkannt', realSel[0] && realSel[0].id === 'r1' && realSel[0].current, JSON.stringify(realSel.map(s => [s.id, s.current])));
// Text aus JSON-Bloecken ist reiner Text: spitze Klammern muessen escaped ankommen.
const esc = parseOgloszenia(gviz([realRow('r3', JSON.stringify([{ t: 'txt', c: 'Uwaga <b>pogrubione</b> & <script>x</script>' }]),
  '2026-10-05T07:00:00.000Z', '2026-10-12T07:00:00.000Z')]));
const escHtml = renderKiPage(selectForKi(esc, NOW), NOW);
check('render: Text aus Bloecken wird escaped', !/<script>/.test(escHtml) && /&lt;script&gt;/.test(escHtml) && /&amp;/.test(escHtml), escHtml.slice(-200));

(async () => {
  global.fetch = async () => ({ ok: true, status: 200, text: async () => TEXT });
  let r = await mod.handler({});
  check('handler: 200 + text/html + X-Robots-Tag', r.statusCode === 200 && /text\/html/.test(r.headers['Content-Type'])
    && /noindex/.test(r.headers['X-Robots-Tag'] || ''), JSON.stringify(r.headers));
  global.fetch = async () => { throw new Error('google down'); };
  r = await mod.handler({});
  check('handler: Google nicht erreichbar -> 503 (ElevenLabs behaelt den alten Stand)', r.statusCode === 503, r.statusCode);
  console.log(`\n${fail ? fail + ' FEHLER' : 'alle Tests gruen'}`);
  process.exit(fail ? 1 : 0);
})();
