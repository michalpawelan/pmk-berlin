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
  'polityka-prywatnosci.html': '/datenschutz.html',
  // Wspólnoty 1:1
  ...Object.fromEntries([
    'apostolstwo', 'domowy-kosciol', 'grono-dzieci-maryi', 'grupa-kobiet', 'grupa-meska',
    'ministranci', 'radio-maryja', 'ruch-swiatlo-zycie', 'ruch-szensztacki', 'schola',
    'sne', 'zywy-rozaniec',
  ].map((s) => ['wspolnota-' + s + '.html', '/de/wspolnota-' + s + '.html'])),
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

  if (html !== before) {
    writeFileSync(path, html);
    console.log(`${file} ✓`);
  }
}
