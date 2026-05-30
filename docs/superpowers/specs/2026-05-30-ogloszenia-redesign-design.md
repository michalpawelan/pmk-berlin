# Ogłoszenia Redesign — Design Spec

**Date:** 2026-05-30
**Status:** Draft, awaiting user review
**Context:** Pre-launch (08.06.2026 DNS cutover)

## Problem

The current homepage Ogłoszenia card is too prominent and visually heavy: large hero image, full body inline, raw JSON leaking through when the body is block-encoded. It buries the events grid below the fold and looks unprofessional. The proboszcz's weekly bulletin deserves its own page; the homepage should only tease it.

## Goal

Turn the homepage Ogłoszenia card into a compact one-line teaser strip and move the full weekly bulletin onto its own dedicated page (`/ogloszenia.html`) with a print-optimized layout for parishioners who want to take it to church.

## Non-Goals

- **No archive of past weeks.** When a new ogłoszenie is published, the previous one disappears. Confirmed with user.
- **No PDF download.** Browser print (Cmd+P → "Save as PDF") is enough.
- **No editor/sheet changes.** The admin block editor and Sheet schema stay as they are.
- **No bilingual body content.** The proboszcz writes the body once (typically Polish). Only the page chrome (labels, buttons) is bilingual via existing `data-i18n` system. This is a known limitation, out of scope for this redesign.
- **No legacy `image_url` migration.** The hero image field in the Sheet is no longer rendered anywhere by the new code path. The column stays in the sheet for backwards compatibility but is unused.

## Scope

Two pieces:
1. **Homepage teaser** — rewrite the existing `#ogloszenia` section in `index.html` (and the `loadOgloszenie()` function in `main.js`) so it renders a compact strip instead of a full card.
2. **Detail page** — new file `ogloszenia.html` at repo root, plus a small `assets/ogloszenia.js` module reused by both teaser and detail page for fetching and block rendering.

## User Flow

1. User lands on homepage.
2. If a current (published, non-expired) ogłoszenie exists, a compact strip appears between the hero and the events grid:
   ```
   ┌──────────────────────────────────────────────────────────────┐
   │ TYDZIEŃ · 29 MAJA – 4 CZERWCA   Uroczystość Najświętszego…  →│
   └──────────────────────────────────────────────────────────────┘
   ```
3. The entire strip is a single clickable link to `/ogloszenia.html`.
4. On the detail page: warm cream layout matching the rest of the site, large editor-set title, week range subtitle, body rendered with the existing block renderer (text paragraphs + inline images), small "Drukuj" / "Drucken" button top-right, "← Strona główna" / "← Zur Startseite" back link top-left.
5. Print: hides chrome, formats body for A4.
6. If no current ogłoszenie: homepage strip stays hidden (today's behavior). Detail page shows a friendly empty state.

## Components

### 1. `assets/ogloszenia.js` (new — shared module)

Extracts the current `loadOgloszenie()` logic from `main.js` into a reusable module. Exposes:

- `fetchCurrentOgloszenie()` — async function that calls the Netlify proxy, parses gviz response, filters for `published === 'TAK'` and `expires_at > now`, returns the most recent record as `{id, title, body, publishedAt}` or `null`.
- `renderBlocks(body)` — accepts the raw body string. If it parses as a JSON array, renders blocks (`{t:'txt'}` → `<p>`, `{t:'img'}` → `<img>` with Drive URL resolution and lazy-loading); otherwise returns the string as legacy HTML. Returns an HTML string.
- `formatWeekRange(publishedAt, lang)` — returns `"Tydzień · 29 maja – 4 czerwca 2026"` (PL) or `"Woche · 29. Mai – 4. Juni 2026"` (DE). Week = publishedAt + 6 days.

This module is loaded by both `index.html` (for the teaser) and `ogloszenia.html` (for the detail page). The current inline block in `main.js` is replaced with a thin call to this module.

### 2. Homepage teaser (`index.html` + `main.js`)

**Markup** (replaces lines 364–379 of `index.html`):

```html
<section class="section-ogloszenia-strip" id="ogloszenia" hidden>
  <div class="section-container">
    <a class="ogloszenia-strip" href="/ogloszenia.html" id="ogloszenia-link">
      <span class="ogloszenia-strip-date" id="ogloszenia-date"></span>
      <span class="ogloszenia-strip-title" id="ogloszenia-title"></span>
      <span class="ogloszenia-strip-arrow" aria-hidden="true">→</span>
    </a>
  </div>
</section>
```

**Styles** (replace the existing `.section-ogloszenia` CSS block):

- Strip = single horizontal row, max-width 780px, centered.
- White background, soft border, left accent (matching current 3px gold accent on `.ogloszenia-card`).
- Padding ~`0.9rem 1.25rem`, border-radius 8px.
- `.ogloszenia-strip-date` — small uppercase pill, accent color, letter-spacing.
- `.ogloszenia-strip-title` — Cormorant italic, flex-grows to fill, truncates with ellipsis on overflow.
- `.ogloszenia-strip-arrow` — accent color, shifts right on hover.
- Hover: subtle lift (box-shadow), no underline.
- Mobile (<640px): title font shrinks, date stays on its own line above the title.

**JS** (`main.js` `loadOgloszenie`):

```js
const data = await fetchCurrentOgloszenie();
if (!data) return; // section stays hidden
document.getElementById('ogloszenia-date').textContent = formatWeekRange(data.publishedAt, getLang());
document.getElementById('ogloszenia-title').textContent = data.title;
document.getElementById('ogloszenia').removeAttribute('hidden');
```

No body, no image. The detail page handles all content rendering.

### 3. Detail page (`ogloszenia.html` — new)

Matches the structural conventions of existing pages like `wydarzenia.html` and `kontakt.html`: same `<head>`, navbar, footer, lang switcher, chatbot widget, `data-i18n` keys.

**Body structure:**

```html
<main class="ogloszenia-page">
  <div class="ogloszenia-page-container">
    <a class="ogloszenia-back" href="/" data-i18n="ogloszenia.back">← Strona główna</a>

    <article class="ogloszenia-article" id="ogloszenia-article" hidden>
      <header class="ogloszenia-article-header">
        <p class="ogloszenia-eyebrow" data-i18n="ogloszenia.page.eyebrow">Ogłoszenia duszpasterskie</p>
        <h1 class="ogloszenia-article-title" id="ogloszenia-title"></h1>
        <p class="ogloszenia-article-meta" id="ogloszenia-date"></p>
        <button type="button" class="ogloszenia-print" id="ogloszenia-print" data-i18n="ogloszenia.print">Drukuj</button>
      </header>
      <div class="ogloszenia-article-body" id="ogloszenia-body"></div>
    </article>

    <div class="ogloszenia-empty" id="ogloszenia-empty" hidden>
      <p data-i18n="ogloszenia.empty">Aktualnie brak ogłoszeń.</p>
    </div>
  </div>
</main>
```

**Loading script** (inline at end of body):

```js
import { fetchCurrentOgloszenie, renderBlocks, formatWeekRange } from '/assets/ogloszenia.js';
const data = await fetchCurrentOgloszenie();
if (data) {
  document.getElementById('ogloszenia-title').textContent = data.title;
  document.getElementById('ogloszenia-date').textContent = formatWeekRange(data.publishedAt, getLang());
  document.getElementById('ogloszenia-body').innerHTML = renderBlocks(data.body);
  document.getElementById('ogloszenia-article').hidden = false;
} else {
  document.getElementById('ogloszenia-empty').hidden = false;
}
document.getElementById('ogloszenia-print').addEventListener('click', () => window.print());
```

(If ES modules don't fit the existing pattern in this codebase, the script becomes a classic `<script src="/assets/ogloszenia.js">` that attaches functions to `window.PMK_Ogloszenia`. I'll match whatever pattern the codebase already uses — to be verified during planning.)

**Styling:**

- Container max-width 720px, generous vertical padding.
- Background: same `--color-warm-50` as homepage section.
- Article card: white, border-left accent, padding ~`2.5rem 2.5rem 2rem`, border-radius 10px, soft shadow.
- Title: Cormorant italic, ~`2.25rem`, centered or left-aligned (TBD during visual check — default left).
- Eyebrow: small uppercase accent, above title.
- Meta (week range): small warm-grey, below title.
- Print button: floats top-right of header, small pill with print icon (Unicode `⎙` or inline SVG).
- Body: existing block styles reused (paragraphs, inline images via `.ogloszenia-img-block`).
- Back link: top of container, before article, small accent color.
- Empty state: centered, italic, muted color.

### 4. Print CSS (`@media print` in `ogloszenia.html`)

- Hide: navbar, footer, lang switcher, chatbot widget, back link, print button.
- Article card: no shadow, no border-radius, no background tint, border-left removed.
- Body: full page width, serif body font, generous line-height.
- Headings: avoid page-break-after; paragraphs: avoid mid-page break with `page-break-inside: avoid` where reasonable.
- Images: max-width 100%, page-break-inside avoid.
- Set `@page { margin: 1.5cm }` for A4.

### 5. i18n keys (new)

Add to whichever i18n source the existing site uses (likely `data-i18n` lookup tables in `main.js` or a JSON):

| key | PL | DE |
|---|---|---|
| `ogloszenia.page.title` (used in `<title>`) | Ogłoszenia duszpasterskie — Polska Misja Katolicka Berlin | Pfarrblatt — Polnische Katholische Mission Berlin |
| `ogloszenia.page.eyebrow` | Ogłoszenia duszpasterskie | Pfarrblatt |
| `ogloszenia.print` | Drukuj | Drucken |
| `ogloszenia.back` | ← Strona główna | ← Zur Startseite |
| `ogloszenia.empty` | Aktualnie brak ogłoszeń. | Aktuell keine Ankündigungen. |

The week-range label ("Tydzień" / "Woche") stays inside `formatWeekRange()` since it's interpolated with dates.

## Data Flow

```
Google Sheet (Ogłoszenia tab)
         │
         ▼
Netlify Function (ogloszenia-proxy)
         │
         ▼
fetchCurrentOgloszenie()  ◄── loaded by both pages
         │
         ├──► Homepage teaser: date + title only
         │
         └──► Detail page: title + week + renderBlocks(body) + print button
```

No new backend, no new endpoints, no sheet schema changes.

## Edge Cases

- **No current ogłoszenie** (none published or all expired): homepage strip stays hidden; detail page shows empty state.
- **Body is empty / missing**: record is skipped (today's behavior via `if (!title || !body) continue` in the fetch logic).
- **Body is legacy HTML** (older row written before the block editor): `renderBlocks()` returns it as-is via `innerHTML`. Detail page renders fine; teaser unaffected (body not shown).
- **Body is malformed JSON** (starts with `[` but fails parse): `renderBlocks()` falls through to legacy HTML behavior (`innerHTML` of the raw string). Worst case: same broken look as today, contained to detail page, not homepage.
- **Very long title** on homepage: ellipsis truncation via `text-overflow: ellipsis` so the strip stays one line.
- **Print on mobile**: tested on iOS Safari → "Print" menu; should produce a clean A4 PDF without chrome.
- **Direct visit to `/ogloszenia.html` with no current ogłoszenie**: empty state — never a broken page.

## Testing Plan

Manual, in order:

1. With the current Sheet row ("wefweF" / Sacred Heart), hard-refresh homepage → strip shows "TYDZIEŃ · 29 MAJA – 4 CZERWCA   wefweF →", no body, no JSON leakage.
2. Click strip → lands on `/ogloszenia.html`. Title large, week range below, body shows the Sacred Heart image inline followed by paragraph "wEFwef". Print button visible top-right.
3. Click "Drukuj" → browser print dialog opens. Preview: no navbar, no footer, no chatbot, clean A4.
4. Switch language to DE on detail page → "Pfarrblatt" eyebrow, "Woche · 29. Mai – 4. Juni 2026" meta, "Drucken" button, "← Zur Startseite" back link. Body content unchanged (PL — known limitation).
5. In admin: set `published = NIE` on the current row, hard-refresh homepage → strip hidden. Visit `/ogloszenia.html` directly → empty state.
6. Restore `published = TAK`. Add a malformed body (e.g., `[broken json`) → detail page renders the raw string via `innerHTML` (worst case: visible text "[broken json" — not a crash).
7. Deploy via `netlify deploy --prod --dir=.` and verify on `pmk-berlinpl.netlify.app`.

## Deployment

Per project convention (`feedback_no_netlify_auto_deploy.md`), `git push` does **not** trigger a deploy. After implementation passes manual testing locally, run:

```
netlify deploy --prod --dir=.
```

## File Inventory

**New files:**
- `assets/ogloszenia.js` — shared fetch + render module
- `ogloszenia.html` — detail page
- `docs/superpowers/specs/2026-05-30-ogloszenia-redesign-design.md` — this spec

**Modified files:**
- `index.html` — replace `#ogloszenia` section markup and inline CSS
- `main.js` — replace inline `loadOgloszenie` body with thin calls to the new module; remove dead block-renderer and hero-image code paths
- `i18n` source (TBD during planning — locate where existing `data-i18n` keys live)

**Untouched:**
- `admin/ogloszenia.js` (editor) — data shape unchanged
- `netlify/functions/ogloszenia-proxy` — endpoint unchanged
- Google Sheet schema — unchanged

## Open Questions

None at design time. Two items deferred to the planning phase:

- Whether the codebase already uses ES modules or only classic scripts → determines the export pattern in `assets/ogloszenia.js`.
- Where the `data-i18n` lookup table lives → determines where the five new keys get added.

Both are mechanical lookups during plan-writing, not design decisions.
