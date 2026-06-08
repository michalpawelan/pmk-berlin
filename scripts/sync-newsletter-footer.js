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

let updated = 0, unchanged = 0, noBlock = 0;

for (const file of walk(ROOT)) {
  const txt = fs.readFileSync(file, 'utf8');
  if (!BLOCK_RE.test(txt)) { noBlock++; continue; }
  const next = txt.replace(BLOCK_RE, snippet);
  if (next === txt) { unchanged++; continue; }
  fs.writeFileSync(file, next, 'utf8');
  updated++;
  console.log('updated:', path.relative(ROOT, file));
}

console.log(`\nDone. updated=${updated}, unchanged=${unchanged}, no_block=${noBlock}`);
