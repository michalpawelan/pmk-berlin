#!/usr/bin/env node
// Synct das Newsletter-Snippet (components/newsletter-footer.html) in alle bereits
// injizierten Public-HTML-Seiten. Ersetzt den kompletten BEGIN…END-Block.
// Anders als inject-newsletter-footer.js (add-only) AKTUALISIERT dieses Skript
// bestehende Blocks — nach jeder Änderung am Snippet hier ausführen.

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

const SNIPPET_PATH = path.join(ROOT, 'components/newsletter-footer.html');
const snippet = fs.readFileSync(SNIPPET_PATH, 'utf8').trim();
const BLOCK_RE = /<!-- BEGIN newsletter-footer -->[\s\S]*?<!-- END newsletter-footer -->/;

const EXCLUDE_DIRS = new Set(['admin', 'archive', 'neu', 'node_modules', '.git', '.planning', '.netlify', '.superpowers', 'components']);
const EXCLUDE_FILES = new Set(['404.html']);

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (EXCLUDE_DIRS.has(entry.name)) continue;
      out.push(...walk(path.join(dir, entry.name)));
    } else if (entry.isFile() && entry.name.endsWith('.html')) {
      if (EXCLUDE_FILES.has(entry.name)) continue;
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

// --- Deutsche Variante -------------------------------------------------------
// Das Snippet ist polnisch (Hauptsprache). Seiten unter /de/ liegen fertig
// eingedeutscht vor — dort darf der Sync nicht den polnischen Text hineinschreiben.
// Wir erzeugen die deutsche Fassung genauso, wie es germanize-de.mjs tut:
// Texte aus translations/common.json einsetzen, PL-Links auf die DE-Entsprechung
// mappen und die data-i18n-Attribute entfernen.
const dict = JSON.parse(fs.readFileSync(path.join(ROOT, 'translations/common.json'), 'utf8'));
const DE_LINK_MAP = { '/polityka-prywatnosci': '/datenschutz', '/nota-prawna': '/impressum' };

function germanize(html) {
  let out = html;
  // <tag data-i18n="key">…</tag> -> deutscher Text
  out = out.replace(/(<([a-z0-9]+)\b[^>]*\bdata-i18n="([^"]+)"[^>]*>)([\s\S]*?)(<\/\2>)/gi,
    (m, open, tag, key, _body, close) => {
      const de = dict[key] && dict[key].de;
      return de ? open + de + close : m;
    });
  // data-i18n-attr="placeholder:key" -> deutsches placeholder-Attribut
  out = out.replace(/<[^>]*\bdata-i18n-attr="([^"]+)"[^>]*>/gi, (tagStr) => {
    const spec = /data-i18n-attr="([^"]+)"/.exec(tagStr)[1];
    return spec.split(';').reduce((s, pair) => {
      const [attr, key] = pair.split(':');
      const de = dict[key] && dict[key].de;
      if (!attr || !de) return s;
      return s.replace(new RegExp(`\\b${attr}="[^"]*"`), `${attr}="${de}"`);
    }, tagStr);
  });
  // Links auf die deutschen Entsprechungen
  for (const [pl, de] of Object.entries(DE_LINK_MAP)) {
    out = out.split(`href="${pl}"`).join(`href="${de}"`);
  }
  // i18n-Marker entfernen (die DE-Seiten laden kein i18n.js mehr)
  out = out.replace(/\s+data-i18n(-html|-attr)?="[^"]*"/g, '');
  return out;
}

const snippetDe = germanize(snippet);

// --dry zeigt nur, was passieren wuerde (und die erzeugte deutsche Fassung).
const DRY = process.argv.includes('--dry');
if (DRY) {
  console.log('--- deutsche Fassung, die in /de/ geschrieben wuerde ---');
  console.log(snippetDe);
  console.log('---\n');
}

let updated = 0, unchanged = 0, noBlock = 0;

for (const file of walk(ROOT)) {
  const txt = fs.readFileSync(file, 'utf8');
  if (!BLOCK_RE.test(txt)) { noBlock++; continue; }
  const isGerman = path.relative(ROOT, file).split(path.sep)[0] === 'de';
  const next = txt.replace(BLOCK_RE, isGerman ? snippetDe : snippet);
  if (next === txt) { unchanged++; continue; }
  if (!DRY) fs.writeFileSync(file, next, 'utf8');
  updated++;
  console.log(`${DRY ? 'would update' : 'updated'}:`, path.relative(ROOT, file));
}

console.log(`\nDone. updated=${updated}, unchanged=${unchanged}, no_block=${noBlock}`);
