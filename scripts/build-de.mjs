#!/usr/bin/env node
/**
 * build-de.mjs — generiert statische /de/-Seiten aus den polnischen
 * Quellseiten + translations/*.json (de-Werte).
 *
 * Wendet die gleiche Semantik wie js/i18n.js an (data-i18n → textContent,
 * data-i18n-html → innerHTML, data-i18n-attr → Attribute), nur zur
 * Build-Zeit. Danach: Head (title/description/canonical/hreflang/og),
 * interne Links auf /de/-Pendants, Sprachschalter, i18n.js-Include raus,
 * data-i18n-Attribute raus.
 *
 * Aufruf:  node scripts/build-de.mjs            → alle Seiten
 *          node scripts/build-de.mjs grupy      → nur Seiten, deren src "grupy" enthält
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// ---------------------------------------------------------------------------
// Link-Map: polnische URL → deutsches Pendant. Alles ohne Eintrag bleibt
// stehen (wird aber root-absolut gemacht, damit es aus /de/ heraus stimmt).
// ---------------------------------------------------------------------------
const LINK_MAP = {
  'index.html': '/de/index.html',
  '/': '/de/index.html',
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
  'wspolnota-apostolstwo.html': '/de/wspolnota-apostolstwo.html',
  'wspolnota-domowy-kosciol.html': '/de/wspolnota-domowy-kosciol.html',
  'wspolnota-grono-dzieci-maryi.html': '/de/wspolnota-grono-dzieci-maryi.html',
  'wspolnota-grupa-kobiet.html': '/de/wspolnota-grupa-kobiet.html',
  'wspolnota-grupa-meska.html': '/de/wspolnota-grupa-meska.html',
  'wspolnota-ministranci.html': '/de/wspolnota-ministranci.html',
  'wspolnota-radio-maryja.html': '/de/wspolnota-radio-maryja.html',
  'wspolnota-ruch-swiatlo-zycie.html': '/de/wspolnota-ruch-swiatlo-zycie.html',
  'wspolnota-ruch-szensztacki.html': '/de/wspolnota-ruch-szensztacki.html',
  'wspolnota-schola.html': '/de/wspolnota-schola.html',
  'wspolnota-sne.html': '/de/wspolnota-sne.html',
  'wspolnota-zywy-rozaniec.html': '/de/wspolnota-zywy-rozaniec.html',
};

const SITE = 'https://www.pmk-berlin.de';

// ---------------------------------------------------------------------------
// Seitenkonfiguration
// ---------------------------------------------------------------------------
const GROUP_NAMES = {
  'wspolnota-sne': 'Schule der Neuevangelisierung',
  'wspolnota-domowy-kosciol': 'Hauskirche (Domowy Kościół)',
  'wspolnota-schola': 'Schola „Marana Tha“',
  'wspolnota-ruch-swiatlo-zycie': 'Licht-Leben-Bewegung (Oaza)',
  'wspolnota-ruch-szensztacki': 'Schönstatt-Bewegung',
  'wspolnota-zywy-rozaniec': 'Lebendiger Rosenkranz',
  'wspolnota-grono-dzieci-maryi': 'Gemeinschaft der Marienkinder',
  'wspolnota-radio-maryja': 'Freunde von Radio Maryja',
  'wspolnota-apostolstwo': 'Apostolat des guten Todes',
  'wspolnota-grupa-meska': 'Männergruppe',
  'wspolnota-grupa-kobiet': 'Gruppe der empathischen Frauen',
  'wspolnota-ministranci': 'Ministranten – Liturgischer Dienst',
};

const PAGES = [
  {
    src: 'grupy.html', out: 'de/gruppen.html', json: 'grupy',
    title: 'Gemeindegruppen | Polnische Katholische Mission Berlin',
    desc: 'Gemeinschaften und Gruppen der Polnischen Katholischen Mission Berlin — Gebets-, Formations- und Apostolatsgruppen. Die Gruppen treffen sich auf Polnisch.',
  },
  {
    src: 'wesprzyj.html', out: 'de/spenden.html', json: 'wesprzyj',
    title: 'Gemeinde unterstützen | Polnische Katholische Mission Berlin',
    desc: 'Unterstützen Sie die Polnische Katholische Mission Berlin mit Ihrer Spende — Bankverbindung und QR-Code für die Überweisung.',
  },
  {
    src: 'events.html', out: 'de/veranstaltungen.html', json: ['events', 'index'],
    title: 'Veranstaltungen | Polnische Katholische Mission Berlin',
    desc: 'Aktuelle Veranstaltungen und Termine der Polnischen Katholischen Mission Berlin in der Johannes-Basilika Neukölln.',
  },
  {
    src: '404.html', out: 'de/404.html', json: [],
    title: 'Seite nicht gefunden | Polnische Katholische Mission Berlin',
    desc: 'Die gesuchte Seite existiert nicht oder wurde verschoben.',
  },
  {
    src: 'event.html', out: 'de/veranstaltung.html', json: 'event',
    title: 'Veranstaltung | Polnische Katholische Mission Berlin',
    desc: 'Veranstaltung der Polnischen Katholischen Mission Berlin.',
  },
  ...Object.keys(GROUP_NAMES).map((slug) => ({
    src: slug + '.html', out: 'de/' + slug + '.html', json: 'wspolnoty',
    title: GROUP_NAMES[slug] + ' | Polnische Katholische Mission Berlin',
    desc: GROUP_NAMES[slug] + ' — Gemeinschaft der Polnischen Katholischen Mission Berlin. Treffen, Termine und Kontakt (die Gruppe trifft sich auf Polnisch).',
  })),
];

// ---------------------------------------------------------------------------
// Übersetzungs-Helfer
// ---------------------------------------------------------------------------
function loadTranslations(pageJson) {
  const merged = {};
  for (const name of ['common'].concat(pageJson)) {
    try {
      const data = JSON.parse(readFileSync(join(ROOT, 'translations', name + '.json'), 'utf8'));
      Object.assign(merged, data);
    } catch (e) { /* Datei existiert nicht → nur common */ }
  }
  return merged;
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Findet das passende schließende Tag (depth-aware für gleichnamige Nester)
function findClose(html, tagName, fromIdx) {
  const re = new RegExp('<(/?)' + tagName + '(?=[\\s>/])', 'gi');
  re.lastIndex = fromIdx;
  let depth = 1, m;
  while ((m = re.exec(html)) !== null) {
    if (m[1] === '/') {
      depth--;
      if (depth === 0) return m.index;
    } else {
      // self-closing wie <br/> gibt es bei diesen Tags nicht — zählen
      depth++;
    }
  }
  return -1;
}

// Ersetzt Inhalt aller Elemente mit data-i18n / data-i18n-html
function applyContent(html, dict, attr, asHtml, stats) {
  const openRe = new RegExp('<([a-zA-Z0-9]+)([^>]*?)\\s' + attr + '="([^"]+)"([^>]*)>', 'g');
  let out = '', last = 0, m;
  while ((m = openRe.exec(html)) !== null) {
    const [full, tag, pre, key, post] = m;
    const openEnd = m.index + full.length;
    // void elements (input, img …) haben keinen Inhalt
    if (/^(input|img|br|hr|meta|link)$/i.test(tag)) continue;
    const closeIdx = findClose(html, tag, openEnd);
    if (closeIdx === -1) continue;
    const entry = dict[key];
    if (!entry || !entry.de) { stats.missing.push(key); continue; }
    const value = asHtml ? entry.de : escapeHtml(entry.de);
    out += html.slice(last, openEnd) + value;
    last = closeIdx; // bis vor das schließende Tag ersetzt
    stats.replaced++;
    openRe.lastIndex = closeIdx;
  }
  out += html.slice(last);
  return out;
}

// data-i18n-attr="placeholder:key,aria-label:key2"
function applyAttrs(html, dict, stats) {
  return html.replace(/<[^>]*\sdata-i18n-attr="([^"]+)"[^>]*>/g, (tagStr, spec) => {
    let result = tagStr;
    for (const pair of spec.split(',')) {
      const [attrName, key] = pair.trim().split(':');
      const entry = dict[key];
      if (!entry || !entry.de) { stats.missing.push(key); continue; }
      const re = new RegExp('(\\s' + attrName + '=")[^"]*(")');
      if (re.test(result)) {
        result = result.replace(re, '$1' + escapeHtml(entry.de).replace(/\$/g, '$$$$') + '$2');
        stats.replaced++;
      }
    }
    return result;
  });
}

// Interne Links auf /de/-Pendants umbiegen; Rest root-absolut machen
function rewriteLinks(html) {
  return html.replace(/(href|src|srcset)="([^"]*)"/g, (full, attr, url) => {
    if (/^(https?:|mailto:|tel:|#|data:|javascript:)/.test(url)) return full;
    if (url.includes('${')) return full; // JS-Template-String in Inline-Skripten — nicht anfassen
    const [path, suffix] = splitUrl(url);
    const bare = path.replace(/^\//, '');
    if (attr === 'href' && LINK_MAP[path] !== undefined) return `${attr}="${LINK_MAP[path]}${suffix}"`;
    if (attr === 'href' && LINK_MAP[bare] !== undefined) return `${attr}="${LINK_MAP[bare]}${suffix}"`;
    // relative Pfade root-absolut machen (Seite liegt jetzt unter /de/)
    if (!url.startsWith('/')) return `${attr}="/${url}"`;
    return full;
  });
}

function splitUrl(url) {
  const i = url.search(/[?#]/);
  return i === -1 ? [url, ''] : [url.slice(0, i), url.slice(i)];
}

function buildHead(html, page) {
  const deUrl = SITE + '/' + page.out;
  const plUrl = page.src === 'index.html' ? SITE + '/' : SITE + '/' + page.src;
  html = html.replace(/<html lang="pl"/, '<html lang="de"');
  html = html.replace(/<title>[\s\S]*?<\/title>/, '<title>' + escapeHtml(page.title) + '</title>');
  html = html.replace(/(<meta name="description" content=")[^"]*(")/, '$1' + escapeHtml(page.desc) + '$2');
  html = html.replace(/(<link rel="canonical" href=")[^"]*(")/, '$1' + deUrl + '$2');
  html = html.replace(/(<meta property="og:title" content=")[^"]*(")/, '$1' + escapeHtml(page.title) + '$2');
  html = html.replace(/(<meta property="og:description" content=")[^"]*(")/, '$1' + escapeHtml(page.desc) + '$2');
  html = html.replace(/(<meta name="twitter:title" content=")[^"]*(")/, '$1' + escapeHtml(page.title.replace('Polnische Katholische Mission Berlin', 'PMK Berlin')) + '$2');
  html = html.replace(/(<meta name="twitter:description" content=")[^"]*(")/, '$1' + escapeHtml(page.desc) + '$2');
  html = html.replace(/(<meta property="og:url" content=")[^"]*(")/, '$1' + deUrl + '$2');
  html = html.replace(/(<meta property="og:locale" content=")pl_PL(")/, '$1de_DE$2');
  html = html.replace(/(<meta property="og:locale:alternate" content=")de_DE(")/, '$1pl_PL$2');
  // hreflang: pl bleibt auf PL-URL, de-Alternate ergänzen/korrigieren, x-default → PL
  html = html.replace(/(<link rel="alternate" hreflang="pl" href=")[^"]*(")/, '$1' + plUrl + '$2');
  html = html.replace(/(<link rel="alternate" hreflang="x-default" href=")[^"]*(")/, '$1' + plUrl + '$2');
  if (/hreflang="de"/.test(html)) {
    html = html.replace(/(<link rel="alternate" hreflang="de" href=")[^"]*(")/, '$1' + deUrl + '$2');
  } else {
    html = html.replace(/(<link rel="alternate" hreflang="pl"[^>]*>)/,
      '$1\n  <link rel="alternate" hreflang="de" href="' + deUrl + '">');
  }
  return html;
}

function fixLangSwitcher(html, page) {
  const plHref = page.src === 'index.html' ? '/' : '/' + page.src;
  // PL-Button: Link auf polnisches Original, nicht aktiv
  html = html.replace(/<a href="[^"]*"([^>]*class="lang-btn[^"]*")([^>]*data-lang="pl"[^>]*)>/g,
    (m, a, b) => '<a href="' + plHref + '"' + a.replace(' active', '') + b + '>');
  // DE-Button: Link auf sich selbst, aktiv
  html = html.replace(/<a href="[^"]*"([^>]*class="lang-btn)("[^>]*data-lang="de"[^>]*)>/g,
    (m, a, b) => '<a href="/' + page.out + '"' + a + ' active' + b + '>');
  // Footer-Sprachlink „Auf Deutsch" → „Wersja polska" zeigt aufs PL-Original
  html = html.replace(/<a href="[^"]*"([^>]*hreflang=")de("[^>]*lang=")de("[^>]*)>[^<]*<\/a>/,
    '<a href="' + plHref + '"$1pl$2pl$3>Polnische Originalversion (Polski)</a>');
  return html;
}

// Hartkodierte polnische Strings ohne data-i18n (Gruppen-Kontaktformular u. Ä.)
const FIXED_STRINGS = [
  ['<h2>Skontaktuj się z grupą</h2>', '<h2>Kontakt zur Gruppe</h2>'],
  ['<label>Imię i nazwisko<br>', '<label>Vor- und Nachname<br>'],
  ['<label>E-mail<br>', '<label>E-Mail<br>'],
  ['<label>Wiadomość<br>', '<label>Nachricht<br>'],
  ['<button type="submit">Wyślij</button>', '<button type="submit">Absenden</button>'],
  ['content="Polska Misja Katolicka w Berlinie"', 'content="Polnische Katholische Mission Berlin"'],
  // Sichtbare PL-Reste ohne data-i18n (alt-Texte, Anreden)
  ['alt="Cudowny Medalik – emblemat Grona Dzieci Maryi"', 'alt="Wundertätige Medaille – Emblem der Marienkinder"'],
  ['alt="Emblemat Grupa Męska"', 'alt="Emblem der Männergruppe"'],
  ['alt="GiroCode — zeskanuj aplikacją bankową / mit der Banking-App scannen"', 'alt="GiroCode — mit der Banking-App scannen"'],
  ['alt="Logo Apostolstwo Dobrej Śmierci"', 'alt="Logo Apostolat des guten Todes"'],
  ['alt="Logo Domowy Kościół"', 'alt="Logo Hauskirche (Domowy Kościół)"'],
  ['alt="Logo Grupa Kobiet Empatycznych"', 'alt="Logo Gruppe der empathischen Frauen"'],
  ['alt="Logo Koło Żywego Różańca"', 'alt="Logo Lebendiger Rosenkranz"'],
  ['alt="Logo Ministranci – Służba Liturgiczna"', 'alt="Logo Ministranten – Liturgischer Dienst"'],
  ['alt="Logo Ruch Światło-Życie"', 'alt="Logo Licht-Leben-Bewegung (Oaza)"'],
  ['alt="Logo Szkoła Nowej Ewangelizacji"', 'alt="Logo Schule der Neuevangelisierung"'],
  ['alt="Matka Boża Trzykroć Przedziwna — Ruch Szensztacki"', 'alt="Dreimal Wunderbare Mutter — Schönstatt-Bewegung"'],
  ['alt="Oaza Berlin — katolicka grupa młodzieżowa"', 'alt="Oaza Berlin — katholische Jugendgruppe"'],
  ['>Ks. ', '>P. '],
  ['Danuta i Tomasz', 'Danuta und Tomasz'],
  // 404-Seite (Strings ohne data-i18n)
  ['<h1 class="error-title">Strona nie została znaleziona</h1>', '<h1 class="error-title">Seite nicht gefunden</h1>'],
  ['Przepraszamy, strona której szukasz nie istnieje lub została przeniesiona. Zapraszamy na stronę główną naszej parafii.', 'Die gesuchte Seite existiert nicht oder wurde verschoben. Besuchen Sie gerne die Startseite unserer Gemeinde.'],
  ['>Wróć na stronę główną<', '>Zur Startseite<'],
];

function applyFixedStrings(html) {
  for (const [pl, de] of FIXED_STRINGS) html = html.split(pl).join(de);
  return html;
}

// JSON-LD-Blöcke eindeutschen: echtes JSON-Parsing statt Regex.
// Breadcrumbs (2- und 3-stufig), ItemList-/Organization-Namen, URLs via LINK_MAP.
const JSONLD_NAMES = {
  'Strona główna': 'Startseite',
  'Grupy parafialne': 'Gruppen',
  'Wydarzenia': 'Veranstaltungen',
  'Wydarzenie': 'Veranstaltung',
  'Grupy i wspólnoty parafialne PMK Berlin': 'Gruppen und Gemeinschaften der PMK Berlin',
  'Szkoła Nowej Ewangelizacji': 'Schule der Neuevangelisierung',
  'Domowy Kościół': 'Hauskirche',
  'Schola Marana Tha': 'Schola „Marana Tha“',
  'Ruch Światło-Życie': 'Licht-Leben-Bewegung (Oaza)',
  'Ruch Szensztacki': 'Schönstatt-Bewegung',
  'Koło Żywego Różańca': 'Lebendiger Rosenkranz',
  'Grono Dzieci Maryi': 'Gemeinschaft der Marienkinder',
  'Koło Przyjaciół Radia Maryja': 'Freunde von Radio Maryja',
  'Apostolstwo Dobrej Śmierci': 'Apostolat des guten Todes',
  'Grupa Męska': 'Männergruppe',
  'Grupa Kobiet Empatycznych': 'Gruppe der empathischen Frauen',
  'Ministranci – Służba Liturgiczna': 'Ministranten – Liturgischer Dienst',
};

function rewriteJsonLdUrl(url) {
  if (typeof url !== 'string' || !url.startsWith(SITE + '/')) return url;
  const path = url.slice(SITE.length);
  const bare = path.replace(/^\//, '');
  if (LINK_MAP[path] !== undefined) return SITE + LINK_MAP[path];
  if (LINK_MAP[bare] !== undefined) return SITE + LINK_MAP[bare];
  return url;
}

function fixJsonLd(html, page) {
  const deUrl = SITE + '/' + page.out;
  const pageName = page.title.split('|')[0].trim();
  return html.replace(/(<script type="application\/ld\+json">)([\s\S]*?)(<\/script>)/g, (full, open, body, close) => {
    let data;
    try { data = JSON.parse(body); } catch (e) { return full; }

    const walkUrls = (node) => {
      if (Array.isArray(node)) { node.forEach(walkUrls); return; }
      if (node && typeof node === 'object') {
        for (const k of Object.keys(node)) {
          if (typeof node[k] === 'string') node[k] = rewriteJsonLdUrl(node[k]);
          else walkUrls(node[k]);
        }
      }
    };
    walkUrls(data);

    if (data['@type'] === 'BreadcrumbList' && Array.isArray(data.itemListElement)) {
      const items = data.itemListElement;
      items.forEach((it) => { if (JSONLD_NAMES[it.name]) it.name = JSONLD_NAMES[it.name]; });
      const last = items[items.length - 1];
      if (last) { last.name = pageName; last.item = deUrl; }
    } else {
      // Root-Objekt anderer Typen (Organization, ItemList, WebPage, …)
      if (typeof data.name === 'string') data.name = JSONLD_NAMES[data.name] || pageName;
      if (typeof data.description === 'string') data.description = page.desc;
      if (Array.isArray(data.itemListElement)) {
        data.itemListElement.forEach((it) => { if (JSONLD_NAMES[it.name]) it.name = JSONLD_NAMES[it.name]; });
      }
    }
    return open + '\n  ' + JSON.stringify(data, null, 2).replace(/\n/g, '\n  ') + '\n  ' + close;
  });
}

function stripI18nRuntime(html) {
  html = html.replace(/[ \t]*<script src="\/?js\/i18n\.js" defer><\/script>\n?/, '');
  // data-i18n-Attribute entfernen (statisch eingebrannt, Runtime gibt es nicht mehr)
  html = html.replace(/\s+data-i18n(-html|-attr)?="[^"]*"/g, '');
  return html;
}

// ---------------------------------------------------------------------------
const filter = process.argv[2];
let totalMissing = 0;

for (const page of PAGES) {
  if (filter && !page.src.includes(filter)) continue;
  const dict = loadTranslations(page.json);
  let html = readFileSync(join(ROOT, page.src), 'utf8');
  const stats = { replaced: 0, missing: [] };

  html = applyContent(html, dict, 'data-i18n-html', true, stats);
  html = applyContent(html, dict, 'data-i18n', false, stats);
  html = applyAttrs(html, dict, stats);
  html = rewriteLinks(html);
  html = buildHead(html, page);
  html = fixLangSwitcher(html, page);
  html = fixJsonLd(html, page);
  html = applyFixedStrings(html);
  html = stripI18nRuntime(html);

  mkdirSync(join(ROOT, 'de'), { recursive: true });
  writeFileSync(join(ROOT, page.out), html);
  const miss = [...new Set(stats.missing)];
  totalMissing += miss.length;
  console.log(`${page.out}  ✓ ${stats.replaced} ersetzt` + (miss.length ? `  ⚠ fehlend: ${miss.join(', ')}` : ''));
}
if (totalMissing) process.exitCode = 1;
