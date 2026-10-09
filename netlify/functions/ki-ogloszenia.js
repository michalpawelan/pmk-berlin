// Die woechentlichen Ogloszenia als schlichte HTML-Seite fuer die KI.
//
// ElevenLabs laedt diese URL als Wissensdokument (URL-Dokument mit Auto-Sync) fuer
// BEIDE PMK-Agenten. Audit 08.10.2026: Die haeufigsten Wissensluecken des Chats
// standen alle in den Wochenaushaengen — Rosenkranz im Oktober taeglich 17:30,
// Oaza 21+, Fatima-Samstage, Spandau-Mittwoch nur Oktober bis Mai —, die KI kannte
// sie nicht und erfand Uhrzeiten. Die Website rendert die Aushaenge per JavaScript,
// der Crawler von ElevenLabs saehe dort nur eine leere Seite; deshalb diese Seite.
//
// Datenquelle wie ogloszenia-proxy / js/ogloszenia.js: Tab "Ogloszenia" im Sheet.

const { parseOgloszenia, selectForKi, fetchOgloszenia } = require('./_ogloszenia.js');

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const plDate = d => d ? d.toLocaleDateString('pl-PL', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Berlin' }) : '?';

function renderKiPage(selected, now) {
  const parts = [];
  parts.push('<!doctype html>');
  parts.push('<html lang="pl"><head><meta charset="utf-8"><meta name="robots" content="noindex, nofollow">');
  parts.push('<title>Ogłoszenia duszpasterskie — Polska Misja Katolicka w Berlinie</title></head><body>');
  parts.push('<h1>Ogłoszenia duszpasterskie Polskiej Misji Katolickiej w Berlinie</h1>');
  parts.push(`<p>Stan na: ${esc(plDate(now))}. Cotygodniowe ogłoszenia parafialne (te same co na stronie pmk-berlin.de/ogloszenia), najnowsze na górze.</p>`);
  parts.push('<p>Ważne: każde ogłoszenie odnosi się do tygodnia, w którym zostało wydane. Słowa „w tym tygodniu”, '
    + '„w najbliższą niedzielę” czy „dzisiaj” oznaczają tydzień ogłoszenia, nie dzień dzisiejszy. '
    + 'Ogłoszenia z archiwum mogą być już nieaktualne.</p>');
  if (!selected.length) {
    parts.push('<p><strong>Brak ogłoszeń z ostatnich tygodni.</strong></p>');
  } else if (!selected.some(i => i.current)) {
    parts.push('<p><strong>Na ten tydzień brak aktualnych ogłoszeń.</strong> Poniżej ostatnie ogłoszenia (archiwum).</p>');
  }
  for (const i of selected) {
    parts.push('<section>');
    parts.push(i.current
      ? `<h2>AKTUALNE OGŁOSZENIA — wydane ${esc(plDate(i.publishedAt))}, ważne do ${esc(plDate(i.expiresAt))}</h2>`
      : (i.expiresAt && i.expiresAt > now)
        ? `<h2>Wcześniejsze ogłoszenia z ${esc(plDate(i.publishedAt))} (nadal ważne do ${esc(plDate(i.expiresAt))})</h2>`
        : `<h2>Ogłoszenia z ${esc(plDate(i.publishedAt))} (archiwum, ważne były do ${esc(plDate(i.expiresAt))})</h2>`);
    parts.push(`<h3>${esc(i.title)}</h3>`);
    for (const line of i.body.split(/\r?\n/)) {
      const t = line.replace(/\t/g, ' ').trim();
      if (t) parts.push(`<p>${esc(t)}</p>`);
    }
    parts.push('</section>');
  }
  parts.push('</body></html>');
  return parts.join('\n');
}

exports.parseOgloszenia = parseOgloszenia;
exports.selectForKi = selectForKi;
exports.renderKiPage = renderKiPage;

exports.handler = async () => {
  try {
    const now = new Date();
    const html = renderKiPage(selectForKi(await fetchOgloszenia(), now), now);
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'X-Robots-Tag': 'noindex, nofollow',
        'Cache-Control': 'public, max-age=300'
      },
      body: html
    };
  } catch (err) {
    // Kein Fehlertext als 200: ElevenLabs wuerde ihn sonst als neuen Inhalt
    // uebernehmen. Mit 503 bleibt der zuletzt geladene Stand stehen.
    return {
      statusCode: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Retry-After': '3600', 'X-Robots-Tag': 'noindex' },
      body: 'Ogloszenia chwilowo niedostepne.'
    };
  }
};
