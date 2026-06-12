#!/usr/bin/env node
/**
 * germanize-de.mjs — bringt ALLE de/*.html auf den konsolidierten Stand:
 *
 * 1. Die 11 handgeschriebenen Originale: data-i18n-Elemente (Footer/Newsletter)
 *    statisch mit den de-Werten aus translations/ füllen, data-i18n-Attribute
 *    entfernen, i18n.js-Include entfernen.
 * 2. Alle Seiten: Sprachschalter = echte Links (PL → polnisches Pendant,
 *    DE aktiv), einheitliche Header-Nav (7 Punkte), einheitliche
 *    Footer-Navigation inkl. Sprache-Gruppe.
 *
 * Idempotent — kann beliebig oft laufen.
 */

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// deutsches File → polnisches Pendant
const PL_PENDANT = {
  'index.html': '/', 'kontakt.html': '/kontakt.html', 'sakramente.html': '/sakramente.html',
  'taufe.html': '/sakrament-chrzest.html', 'firmung.html': '/sakrament-bierzmowanie.html',
  'erstkommunion.html': '/sakrament-komunia.html', 'trauung.html': '/sakrament-malzenstwo.html',
  'krankensalbung.html': '/sakrament-namaszczenie.html', 'beichte.html': '/sakrament-spowiedz.html',
  'gruppen.html': '/grupy.html', 'spenden.html': '/wesprzyj.html',
  'veranstaltungen.html': '/events.html', 'veranstaltung.html': '/event.html',
  'ogloszenia.html': '/ogloszenia.html',
  '404.html': '/',
};
// wspolnota-* → gleiches PL-File im Root
function plPendant(file) {
  if (PL_PENDANT[file]) return PL_PENDANT[file];
  if (file.startsWith('wspolnota-')) return '/' + file;
  return '/';
}

// Welcher Nav-Punkt ist auf welcher Seite aktiv?
function navActive(file) {
  if (file.startsWith('wspolnota-')) return 'gruppen.html';
  if (file === 'veranstaltung.html') return 'veranstaltungen.html';
  if (/^(taufe|firmung|erstkommunion|trauung|krankensalbung|beichte)\.html$/.test(file)) return 'sakramente.html';
  return file;
}

// Spiegel der PL-Navigation (5 Punkte) — Messzeiten/Über-uns sind Abschnitte
// der Startseite (/de/index.html#messzeiten, #onas), keine eigenen Seiten mehr.
const NAV_ITEMS = [
  ['index.html', 'Startseite'],
  ['sakramente.html', 'Sakramente'],
  ['veranstaltungen.html', 'Veranstaltungen'],
  ['gruppen.html', 'Gruppen'],
  ['kontakt.html', 'Kontakt'],
];

function headerNav(file) {
  const active = navActive(file);
  const lis = NAV_ITEMS.map(([href, label]) =>
    `      <li><a href="/de/${href}"${href === active ? ' class="active"' : ''}>${label}</a></li>`
  ).join('\n');
  return `<ul class="nav-links" id="navLinks">\n${lis}\n    </ul>`;
}

function footerNavGroup() {
  const links = NAV_ITEMS.map(([href, label]) => `          <a href="/de/${href}">${label}</a>`).join('\n');
  return `<div class="footer-nav-group">\n          <h4>Navigation</h4>\n${links}\n        </div>`;
}

function loadCommonDe() {
  const merged = {};
  for (const name of ['common', 'index', 'kontakt', 'sakramente']) {
    try { Object.assign(merged, JSON.parse(readFileSync(join(ROOT, 'translations', name + '.json'), 'utf8'))); }
    catch (e) { /* egal */ }
  }
  return merged;
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function findClose(html, tagName, fromIdx) {
  const re = new RegExp('<(/?)' + tagName + '(?=[\\s>/])', 'gi');
  re.lastIndex = fromIdx;
  let depth = 1, m;
  while ((m = re.exec(html)) !== null) {
    if (m[1] === '/') { depth--; if (depth === 0) return m.index; }
    else depth++;
  }
  return -1;
}

function applyContent(html, dict, attr, asHtml) {
  const openRe = new RegExp('<([a-zA-Z0-9]+)([^>]*?)\\s' + attr + '="([^"]+)"([^>]*)>', 'g');
  let out = '', last = 0, m;
  while ((m = openRe.exec(html)) !== null) {
    const [full, tag, , key] = m;
    const openEnd = m.index + full.length;
    if (/^(input|img|br|hr|meta|link)$/i.test(tag)) continue;
    const closeIdx = findClose(html, tag, openEnd);
    if (closeIdx === -1) continue;
    const entry = dict[key];
    if (!entry || !entry.de) continue;
    out += html.slice(last, openEnd) + (asHtml ? entry.de : escapeHtml(entry.de));
    last = closeIdx;
    openRe.lastIndex = closeIdx;
  }
  return out + html.slice(last);
}

function applyAttrs(html, dict) {
  return html.replace(/<[^>]*\sdata-i18n-attr="([^"]+)"[^>]*>/g, (tagStr, spec) => {
    let result = tagStr;
    for (const pair of spec.split(',')) {
      const [attrName, key] = pair.trim().split(':');
      const entry = dict[key];
      if (!entry || !entry.de) continue;
      const re = new RegExp('(\\s' + attrName + '=")[^"]*(")');
      result = result.replace(re, '$1' + escapeHtml(entry.de).replace(/\$/g, '$$$$') + '$2');
    }
    return result;
  });
}

// Feste Ersetzungen auf allen de-Seiten (Strings ohne data-i18n in den Quellen)
const DE_FIXED = [
  ['>Przejdź do treści<', '>Zum Inhalt springen<'],
  ['"Niech będzie pochwalony Jezus Chrystus"', '„Gelobt sei Jesus Christus“'],
  ['aria-label="Imię / Vorname"', 'aria-label="Vorname"'],
  ['aria-label="Adres e-mail / E-Mail-Adresse"', 'aria-label="E-Mail-Adresse"'],
  ['alt="GiroCode — zeskanuj aplikacją bankową / mit der Banking-App scannen"', 'alt="GiroCode — mit der Banking-App scannen"'],
  // Brand/Markenname eindeutschen — NUR kontextgebunden ersetzen:
  // JSON-LD "alternateName": "Polska Misja Katolicka Berlin" ist korrekt und bleibt!
  ['<span class="nav-brand-name">Polska Misja Katolicka</span>', '<span class="nav-brand-name">Polnische Katholische Mission</span>'],
  ['<strong>Polska Misja Katolicka</strong>', '<strong>Polnische Katholische Mission</strong>'],
  ['alt="Polska Misja Katolicka w Berlinie"', 'alt="Polnische Katholische Mission Berlin"'],
  ['&copy; 2026 Polska Misja Katolicka Berlin', '&copy; 2026 Polnische Katholische Mission Berlin'],
  ['<meta name="author" content="Polska Misja Katolicka Berlin">', '<meta name="author" content="Polnische Katholische Mission Berlin">'],
  ['content="Johannes-Basilika - Polska Misja Katolicka w Berlinie"', 'content="Johannes-Basilika — Polnische Katholische Mission Berlin"'],
  // Seiten-Schemas (WebPage/CollectionPage/FAQPage) deklarieren die Seitensprache.
  // Event-Schemas (inline-JS, single quotes) bleiben bewusst 'pl' — die Events selbst sind polnischsprachig.
  ['"inLanguage": "pl"', '"inLanguage": "de"'],
  ['aria-label="Menu"', 'aria-label="Menü"'],
  ['<span>w Berlinie</span>', '<span>in Berlin</span>'],
  // Newsletter-Footer: Sie-Form (Register der DE-Seiten)
  ['<h4>Bleib auf dem Laufenden</h4>', '<h4>Bleiben Sie auf dem Laufenden</h4>'],
  ['placeholder="deine E-Mail"', 'placeholder="Ihre E-Mail"'],
];

// Spenden-Band (PL-Footer hat es überall) — auf DE-Seiten sicherstellen
const DONATE_BLOCK = `<div class="footer-donate">
      <div class="footer-donate-text">
        <h4>Unterstützen Sie unsere Mission</h4>
        <p>Ihre Spende unterstützt die Missionstätigkeit der Salesianer. Vielen Dank für jede Unterstützung.</p>
      </div>
      <div class="footer-donate-cta-wrap">
        <a href="/de/spenden.html" class="footer-donate-btn">Mission unterstützen</a>
      </div>
    </div>

    `;

const dict = loadCommonDe();
const files = readdirSync(join(ROOT, 'de')).filter((f) => f.endsWith('.html'));

for (const file of files) {
  const path = join(ROOT, 'de', file);
  let html = readFileSync(path, 'utf8');
  const pl = plPendant(file);
  const deHref = '/de/' + file;

  for (const [pl, de] of DE_FIXED) html = html.split(pl).join(de);

  // Spenden-Band sicherstellen (außer auf der Spendenseite selbst)
  if (file !== 'spenden.html' && !html.includes('footer-donate')) {
    html = html.replace('<!-- BEGIN newsletter-footer -->', DONATE_BLOCK + '<!-- BEGIN newsletter-footer -->');
  }

  // 1) Übersetzungen statisch einbrennen (wirkt nur, wo data-i18n noch existiert)
  html = applyContent(html, dict, 'data-i18n-html', true);
  html = applyContent(html, dict, 'data-i18n', false);
  html = applyAttrs(html, dict);
  html = html.replace(/\s+data-i18n(-html|-attr)?="[^"]*"/g, '');
  html = html.replace(/[ \t]*<script src="\/?js\/i18n\.js" defer><\/script>\n?/, '');

  // 2) Sprachschalter: Buttons → Links, korrekte Ziele, DE aktiv
  html = html.replace(/<button class="lang-btn[^"]*" data-lang="pl">PL<\/button>/g,
    `<a href="${pl}" class="lang-btn" data-lang="pl">PL</a>`);
  html = html.replace(/<button class="lang-btn[^"]*" data-lang="de">DE<\/button>/g,
    `<a href="${deHref}" class="lang-btn active" data-lang="de">DE</a>`);
  html = html.replace(/<a href="[^"]*" class="lang-btn[^"]*" data-lang="pl">PL<\/a>/g,
    `<a href="${pl}" class="lang-btn" data-lang="pl">PL</a>`);
  html = html.replace(/<a href="[^"]*" class="lang-btn[^"]*" data-lang="de">DE<\/a>/g,
    `<a href="${deHref}" class="lang-btn active" data-lang="de">DE</a>`);

  // 3) Einheitliche Header-Nav
  html = html.replace(/<ul class="nav-links" id="navLinks">[\s\S]*?<\/ul>/, headerNav(file));

  // 4) Einheitliche Footer-Navigation (erste footer-nav-group mit <h4>Navigation</h4>)
  html = html.replace(/<div class="footer-nav-group">\s*<h4>Navigation<\/h4>[\s\S]*?<\/div>/, footerNavGroup());

  // 5) Sprache-Gruppe sicherstellen (Link zum polnischen Original)
  if (!/Originalversion/.test(html)) {
    html = html.replace(/(<div class="footer-nav-group">\s*<h4>(?:Informationen|Rechtliches)<\/h4>)/,
      `<div class="footer-nav-group">\n          <h4>Sprache</h4>\n          <a href="${pl}">Polski (Originalversion)</a>\n        </div>\n        $1`);
  } else {
    html = html.replace(/<a href="[^"]*">Polski \(Originalversion\)<\/a>/, `<a href="${pl}">Polski (Originalversion)</a>`);
  }

  writeFileSync(path, html);
  console.log(`de/${file} ✓`);
}
