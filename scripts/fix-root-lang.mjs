#!/usr/bin/env node
/**
 * fix-root-lang.mjs — stellt die polnischen Root-Seiten auf URL-basierte
 * Sprachwahl um: i18n.js-Include raus, Sprachschalter sind echte Links
 * (PL = aktiv/Selbstlink, DE = Link aufs deutsche Pendant).
 * Idempotent.
 */

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanUrls } from './lib-clean-urls.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const DE_PENDANT = {
  'index.html': '/de/index.html',
  'kontakt.html': '/de/kontakt.html',
  'sakramente.html': '/de/sakramente.html',
  'sakrament-chrzest.html': '/de/taufe.html',
  'sakrament-bierzmowanie.html': '/de/firmung.html',
  'sakrament-komunia.html': '/de/erstkommunion.html',
  'sakrament-malzenstwo.html': '/de/trauung.html',
  'sakrament-namaszczenie.html': '/de/krankensalbung.html',
  'sakrament-spowiedz.html': '/de/beichte.html',
  'grupy.html': '/de/gruppen.html',
  'wesprzyj.html': '/de/spenden.html',
  'events.html': '/de/veranstaltungen.html',
  'event.html': '/de/veranstaltung.html',
  'ogloszenia.html': '/de/ogloszenia.html',
  'polityka-prywatnosci.html': '/datenschutz.html',
  'nota-prawna.html': '/impressum.html',
  // Wspólnoty 1:1
  ...Object.fromEntries([
    'apostolstwo', 'domowy-kosciol', 'grono-dzieci-maryi', 'grupa-kobiet', 'grupa-meska',
    'ministranci', 'radio-maryja', 'ruch-swiatlo-zycie', 'ruch-szensztacki', 'schola',
    'sne', 'zywy-rozaniec',
  ].map((s) => ['wspolnota-' + s + '.html', '/de/wspolnota-' + s + '.html'])),
};

// Deutschsprachige Root-Seiten (Rechtstexte): DE ist hier die Eigensprache.
// PL-Pendant für Datenschutz und Impressum vorhanden, für Schutzkonzept nicht.
const GERMAN_ROOT = {
  'datenschutz.html': '/polityka-prywatnosci.html',
  'impressum.html': '/nota-prawna.html',
  'schutzkonzept.html': null,
};

const files = readdirSync(ROOT).filter((f) => f.endsWith('.html'));

for (const file of files) {
  const path = join(ROOT, file);
  let html = readFileSync(path, 'utf8');
  const before = html;
  const self = file === 'index.html' ? '/' : '/' + file;
  const de = DE_PENDANT[file] || '/de/index.html';

  // i18n.js-Include entfernen (Laufzeit-Umschalter gibt es nicht mehr)
  html = html.replace(/[ \t]*<script src="\/?js\/i18n\.js" defer><\/script>\n?/g, '');

  // Sprachschalter: Buttons → Links, Links → korrekte Ziele
  html = html.replace(/<button class="lang-btn[^"]*" data-lang="pl">PL<\/button>/g,
    `<a href="${self}" class="lang-btn active" data-lang="pl">PL</a>`);
  html = html.replace(/<button class="lang-btn[^"]*" data-lang="de">DE<\/button>/g,
    `<a href="${de}" class="lang-btn" data-lang="de">DE</a>`);
  html = html.replace(/<a href="[^"]*"([^>]*)class="lang-btn[^"]*"([^>]*)data-lang="pl"([^>]*)>PL<\/a>/g,
    `<a href="${self}" class="lang-btn active" data-lang="pl">PL</a>`);
  html = html.replace(/<a href="[^"]*"([^>]*)class="lang-btn[^"]*"([^>]*)data-lang="de"([^>]*)>DE<\/a>/g,
    `<a href="${de}" class="lang-btn" data-lang="de">DE</a>`);

  // Footer-Sprachlink „Auf Deutsch" → deutsches Pendant
  html = html.replace(/<a href="[^"]*"([^>]*hreflang="de"[^>]*)>([^<]*)<\/a>/g,
    `<a href="${de}"$1>$2</a>`);

  // hreflang=de-Rücklink im <head> sicherstellen, wenn ein ECHTES Pendant
  // existiert (nicht der /de/index.html-Fallback) — Reziprozität für Google.
  if (DE_PENDANT[file] && DE_PENDANT[file].startsWith('/de/') && !(file in GERMAN_ROOT)) {
    const deAbs = 'https://www.pmk-berlin.de' + DE_PENDANT[file];
    if (/<link rel="alternate" hreflang="de"/.test(html)) {
      html = html.replace(/(<link rel="alternate" hreflang="de" href=")[^"]*(")/, '$1' + deAbs + '$2');
    } else {
      html = html.replace(/(<link rel="alternate" hreflang="pl"[^>]*>)/,
        '$1\n  <link rel="alternate" hreflang="de" href="' + deAbs + '">');
    }
  }

  // Deutschsprachige Root-Seiten: lang="de", Schalter DE=aktiv/selbst, PL=Pendant
  if (file in GERMAN_ROOT) {
    html = html.replace(/<html lang="pl"/, '<html lang="de"');
    const plPendant = GERMAN_ROOT[file];
    if (plPendant) {
      html = html.replace(/<a href="[^"]*" class="lang-btn[^"]*" data-lang="pl">PL<\/a>/g,
        `<a href="${plPendant}" class="lang-btn" data-lang="pl">PL</a>`);
      html = html.replace(/<a href="[^"]*" class="lang-btn[^"]*" data-lang="de">DE<\/a>/g,
        `<a href="${self}" class="lang-btn active" data-lang="de">DE</a>`);
    } else {
      // kein PL-Pendant: Schalter zeigt DE aktiv, PL führt zur PL-Startseite
      html = html.replace(/<a href="[^"]*" class="lang-btn[^"]*" data-lang="pl">PL<\/a>/g,
        `<a href="/" class="lang-btn" data-lang="pl">PL</a>`);
      html = html.replace(/<a href="[^"]*" class="lang-btn[^"]*" data-lang="de">DE<\/a>/g,
        `<a href="${self}" class="lang-btn active" data-lang="de">DE</a>`);
    }
  }

  html = cleanUrls(html); // .html aus allen internen URLs strippen (Clean-URLs)

  if (html !== before) {
    writeFileSync(path, html);
    console.log(`${file} ✓`);
  }
}
