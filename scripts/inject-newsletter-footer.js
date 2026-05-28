#!/usr/bin/env node
// Verteilt das Newsletter-Snippet in alle Public-HTML-Seiten.
// Idempotent: laeuft sicher mehrfach, fuegt nichts doppelt ein.

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

const SNIPPET_PATH = path.join(ROOT, 'components/newsletter-footer.html');
const snippet = fs.readFileSync(SNIPPET_PATH, 'utf8').trim();
const MARKER = '<!-- BEGIN newsletter-footer -->';
const INSERTION_POINT = '<div class="footer-bottom">';

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

let injected = 0, skippedAlready = 0, skippedNoFooter = 0;

for (const file of walk(ROOT)) {
  const txt = fs.readFileSync(file, 'utf8');
  if (txt.includes(MARKER)) { skippedAlready++; continue; }
  if (!txt.includes(INSERTION_POINT)) { skippedNoFooter++; console.log('skipped_no_footer:', path.relative(ROOT, file)); continue; }
  const next = txt.replace(INSERTION_POINT, snippet + '\n\n    ' + INSERTION_POINT);
  fs.writeFileSync(file, next, 'utf8');
  injected++;
  console.log('injected:', path.relative(ROOT, file));
}

console.log(`\nDone. injected=${injected}, skipped_already=${skippedAlready}, skipped_no_footer=${skippedNoFooter}`);
