#!/usr/bin/env node
/**
 * Selbsttest für cleanUrls(). Lauf:  node scripts/test-clean-urls.mjs
 * Deckt alle Link-Formen ab, die im Repo real vorkommen (href absolut/relativ/
 * root-relativ, canonical, og:url, hreflang, JSON-LD, sitemap <loc>, Query/Hash,
 * index→Verzeichnis, 404-Ausnahme, Fließtext-Schutz).
 */
import { cleanUrls } from './lib-clean-urls.mjs';

const cases = [
  // [eingabe, erwartet]
  ['href="kontakt.html"', 'href="kontakt"'],
  ['href="/kontakt.html"', 'href="/kontakt"'],
  ['href="/de/kontakt.html"', 'href="/de/kontakt"'],
  ['href="https://www.pmk-berlin.de/kontakt.html"', 'href="https://www.pmk-berlin.de/kontakt"'],
  ['href="wspolnota-ruch-swiatlo-zycie.html"', 'href="wspolnota-ruch-swiatlo-zycie"'],
  // index → Verzeichnis
  ['href="index.html"', 'href="/"'],
  ['href="/index.html"', 'href="/"'],
  ['href="/de/index.html"', 'href="/de/"'],
  ['href="https://www.pmk-berlin.de/index.html"', 'href="https://www.pmk-berlin.de/"'],
  ['href="https://www.pmk-berlin.de/de/index.html"', 'href="https://www.pmk-berlin.de/de/"'],
  // Query + Hash bleiben
  ['href="kontakt.html?temat=Chrzest"', 'href="kontakt?temat=Chrzest"'],
  ['href="index.html#messzeiten"', 'href="/#messzeiten"'],
  ['href="/de/index.html#onas"', 'href="/de/#onas"'],
  // Head-Tags
  ['<link rel="canonical" href="https://www.pmk-berlin.de/sakramente.html">', '<link rel="canonical" href="https://www.pmk-berlin.de/sakramente">'],
  ['<link rel="alternate" hreflang="de" href="https://www.pmk-berlin.de/de/beichte.html">', '<link rel="alternate" hreflang="de" href="https://www.pmk-berlin.de/de/beichte">'],
  ['<meta property="og:url" content="https://www.pmk-berlin.de/wesprzyj.html">', '<meta property="og:url" content="https://www.pmk-berlin.de/wesprzyj">'],
  // JSON-LD
  ['"url": "https://www.pmk-berlin.de/sakrament-chrzest.html"', '"url": "https://www.pmk-berlin.de/sakrament-chrzest"'],
  ['"item": "https://www.pmk-berlin.de/de/index.html"', '"item": "https://www.pmk-berlin.de/de/"'],
  // sitemap
  ['<loc>https://www.pmk-berlin.de/grupy.html</loc>', '<loc>https://www.pmk-berlin.de/grupy</loc>'],
  ['<loc>https://www.pmk-berlin.de/de/index.html</loc>', '<loc>https://www.pmk-berlin.de/de/</loc>'],
  // JS-Template-Literal
  ['`/de/veranstaltung.html`', '`/de/veranstaltung`'],
  ['`/event.html`', '`/event`'],
  // 404 bleibt
  ['href="/404.html"', 'href="/404.html"'],
  ['href="/de/404.html"', 'href="/de/404.html"'],
  // Fließtext NICHT anfassen (kein URL-Präfix)
  ['siehe kontakt.html im Ordner', 'siehe kontakt.html im Ordner'],
  // .html5 / .htmlx dürfen nicht greifen
  ['href="foo.html5"', 'href="foo.html5"'],
];

let fail = 0;
for (const [input, expected] of cases) {
  const got = cleanUrls(input);
  if (got !== expected) {
    fail++;
    console.error(`✗ FAIL\n  in:  ${input}\n  exp: ${expected}\n  got: ${got}`);
  }
}
if (fail) {
  console.error(`\n${fail}/${cases.length} Fälle fehlgeschlagen.`);
  process.exit(1);
}
console.log(`✓ alle ${cases.length} Fälle bestanden.`);
