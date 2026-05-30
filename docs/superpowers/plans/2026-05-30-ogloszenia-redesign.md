# Ogłoszenia Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the oversized Ogłoszenia card on the homepage with a compact one-line teaser strip that links to a new dedicated `/ogloszenia.html` page rendering the full weekly parish bulletin, with browser-print support for parishioners.

**Architecture:** Extract the shared fetch + block-render logic from `main.js` into a new `js/ogloszenia.js` IIFE module (`window.PMK_Ogloszenia`) reused by both the homepage strip and the new detail page. Detail page uses class-based selectors to avoid ID clashes with `main.js`. No backend or sheet changes.

**Tech Stack:** Vanilla JS (no build step, no test framework), classic `<script defer>` loading, JSON-based i18n via `js/i18n.js`, Netlify Functions proxy for Google Sheets, manual `netlify deploy --prod --dir=.` for releases.

**Spec:** `docs/superpowers/specs/2026-05-30-ogloszenia-redesign-design.md`

**Testing model:** This project has no test runner. Each task ends with a manual browser verification step against a local file:// or `python3 -m http.server` preview. After all tasks, the final deploy + live verification is its own task.

---

## File Inventory

**Create:**
- `js/ogloszenia.js` — shared IIFE module (fetch, block render, week-range formatting)
- `ogloszenia.html` — detail page
- `translations/ogloszenia.json` — i18n keys for the detail page

**Modify:**
- `main.js` — replace inline `loadOgloszenie()` body with thin call to the shared module; update DOM population to match new strip markup
- `index.html` — replace `<section id="ogloszenia">` markup + CSS block with the new strip
- `translations/index.json` — repurpose/clean obsolete `index.ogloszenia.*` keys (lead/published_label no longer used)

**Untouched:**
- `admin/ogloszenia.js`, `netlify/functions/ogloszenia-proxy`, Google Sheet schema, all other pages

---

## Task 1: Create shared module `js/ogloszenia.js` (behavior-identical extraction)

This task only extracts the existing logic into a reusable module. No UI changes yet. After this task, `main.js` still works unchanged (the module sits unused).

**Files:**
- Create: `js/ogloszenia.js`

- [ ] **Step 1: Create the module file**

Create `js/ogloszenia.js` with:

```js
/**
 * PMK Berlin — Ogłoszenia shared module
 * Used by:
 *   - main.js (homepage teaser strip)
 *   - ogloszenia.html (detail page)
 *
 * Exposes:
 *   window.PMK_Ogloszenia = {
 *     fetchCurrent(),          // async → { id, title, body, publishedAt } | null
 *     renderBlocks(body),      // string → HTML string
 *     formatWeekRange(date, lang), // (Date, 'pl'|'de') → "Tydzień · 29 maja – 4 czerwca 2026"
 *     getLang()                // () → 'pl' | 'de'
 *   }
 */
(function () {
  'use strict';

  const OGLOSZENIA_API = '/.netlify/functions/ogloszenia-proxy';

  function getLang() {
    try { return localStorage.getItem('pmk-lang') || 'pl'; } catch (e) { return 'pl'; }
  }

  function escapeHTML(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c];
    });
  }

  function parseGvizDate(cell) {
    if (!cell) return null;
    const raw = cell.v;
    const fmt = cell.f;
    const m = String(raw || '').match(/Date\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*(\d+))?)?/);
    if (m) {
      return new Date(
        parseInt(m[1], 10),
        parseInt(m[2], 10),
        parseInt(m[3], 10),
        m[4] ? parseInt(m[4], 10) : 0,
        m[5] ? parseInt(m[5], 10) : 0,
        m[6] ? parseInt(m[6], 10) : 0
      );
    }
    if (fmt) {
      const d = new Date(fmt);
      if (!isNaN(d.getTime())) return d;
    }
    if (raw) {
      const d = new Date(raw);
      if (!isNaN(d.getTime())) return d;
    }
    return null;
  }

  async function fetchCurrent() {
    try {
      const response = await fetch(OGLOSZENIA_API);
      if (!response.ok) return null;
      const text = await response.text();

      const jsonMatch = text.match(/google\.visualization\.Query\.setResponse\(([\s\S]*)\);?/);
      if (!jsonMatch || !jsonMatch[1]) return null;

      const data = JSON.parse(jsonMatch[1]);
      const rows = (data.table && data.table.rows) || [];
      if (!rows.length) return null;

      const now = new Date();
      const items = [];

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        if (!row || !row.c) continue;

        const val = function (idx) {
          const cell = row.c[idx];
          return cell ? (cell.v != null ? cell.v : (cell.f || '')) : '';
        };

        const id = val(0);
        const title = val(1);
        const body = val(2);
        const publishedAt = parseGvizDate(row.c[4]);
        const expiresAt = parseGvizDate(row.c[5]);
        const published = String(val(6) || '').toUpperCase();

        if (!title || !body) continue;
        if (published !== 'TAK') continue;
        if (!expiresAt || expiresAt <= now) continue;

        items.push({
          id: String(id),
          title: String(title),
          body: String(body),
          publishedAt: publishedAt || new Date(0)
        });
      }

      if (!items.length) return null;
      items.sort(function (a, b) { return b.publishedAt - a.publishedAt; });
      return items[0];
    } catch (e) {
      return null;
    }
  }

  function renderBlocks(body) {
    if (typeof body !== 'string') return '';
    const trimmed = body.trim();
    let blocks = null;
    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) blocks = parsed;
      } catch (e) { /* fall through to legacy HTML */ }
    }
    if (!blocks) return body; // legacy HTML, trusted

    return blocks.map(function (b) {
      if (b && b.t === 'img' && b.u) {
        const raw = String(b.u);
        const m = raw.match(/\/d\/([a-zA-Z0-9_-]+)/) || raw.match(/[?&]id=([a-zA-Z0-9_-]+)/);
        const url = m ? ('https://lh3.googleusercontent.com/d/' + m[1] + '=w1200') : raw;
        return '<img class="ogloszenia-img-block" src="' + escapeHTML(url) + '" alt="" loading="lazy">';
      }
      if (b && b.t === 'txt' && b.c) {
        return String(b.c)
          .split(/\n{2,}/)
          .map(function (par) { return '<p>' + escapeHTML(par).replace(/\n/g, '<br>') + '</p>'; })
          .join('');
      }
      return '';
    }).join('');
  }

  function formatWeekRange(publishedAt, lang) {
    if (!publishedAt || publishedAt.getTime() <= 0) return '';
    const locale = lang === 'de' ? 'de-DE' : 'pl-PL';
    const end = new Date(publishedAt.getTime());
    end.setDate(end.getDate() + 6);
    const startStr = publishedAt.toLocaleDateString(locale, { day: 'numeric', month: 'long' });
    const endStr   = end.toLocaleDateString(locale,         { day: 'numeric', month: 'long', year: 'numeric' });
    const label = lang === 'de' ? 'Woche' : 'Tydzień';
    return label + ' · ' + startStr + ' – ' + endStr;
  }

  window.PMK_Ogloszenia = {
    fetchCurrent: fetchCurrent,
    renderBlocks: renderBlocks,
    formatWeekRange: formatWeekRange,
    getLang: getLang
  };
})();
```

- [ ] **Step 2: Verify the file is syntactically valid**

Run: `node --check js/ogloszenia.js`
Expected: no output (success).

- [ ] **Step 3: Commit**

```bash
git add js/ogloszenia.js
git commit -m "feat(ogloszenia): shared js/ogloszenia.js module — fetch + block render + week range"
```

---

## Task 2: Wire the shared module into the existing homepage `loadOgloszenie()` (still using the OLD card markup — no UI change yet)

This task swaps `main.js`'s inline logic for calls into the new module, keeping the existing card visible exactly as it is. Goal: prove the module works as a drop-in before changing markup.

**Files:**
- Modify: `index.html` (add the script tag for the new module)
- Modify: `main.js:163-331` (replace inline body of `loadOgloszenie` with module calls)

- [ ] **Step 1: Add the script tag to `index.html`**

Find the existing script block near the end of `index.html`:

```bash
grep -n "js/i18n.js\|main.js" /Users/michal/VintAI/Projekte/pmk-redesign/index.html
```

Expected output includes lines like:
```
1159:<script src="js/i18n.js" defer></script>
1160:<script src="main.js" defer></script>
```

Edit `index.html` to insert the new module BEFORE `main.js` (so `window.PMK_Ogloszenia` exists by the time `main.js` runs):

```html
<script src="js/i18n.js" defer></script>
<script src="js/ogloszenia.js" defer></script>
<script src="main.js" defer></script>
```

- [ ] **Step 2: Replace the body of `loadOgloszenie()` in `main.js`**

Open `main.js`. The current function spans roughly lines 193–331. Replace the ENTIRE function (and the helper `parseGvizDate` at lines 165–191 and the constant `OGLOSZENIA_API` at line 163) with:

```js
  async function loadOgloszenie() {
    const section = document.getElementById('ogloszenia');
    if (!section) return;
    if (!window.PMK_Ogloszenia) return;

    const data = await window.PMK_Ogloszenia.fetchCurrent();
    if (!data) return;

    const titleEl = document.getElementById('ogloszenia-title');
    const dateEl = document.getElementById('ogloszenia-date');
    const bodyEl = document.getElementById('ogloszenia-body');
    const imgEl = document.getElementById('ogloszenia-image');

    if (titleEl) titleEl.textContent = data.title;
    if (dateEl) dateEl.textContent = window.PMK_Ogloszenia.formatWeekRange(data.publishedAt, window.PMK_Ogloszenia.getLang());
    if (bodyEl) bodyEl.innerHTML = window.PMK_Ogloszenia.renderBlocks(data.body);
    if (imgEl) {
      imgEl.removeAttribute('src');
      imgEl.hidden = true;
    }

    section.removeAttribute('hidden');
  }
```

Delete the now-dead constant `OGLOSZENIA_API` (line 163) and the helper `parseGvizDate` (lines 165-191) — both are now inside the shared module.

- [ ] **Step 3: Syntax check**

Run: `node --check main.js`
Expected: no output (success).

- [ ] **Step 4: Manual browser verification**

Start a local server in repo root:
```bash
python3 -m http.server 8000
```

Open http://localhost:8000/ in a browser. Hard-refresh (Cmd+Shift+R). The Ogłoszenia card should appear above the events grid with:
- Date label: "Tydzień · 29 maja – 4 czerwca 2026" (uppercase via CSS)
- Title: "wefweF" (whatever the current Sheet row shows)
- Body: parsed blocks (image inline + paragraph), NO raw JSON visible

If raw JSON appears in the body, the module wiring is wrong — re-check Step 1 (script tag order) and Step 2 (function body).

Stop the server: Ctrl+C.

- [ ] **Step 5: Commit**

```bash
git add index.html main.js
git commit -m "refactor(ogloszenia): main.js loadOgloszenie() now delegates to shared module"
```

---

## Task 3: Add translations file `translations/ogloszenia.json`

The new detail page needs its own translation JSON. `js/i18n.js` infers the page name from the URL (`/ogloszenia.html` → `ogloszenia`) and loads `translations/ogloszenia.json` automatically.

**Files:**
- Create: `translations/ogloszenia.json`

- [ ] **Step 1: Create the file**

Create `translations/ogloszenia.json` with:

```json
{
  "ogloszenia.page.eyebrow": {
    "pl": "Ogłoszenia duszpasterskie",
    "de": "Pfarrblatt"
  },
  "ogloszenia.page.print": {
    "pl": "Drukuj",
    "de": "Drucken"
  },
  "ogloszenia.page.back": {
    "pl": "← Strona główna",
    "de": "← Zur Startseite"
  },
  "ogloszenia.page.empty": {
    "pl": "Aktualnie brak ogłoszeń.",
    "de": "Aktuell keine Ankündigungen."
  }
}
```

- [ ] **Step 2: Verify JSON is valid**

Run: `node -e "JSON.parse(require('fs').readFileSync('translations/ogloszenia.json'))"`
Expected: no output (success).

- [ ] **Step 3: Commit**

```bash
git add translations/ogloszenia.json
git commit -m "i18n(ogloszenia): translations for /ogloszenia.html detail page"
```

---

## Task 4: Rewrite homepage strip markup + CSS (the actual visual change on the homepage)

Replace the existing card with a compact strip that links to `/ogloszenia.html`.

**Files:**
- Modify: `index.html:283-379` (the `<style>` block and `<section id="ogloszenia">`)
- Modify: `main.js` (`loadOgloszenie` from Task 2 — minor cleanup: no body/image needed)

- [ ] **Step 1: Replace the `<style>` block and section markup in `index.html`**

Open `index.html` and locate the block starting at line 283 (`<!-- Ogłoszenia duszpasterskie ... -->`) ending at line 379 (`</section>`). Replace the ENTIRE block (style + section) with:

```html
<!-- Ogłoszenia duszpasterskie (parish announcements) — compact teaser strip -->
<!-- Hidden by default; main.js unhides once a current (non-expired, published) ogłoszenie is fetched. -->
<style>
  .section-ogloszenia-strip { padding: 2rem 0 0.5rem; background: var(--color-warm-50, #faf6f0); }
  .ogloszenia-strip {
    display: flex;
    align-items: center;
    gap: 1rem;
    max-width: 780px;
    margin: 0 auto;
    padding: 0.9rem 1.25rem;
    background: #fff;
    border: 1px solid var(--color-warm-200, #e8dfd1);
    border-left: 3px solid var(--color-accent, #b4593e);
    border-radius: 8px;
    box-shadow: 0 1px 6px rgba(0,0,0,0.04);
    text-decoration: none;
    color: inherit;
    transition: box-shadow 0.18s ease, transform 0.18s ease;
  }
  .ogloszenia-strip:hover,
  .ogloszenia-strip:focus-visible {
    box-shadow: 0 4px 14px rgba(0,0,0,0.08);
    transform: translateY(-1px);
    outline: none;
  }
  .ogloszenia-strip-date {
    font-family: var(--font-sans, Outfit), sans-serif;
    font-size: 0.7rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--color-accent, #b4593e);
    white-space: nowrap;
    flex-shrink: 0;
  }
  .ogloszenia-strip-title {
    font-family: 'Cormorant', serif;
    font-style: italic;
    font-size: 1.15rem;
    color: var(--color-warm-900, #2a2520);
    flex: 1 1 auto;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }
  .ogloszenia-strip-arrow {
    font-size: 1.2rem;
    color: var(--color-accent, #b4593e);
    flex-shrink: 0;
    transition: transform 0.18s ease;
  }
  .ogloszenia-strip:hover .ogloszenia-strip-arrow,
  .ogloszenia-strip:focus-visible .ogloszenia-strip-arrow { transform: translateX(3px); }
  @media (max-width: 640px) {
    .section-ogloszenia-strip { padding: 1.25rem 0 0.25rem; }
    .ogloszenia-strip {
      flex-wrap: wrap;
      padding: 0.85rem 1rem;
      gap: 0.4rem 0.75rem;
    }
    .ogloszenia-strip-date { flex-basis: 100%; }
    .ogloszenia-strip-title { font-size: 1.05rem; white-space: normal; }
  }
</style>
<section class="section-ogloszenia-strip" id="ogloszenia" hidden>
  <div class="section-container">
    <a class="ogloszenia-strip" href="/ogloszenia.html" id="ogloszenia-link" aria-label="Ogłoszenia duszpasterskie">
      <span class="ogloszenia-strip-date" id="ogloszenia-date"></span>
      <span class="ogloszenia-strip-title" id="ogloszenia-title"></span>
      <span class="ogloszenia-strip-arrow" aria-hidden="true">→</span>
    </a>
  </div>
</section>
```

- [ ] **Step 2: Simplify `loadOgloszenie()` in `main.js` — drop body + image population**

The strip has no body or image. Update the function body (from Task 2) to:

```js
  async function loadOgloszenie() {
    const section = document.getElementById('ogloszenia');
    if (!section) return;
    if (!window.PMK_Ogloszenia) return;

    const data = await window.PMK_Ogloszenia.fetchCurrent();
    if (!data) return;

    const titleEl = document.getElementById('ogloszenia-title');
    const dateEl = document.getElementById('ogloszenia-date');
    const linkEl = document.getElementById('ogloszenia-link');

    if (titleEl) titleEl.textContent = data.title;
    if (dateEl) dateEl.textContent = window.PMK_Ogloszenia.formatWeekRange(data.publishedAt, window.PMK_Ogloszenia.getLang());
    if (linkEl) {
      const langLabel = window.PMK_Ogloszenia.getLang() === 'de' ? 'Pfarrblatt — ' : 'Ogłoszenia duszpasterskie — ';
      linkEl.setAttribute('aria-label', langLabel + data.title);
    }

    section.removeAttribute('hidden');
  }
```

(The `bodyEl` and `imgEl` references from Task 2 disappear because the new markup has neither.)

- [ ] **Step 3: Syntax check**

Run: `node --check main.js`
Expected: no output.

- [ ] **Step 4: Clean up obsolete i18n keys in `translations/index.json`**

The strip doesn't use `index.ogloszenia.lead` or `index.ogloszenia.published_label` anymore. Open `translations/index.json` and delete those two key entries (keep `index.ogloszenia.title` — it stays usable for the section's `aria-label` if needed; if not referenced after this change, also remove).

Verify which keys still get referenced:
```bash
grep -rn "index.ogloszenia" --include="*.html" --include="*.js" .
```

Delete every JSON key not appearing in that grep result.

- [ ] **Step 5: Manual browser verification**

```bash
python3 -m http.server 8000
```

Open http://localhost:8000/ and hard-refresh.

Verify:
- A single horizontal strip appears between the hero/CTA and the events grid
- Layout: `[TYDZIEŃ · 29 MAJA – 4 CZERWCA 2026]   wefweF   →`
- Hover lifts the strip slightly + shifts arrow right
- Click strip → browser navigates to `/ogloszenia.html` (404 until Task 5 lands — that's expected)
- Use browser DevTools to switch to mobile viewport (<640px): date wraps to its own line above the title
- Switch language to DE via the language toggle: date label becomes "WOCHE · 29. MAI – 4. JUNI 2026"

Stop server: Ctrl+C.

- [ ] **Step 6: Commit**

```bash
git add index.html main.js translations/index.json
git commit -m "feat(ogloszenia): compact homepage teaser strip linking to /ogloszenia.html"
```

---

## Task 5: Create the detail page `ogloszenia.html`

New file copying the navbar/footer pattern from `kontakt.html`, with a new article main and inline loader script.

**Files:**
- Create: `ogloszenia.html`

- [ ] **Step 1: Identify the navbar + footer blocks to copy from `kontakt.html`**

Read the navbar and footer regions of `kontakt.html` for reference:

```bash
sed -n '40,150p' /Users/michal/VintAI/Projekte/pmk-redesign/kontakt.html  # head + navbar region
sed -n '350,430p' /Users/michal/VintAI/Projekte/pmk-redesign/kontakt.html  # footer + scripts region
```

Note the exact navbar HTML, footer HTML, and the three trailing script tags (`js/i18n.js`, `main.js`, `js/pmk-chat.js`). You will reuse these verbatim.

- [ ] **Step 2: Create `ogloszenia.html`**

Create `ogloszenia.html` at the repo root. Use the kontakt.html scaffold (head + navbar + footer + scripts) but replace the `<main>` content with the article shown below and add the new module script + inline loader.

Skeleton — fill the navbar and footer by copying the corresponding blocks from `kontakt.html` verbatim (just change page-specific labels):

```html
<!DOCTYPE html>
<html lang="pl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="icon" type="image/x-icon" href="images/favicon.ico">
  <link rel="icon" type="image/png" sizes="32x32" href="images/favicon-32.png">
  <link rel="apple-touch-icon" sizes="180x180" href="images/apple-touch-icon.png">
  <title>Ogłoszenia duszpasterskie | Polska Misja Katolicka Berlin</title>
  <meta name="description" content="Aktualne ogłoszenia duszpasterskie Polskiej Misji Katolickiej w Berlinie — biuletyn parafialny tygodnia.">
  <link rel="canonical" href="https://www.pmk-berlin.de/ogloszenia.html">
  <meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1">
  <meta name="author" content="Polska Misja Katolicka Berlin">

  <link rel="alternate" hreflang="pl" href="https://www.pmk-berlin.de/ogloszenia.html">
  <link rel="alternate" hreflang="x-default" href="https://www.pmk-berlin.de/ogloszenia.html">

  <meta property="og:title" content="Ogłoszenia duszpasterskie | Polska Misja Katolicka Berlin">
  <meta property="og:description" content="Aktualne ogłoszenia duszpasterskie Polskiej Misji Katolickiej w Berlinie.">
  <meta property="og:type" content="article">
  <meta property="og:url" content="https://www.pmk-berlin.de/ogloszenia.html">
  <meta property="og:locale" content="pl_PL">
  <meta property="og:locale:alternate" content="de_DE">
  <meta property="og:site_name" content="PMK Berlin">

  <!-- Reuse existing global stylesheets — same set as kontakt.html -->
  <!-- Copy <link rel="stylesheet"> tags VERBATIM from kontakt.html <head>. -->

  <style>
    .ogloszenia-page { background: var(--color-warm-50, #faf6f0); padding: 3rem 0 4rem; min-height: 60vh; }
    .ogloszenia-page-container { max-width: 720px; margin: 0 auto; padding: 0 1.25rem; }

    .ogloszenia-back {
      display: inline-block;
      font-family: var(--font-sans, Outfit), sans-serif;
      font-size: 0.85rem;
      color: var(--color-accent, #b4593e);
      text-decoration: none;
      margin-bottom: 1.25rem;
    }
    .ogloszenia-back:hover { text-decoration: underline; }

    .ogloszenia-article {
      background: #fff;
      border: 1px solid var(--color-warm-200, #e8dfd1);
      border-left: 3px solid var(--color-accent, #b4593e);
      border-radius: 10px;
      padding: 2.5rem 2.5rem 2rem;
      box-shadow: 0 2px 12px rgba(0,0,0,0.04);
      position: relative;
    }
    .ogloszenia-article-header { margin-bottom: 1.5rem; }
    .ogloszenia-eyebrow {
      font-family: var(--font-sans, Outfit), sans-serif;
      font-size: 0.72rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.14em;
      color: var(--color-accent, #b4593e);
      margin: 0 0 0.5rem;
    }
    .ogloszenia-article-title {
      font-family: 'Cormorant', serif;
      font-style: italic;
      font-size: clamp(1.7rem, 3.5vw, 2.25rem);
      font-weight: 500;
      color: var(--color-warm-900, #2a2520);
      margin: 0 0 0.6rem;
      line-height: 1.2;
    }
    .ogloszenia-article-meta {
      font-size: 0.85rem;
      color: var(--color-warm-500, #8a7a65);
      margin: 0;
      letter-spacing: 0.02em;
    }
    .ogloszenia-print {
      position: absolute;
      top: 1.25rem;
      right: 1.25rem;
      font-family: var(--font-sans, Outfit), sans-serif;
      font-size: 0.78rem;
      padding: 0.45rem 0.85rem;
      background: transparent;
      border: 1px solid var(--color-warm-300, #d4c8b6);
      border-radius: 999px;
      color: var(--color-warm-700, #574c40);
      cursor: pointer;
      transition: background 0.18s ease, color 0.18s ease, border-color 0.18s ease;
    }
    .ogloszenia-print:hover {
      background: var(--color-accent, #b4593e);
      color: #fff;
      border-color: var(--color-accent, #b4593e);
    }
    .ogloszenia-article-body {
      font-size: 1rem;
      line-height: 1.7;
      color: var(--color-warm-800, #3a342d);
    }
    .ogloszenia-article-body p { margin: 0 0 1rem; }
    .ogloszenia-article-body p:last-child { margin-bottom: 0; }
    .ogloszenia-article-body a { color: var(--color-accent, #b4593e); text-decoration: underline; }
    .ogloszenia-article-body .ogloszenia-img-block {
      display: block;
      width: 100%;
      max-height: 460px;
      object-fit: cover;
      border-radius: 6px;
      margin: 1.25rem 0;
    }

    .ogloszenia-empty {
      text-align: center;
      padding: 4rem 1rem;
      color: var(--color-warm-500, #8a7a65);
      font-style: italic;
    }

    @media (max-width: 640px) {
      .ogloszenia-page { padding: 1.5rem 0 3rem; }
      .ogloszenia-article { padding: 1.75rem 1.25rem 1.5rem; border-radius: 8px; }
      .ogloszenia-print {
        position: static;
        margin-top: 1rem;
        display: inline-block;
      }
    }

    /* Print layout — A4-friendly, no chrome */
    @media print {
      @page { margin: 1.5cm; }
      body { background: #fff; color: #000; }
      .navbar, .footer, .pmk-chatbot, #pmk-chatbot, .lang-switcher,
      .ogloszenia-back, .ogloszenia-print { display: none !important; }
      .ogloszenia-page { background: #fff; padding: 0; }
      .ogloszenia-page-container { max-width: 100%; padding: 0; }
      .ogloszenia-article {
        background: #fff;
        border: none;
        border-left: none;
        border-radius: 0;
        box-shadow: none;
        padding: 0;
      }
      .ogloszenia-article-title { font-size: 1.6rem; color: #000; }
      .ogloszenia-eyebrow, .ogloszenia-article-meta { color: #555; }
      .ogloszenia-article-body { font-size: 0.95rem; line-height: 1.55; color: #000; }
      .ogloszenia-article-body p { page-break-inside: avoid; }
      .ogloszenia-article-body .ogloszenia-img-block { page-break-inside: avoid; max-height: none; }
    }
  </style>
</head>
<body>

<!-- Navbar: copy VERBATIM from kontakt.html (lines ~40-150). Same nav structure as every page. -->

<main class="ogloszenia-page">
  <div class="ogloszenia-page-container">
    <a class="ogloszenia-back" href="/" data-i18n="ogloszenia.page.back">← Strona główna</a>

    <article class="ogloszenia-article" id="ogloszenia-article" hidden>
      <header class="ogloszenia-article-header">
        <p class="ogloszenia-eyebrow" data-i18n="ogloszenia.page.eyebrow">Ogłoszenia duszpasterskie</p>
        <h1 class="ogloszenia-article-title" id="ogloszenia-article-title"></h1>
        <p class="ogloszenia-article-meta" id="ogloszenia-article-meta"></p>
        <button type="button" class="ogloszenia-print" id="ogloszenia-print-btn" data-i18n="ogloszenia.page.print">Drukuj</button>
      </header>
      <div class="ogloszenia-article-body" id="ogloszenia-article-body"></div>
    </article>

    <div class="ogloszenia-empty" id="ogloszenia-empty" hidden>
      <p data-i18n="ogloszenia.page.empty">Aktualnie brak ogłoszeń.</p>
    </div>
  </div>
</main>

<!-- Footer: copy VERBATIM from kontakt.html (lines ~355-420). Same footer as every page. -->

<script src="js/i18n.js" defer></script>
<script src="js/ogloszenia.js" defer></script>
<script src="main.js" defer></script>
<script type="module" src="js/pmk-chat.js"></script>

<script>
  // Detail page loader — uses class-based selectors that DO NOT conflict with main.js
  // (main.js's loadOgloszenie targets #ogloszenia, which doesn't exist on this page).
  (function () {
    'use strict';

    function init() {
      if (!window.PMK_Ogloszenia) {
        // Module not loaded yet — retry once after a tick (defer ordering safety net)
        setTimeout(init, 50);
        return;
      }

      const article = document.getElementById('ogloszenia-article');
      const empty = document.getElementById('ogloszenia-empty');
      const titleEl = document.getElementById('ogloszenia-article-title');
      const metaEl = document.getElementById('ogloszenia-article-meta');
      const bodyEl = document.getElementById('ogloszenia-article-body');
      const printBtn = document.getElementById('ogloszenia-print-btn');

      window.PMK_Ogloszenia.fetchCurrent().then(function (data) {
        if (!data) {
          if (empty) empty.hidden = false;
          return;
        }
        if (titleEl) titleEl.textContent = data.title;
        if (metaEl) metaEl.textContent = window.PMK_Ogloszenia.formatWeekRange(data.publishedAt, window.PMK_Ogloszenia.getLang());
        if (bodyEl) bodyEl.innerHTML = window.PMK_Ogloszenia.renderBlocks(data.body);
        if (article) article.hidden = false;
      }).catch(function () {
        if (empty) empty.hidden = false;
      });

      if (printBtn) {
        printBtn.addEventListener('click', function () { window.print(); });
      }
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init);
    } else {
      init();
    }
  })();
</script>

</body>
</html>
```

When filling in navbar/footer/stylesheets, use Read on `kontakt.html` and copy the exact blocks. Do not paraphrase — the structure must match other pages so the language switcher, chatbot, and global CSS all work identically.

- [ ] **Step 3: Manual browser verification**

```bash
python3 -m http.server 8000
```

Open http://localhost:8000/ogloszenia.html. Verify:
- Navbar and footer render identically to kontakt.html
- Article card appears with eyebrow "OGŁOSZENIA DUSZPASTERSKIE", large italic title, week range meta, body with image + paragraph, print button top-right
- Click "Drukuj" → browser print preview opens, navbar/footer/chatbot/back-link/print-button are HIDDEN, body is clean A4 layout
- Switch to DE: eyebrow becomes "PFARRBLATT", print button "Drucken", back link "← Zur Startseite"
- Empty state: temporarily edit the Sheet row (set `published = NIE` or change `expires_at` to past), wait ~1 minute for proxy cache or hard-refresh — page now shows "Aktualnie brak ogłoszeń." instead of the article. Restore the Sheet row.
- Click "← Strona główna" → navigates back to homepage
- Click the homepage strip → navigates back to `/ogloszenia.html`

Stop server: Ctrl+C.

- [ ] **Step 4: Commit**

```bash
git add ogloszenia.html
git commit -m "feat(ogloszenia): new /ogloszenia.html detail page with print layout"
```

(Note: `translations/ogloszenia.json` was committed separately in Task 3.)

---

## Task 6: Final cross-check + deploy

**Files:**
- None (verification + deploy only)

- [ ] **Step 1: Full local browser walkthrough**

Start server: `python3 -m http.server 8000`

Walk through end-to-end:
1. http://localhost:8000/ — strip visible, hover/focus works, mobile viewport wraps cleanly
2. Click strip → /ogloszenia.html — full bulletin renders
3. Drukuj button → clean print preview
4. DE toggle on both pages → labels swap, body content stays as-written
5. With Sheet row set to `published = NIE`: homepage strip hidden, /ogloszenia.html shows empty state
6. Restore Sheet row to `published = TAK`

- [ ] **Step 2: Check for console errors**

In browser DevTools console while loading each page: should be clean (no errors, no warnings about missing translations).

Common false positives to ignore:
- VAPI/ElevenLabs widget warnings (unrelated)
- 404s for optional analytics scripts (unrelated)

If you see "PMK_Ogloszenia is undefined" or similar: the `js/ogloszenia.js` script tag is missing or out of order. Re-check Task 5 Step 2.

- [ ] **Step 3: Deploy to Netlify (manual — per project convention)**

This project has **no Netlify CI auto-deploy**. `git push` does not deploy. From the repo root:

```bash
netlify deploy --prod --dir=.
```

Expected: a "Website Deploy URL" and "Website URL" line. The deploy URL becomes the new live version of `pmk-berlinpl.netlify.app`.

- [ ] **Step 4: Live verification**

Open https://pmk-berlinpl.netlify.app/ in a fresh browser session (or hard-refresh). Repeat the local walkthrough on the live URL:
1. Homepage strip visible and clickable
2. /ogloszenia.html renders correctly
3. Print preview clean
4. DE toggle works

- [ ] **Step 5: Push the commits to origin**

```bash
git push
```

(Push happens AFTER deploy succeeds — per project convention, the deploy is the source of truth, not the git push.)

---

## Self-Review (run before handing off)

After completing the plan above, walk through this checklist:

- **Strip on homepage** rendered as one-line teaser? Task 4 covers this.
- **Detail page `/ogloszenia.html`** with full bulletin? Task 5 covers this.
- **Print-optimized layout** for parishioners? Task 5 Step 2 includes `@media print` block.
- **Empty state** on detail page when nothing published? Task 5 markup + loader script handle this.
- **Bilingual chrome** (PL/DE labels)? Tasks 3 + 5 set up translations + `data-i18n` attributes.
- **Body stays single-language** (known limitation)? Confirmed — no body translation logic added anywhere.
- **No archive of past weeks**? Confirmed — `fetchCurrent()` returns only the most recent record.
- **No PDF download**? Confirmed — only browser print.
- **No editor / Sheet schema changes**? Confirmed — admin/, netlify/functions/, and Sheet untouched.
- **`image_url` field ignored** in new code path? Confirmed — Task 1 module's `fetchCurrent` does not read column D.
- **Detail page IDs don't clash with `main.js`**? Detail page uses `#ogloszenia-article-title` / `#ogloszenia-article-meta` / `#ogloszenia-article-body`; main.js looks for `#ogloszenia-title` / `#ogloszenia-date` which live inside `#ogloszenia` (homepage only, doesn't exist on detail page where main.js bails on the missing `#ogloszenia`).
- **Edge case — malformed JSON body**? `renderBlocks` falls through to legacy `innerHTML` of the raw string. Worst case: visible literal text, not a crash.
