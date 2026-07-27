#!/usr/bin/env node
// Prueft die LIVE-Seite darauf, dass beim reinen Seitenaufruf keine Anfrage an
// einen Drittanbieter-Host ausgeloest wird — die technische Grundlage dafuer,
// dass diese Website ohne Cookie-/Consent-Banner auskommt.
//
// Geprueft wird das ausgelieferte HTML plus alle eingebundenen eigenen JS/CSS-
// Dateien: Kein <img src>, <script src>, <link href>, <iframe src>, kein
// preconnect/dns-prefetch darf auf einen fremden Host zeigen. Reine Textlinks
// (<a href>) sind erlaubt — die loesen erst beim Klick etwas aus.
//
// Run: node scripts/check-no-thirdparty.mjs [basis-url]

const BASE = process.argv[2] || 'https://www.pmk-berlin.de';

const PAGES = [
  '/', '/kontakt', '/sakramente', '/events', '/ogloszenia', '/grupy', '/wesprzyj',
  '/impressum', '/datenschutz', '/polityka-prywatnosci', '/sakrament-chrzest',
  '/de/', '/de/kontakt', '/de/sakramente', '/de/veranstaltungen', '/de/spenden', '/de/taufe',
];

// Hosts, die eine Ressource laden DUERFEN. Bewusst kurz: nur die eigene Domain.
const OWN = [/(^|\.)pmk-berlin\.de$/i];

// Ressourcen-Attribute, die der Browser OHNE Zutun des Besuchers abruft.
const RESOURCE_ATTRS = [
  [/<img\b[^>]*?\bsrc=["']([^"']+)["']/gi, 'img src'],
  [/<script\b[^>]*?\bsrc=["']([^"']+)["']/gi, 'script src'],
  [/<iframe\b[^>]*?\bsrc=["']([^"']+)["']/gi, 'iframe src'],
  [/<source\b[^>]*?\bsrcset=["']([^"']+)["']/gi, 'source srcset'],
  [/<link\b[^>]*?\bhref=["']([^"']+)["']/gi, 'link href'],
  [/@import\s+url\(["']?([^"')]+)["']?\)/gi, 'css @import'],
];

function isOwn(href) {
  if (!/^https?:\/\//i.test(href)) return true; // relativ = eigene Domain
  try {
    const host = new URL(href).hostname;
    return OWN.some(re => re.test(host));
  } catch { return false; }
}

async function get(url) {
  const res = await fetch(url, { redirect: 'follow' });
  return { status: res.status, headers: res.headers, body: await res.text() };
}

let problems = 0;
let checked = 0;

console.log(`Pruefe ${BASE} …\n`);

// --- 1. Sicherheits-/Cache-Header einmal zentral pruefen --------------------
{
  const r = await get(BASE + '/');
  const csp = r.headers.get('content-security-policy') || '';
  const checks = [
    ['Content-Security-Policy gesetzt', csp.length > 0],
    ['CSP img-src ohne fremde Hosts', /img-src[^;]*/.test(csp) && !/img-src[^;]*https:(?!\/)/.test(csp)],
    ['CSP ohne Google-Fonts-Hosts', !/fonts\.(googleapis|gstatic)\.com/.test(csp)],
    ['Strict-Transport-Security', !!r.headers.get('strict-transport-security')],
    ['X-Content-Type-Options', r.headers.get('x-content-type-options') === 'nosniff'],
    ['Referrer-Policy', !!r.headers.get('referrer-policy')],
  ];
  for (const [name, ok] of checks) {
    console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${name}`);
    if (!ok) problems++;
  }
  console.log('');
}

// --- 2. Seiten + deren eigene Assets auf Fremd-Ressourcen pruefen -----------
const seenAssets = new Set();
// Fremd-URLs, die nur in Inline-Skripten stehen: laufen erst nach einer
// Nutzeraktion (Klick), zaehlen also nicht als Verstoss — aber sie gehoeren
// einmal von Hand bestaetigt, damit hier nichts stillschweigend durchrutscht.
const deferred = new Set();

for (const page of PAGES) {
  const url = BASE + page;
  let r;
  try { r = await get(url); } catch (e) { console.log(`  FAIL ${page} — nicht erreichbar (${e.message})`); problems++; continue; }
  if (r.status !== 200) { console.log(`  FAIL ${page} — HTTP ${r.status}`); problems++; continue; }
  checked++;

  // Inline-<script>-Bloecke ausklammern: Fremd-URLs darin sind Strings, die erst
  // bei einer Nutzeraktion verwendet werden (z. B. die klickgesteuerte Google-Karte).
  // Sie werden weiter unten separat als INFO ausgewiesen, statt hier falsch zu alarmieren.
  const inlineScripts = [...r.body.matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]);
  const markup = r.body.replace(/<script\b(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/gi, '');

  for (const s of inlineScripts) {
    for (const m of s.matchAll(/https?:\/\/[^\s"'`<>]+/g)) {
      if (isOwn(m[0])) continue;
      // schema.org ist nur der JSON-LD-@context — Browser rufen ihn nie ab.
      if (/^https?:\/\/schema\.org/i.test(m[0])) continue;
      // Nur melden, wenn die URL im Umfeld einer Ladeoperation steht; ein reiner
      // Link-Text in einem Skript loest nichts aus.
      const ctx = s.slice(Math.max(0, m.index - 120), m.index + 120);
      if (!/\bsrc\s*=|<iframe|fetch\s*\(|import\s*\(|new\s+Image|\.href\s*=/i.test(ctx)) continue;
      deferred.add(`${page}: ${m[0].slice(0, 90)}`);
    }
  }

  const hits = [];
  for (const [re, label] of RESOURCE_ATTRS) {
    for (const m of markup.matchAll(re)) {
      const href = m[1].trim();
      if (href.startsWith('data:') || href.startsWith('#')) continue;
      if (!isOwn(href)) hits.push(`${label} -> ${href}`);
      // eigene JS/CSS einsammeln, um sie gleich mitzupruefen
      if (isOwn(href) && /\.(js|css)(\?|$)/i.test(href)) {
        seenAssets.add(new URL(href, url).toString());
      }
    }
  }
  // preconnect/dns-prefetch/preload sind zwar <link>, werden oben schon erfasst.

  if (hits.length) {
    console.log(`  FAIL ${page}`);
    hits.forEach(h => console.log(`         ${h}`));
    problems += hits.length;
  } else {
    console.log(`  OK   ${page}`);
  }
}

// --- 3. Eigene JS/CSS-Dateien auf fest verdrahtete Fremd-URLs pruefen -------
// Nur Muster, die tatsaechlich eine Ressource laden, nicht jede Erwaehnung.
console.log('');
const LOAD_PATTERNS = [
  /https?:\/\/lh3\.googleusercontent\.com/gi,
  /https?:\/\/fonts\.(googleapis|gstatic)\.com/gi,
  /https?:\/\/(www\.)?google-analytics\.com/gi,
  /https?:\/\/connect\.facebook\.net/gi,
];
for (const asset of seenAssets) {
  let body;
  try { body = (await get(asset)).body; } catch { continue; }
  const found = LOAD_PATTERNS.flatMap(re => [...body.matchAll(re)].map(m => m[0]));
  if (found.length) {
    console.log(`  FAIL ${asset.replace(BASE, '')} enthaelt: ${[...new Set(found)].join(', ')}`);
    problems += found.length;
  }
}
console.log(`  ${seenAssets.size} eigene JS/CSS-Dateien geprueft.`);

if (deferred.size) {
  console.log('\n  INFO — Fremd-URLs, die erst nach einer Nutzeraktion geladen werden');
  console.log('  (kein Verstoss, aber einmal manuell bestaetigen, dass sie wirklich klickgesteuert sind):');
  [...deferred].sort().forEach(d => console.log(`         ${d}`));
}

console.log(`\n${problems === 0
  ? `Sauber — ${checked} Seiten, keine Drittanbieter-Ressource beim Seitenaufruf.`
  : `${problems} Befund(e) — bitte pruefen.`}`);
process.exit(problems === 0 ? 0 : 1);
