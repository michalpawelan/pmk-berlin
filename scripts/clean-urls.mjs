#!/usr/bin/env node
/**
 * clean-urls.mjs — strippt einmalig „.html" aus allen internen URLs der
 * statischen Quelldateien (Root-*.html, de/*.html, components/*.html) und der
 * sitemap.xml. Nutzt die geteilte cleanUrls()-Transformation.
 *
 * admin/ wird bewusst ausgelassen (interne, nicht indexierte Tool-Seiten,
 * 0 interne .html-Links). 404.html-Referenzen bleiben (siehe lib-clean-urls).
 *
 * Idempotent — kann beliebig oft laufen.
 *   node scripts/clean-urls.mjs           → schreiben
 *   node scripts/clean-urls.mjs --dry     → nur zeigen, was sich ändern würde
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanUrls } from './lib-clean-urls.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DRY = process.argv.includes('--dry');

const files = [];
for (const dir of ['.', 'de', 'components']) {
  let names;
  try { names = readdirSync(join(ROOT, dir)); } catch { continue; }
  for (const name of names) {
    if (name.endsWith('.html')) files.push(dir === '.' ? name : `${dir}/${name}`);
  }
}
files.push('sitemap.xml');

let changedFiles = 0, totalDelta = 0;
for (const rel of files) {
  const path = join(ROOT, rel);
  let before;
  try { before = readFileSync(path, 'utf8'); } catch { continue; }
  const after = cleanUrls(before);
  if (after === before) continue;
  const delta = (before.match(/\.html/g) || []).length - (after.match(/\.html/g) || []).length;
  changedFiles++;
  totalDelta += delta;
  if (!DRY) writeFileSync(path, after);
  console.log(`${DRY ? '[dry] ' : ''}${rel}  −${delta} .html`);
}
console.log(`\n${DRY ? '[dry] ' : ''}${changedFiles} Dateien, ${totalDelta} .html entfernt.`);
