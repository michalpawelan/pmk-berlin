# Ogłoszenia Image Display — Ambient Blur-Fill Design Spec

**Date:** 2026-05-30
**Status:** Draft, awaiting user review
**Context:** Pre-launch (08.06.2026 DNS cutover). Follows the Ogłoszenia redesign (teaser strip + `/ogloszenia.html` detail page).

## Problem

The Ogłoszenia detail-page image is displayed with `object-fit: cover` inside a fixed `max-height: 460px` box. This **crops** the image. Real parish announcement images are overwhelmingly **portrait A4/A5 flyers with text** (research confirmed both seed posters are ISO A-paper ratio ≈0.707 — exactly what a Canva/Word/PDF flyer export produces). Cropping such a flyer slices off the header (title) and footer (date, time, venue) — the most important content. This is the visible bug where the top of the Sacred Heart bulletin image ("…14:00") was sliced off.

The deeper requirement from the user: **any image the proboszcz uploads — poster, photo, square, any aspect ratio — must always look good, and text must never be cropped.**

## Goal

Replace the cropping image display on the Ogłoszenia detail page with an **ambient blur-fill frame** (the Apple TV / Spotify pillarbox look): the full image shown sharp and uncropped via `object-fit: contain`, with a scaled-up, blurred copy of the same image filling the letterbox space so any aspect ratio looks intentional and premium instead of stranded between flat bars.

The user reviewed a live 4-way comparison (`object-fit: cover` / contain-on-cream / ambient blur-fill / natural height) on the real Triduum and Adoracja posters and chose **ambient blur-fill** for the bulletin image.

## Non-Goals

- **No event-list card changes.** The Luma-style event cards (`.event-card-image`, 140px left-rail thumbnails) are an intentional compact design the user likes and explicitly wants kept. Out of scope.
- **No changes to decorative/photo surfaces.** Hero (`.hero-image-container`), churches gallery (`.church-image`), about/pastor photos — these are art-directed crops of croppable photos. Leave alone.
- **No Google Drive URL crop flags.** The `=w1200` param only scales (aspect-preserving); we will NOT use undocumented `-c` crop flags. Cropping control stays in CSS, and the answer is "don't crop."
- **No JS framework, no build step.** Pure CSS + the existing vanilla `renderBlocks()` function.
- **No fix to the dead `events.html` ogłoszenia card** (see Known Issues). Flagged, not fixed, to keep scope tight.
- **No per-image aspect detection / smart focal-point cropping.** One fixed frame handles all shapes via the ambient fill.

## Scope

A single conceptual change implemented in two places that move together:

1. **`js/ogloszenia.js` — `renderBlocks()`**: wrap each rendered image in an ambient-frame element that carries the image URL twice (once as the `<img src>`, once as a `--img` CSS custom property for the blurred backdrop).
2. **`ogloszenia.html` — inline `<style>`**: replace the current `.ogloszenia-article-body .ogloszenia-img-block` cover-crop rule with the `.ogloszenia-img-frame` ambient blur-fill rules, including print-mode handling.

Because `renderBlocks()` is the single source of bulletin-image markup, the new look applies consistently anywhere that function's output is shown with the frame CSS present (today: the detail page).

## How It Works

The ambient blur-fill is a two-layer technique on the SAME image:

- **Wrapper** (`.ogloszenia-img-frame`): a fixed-shape frame (`aspect-ratio`), `position: relative`, `overflow: hidden`, `isolation: isolate`, cream background as a fallback.
- **Backdrop** (`::before` pseudo-element): the same image as a `background-image` (from the `--img` custom property), `background-size: cover`, scaled up (`transform: scale(1.15)`) and blurred (`filter: blur(~26px)`) + slightly dimmed/saturated. Fills the whole frame edge-to-edge so the letterbox space glows in the image's own colors. **Critical:** the blur lives on the `::before`, NOT on the wrapper — `filter` on the wrapper would blur the sharp foreground image too. `backdrop-filter` is the wrong tool (it blurs what's behind a translucent surface); we blur a background-image we control with the normal `filter` property.
- **Foreground** (`> img.ogloszenia-img-block`): the real image, `object-fit: contain`, `z-index: 1`, sitting sharp and complete in the center. Never cropped.

### Markup emitted by `renderBlocks()`

For each `{t:'img', u:'…'}` block, instead of:

```html
<img class="ogloszenia-img-block" src="URL" alt="" loading="lazy">
```

emit:

```html
<div class="ogloszenia-img-frame" style="--img:url('URL_CSS')">
  <img class="ogloszenia-img-block" src="URL_HTML" alt="" loading="lazy" decoding="async">
</div>
```

Where:
- `URL` is the already-resolved image URL (Drive id → `https://lh3.googleusercontent.com/d/{id}=w1200`, or the legacy/raw URL fallback) — same resolution logic as today.
- `URL_HTML` = the URL escaped via the existing `escapeHTML()` for the `src` attribute.
- `URL_CSS` = the URL escaped for a CSS `url('…')` context inside an HTML `style` attribute: backslash-escape `\` and `'`, strip/encode newlines, and ensure no `"`/`<`/`>`/`&` break the attribute. A small dedicated helper (e.g. `escapeCssUrl()`) added to the module. The resolved lh3 URLs are `[A-Za-z0-9_\-/=.:]` only (safe), but the legacy raw-URL branch must be escaped defensively.

### CSS in `ogloszenia.html`

Replace the existing rule:

```css
.ogloszenia-article-body .ogloszenia-img-block {
  display: block; width: 100%; max-height: 460px;
  object-fit: cover; border-radius: 6px; margin: 1.25rem 0;
}
```

with:

```css
/* Ambient blur-fill frame — full image always visible, letterbox glows in the image's colors */
.ogloszenia-article-body .ogloszenia-img-frame {
  position: relative;
  width: 100%;
  max-width: 640px;
  margin: 1.25rem auto;
  aspect-ratio: 3 / 4;            /* portrait-leaning: A4 flyers nearly fill it */
  max-height: 80vh;
  border-radius: 8px;
  overflow: hidden;
  isolation: isolate;
  background: var(--color-warm-50, #faf6f0);  /* fallback if blur fails */
}
.ogloszenia-article-body .ogloszenia-img-frame::before {
  content: "";
  position: absolute;
  inset: -8%;                    /* overscan so blurred edges never fade to transparent */
  background-image: var(--img);
  background-size: cover;
  background-position: center;
  filter: blur(26px) saturate(1.3) brightness(0.85);
  transform: scale(1.15);
  z-index: 0;
}
.ogloszenia-article-body .ogloszenia-img-block {
  position: relative;
  z-index: 1;
  width: 100%;
  height: 100%;
  object-fit: contain;           /* never crops */
  object-position: center;
  display: block;
  border-radius: 0;
}
.ogloszenia-article-body .ogloszenia-img-frame:first-child { margin-top: 0; }
.ogloszenia-article-body .ogloszenia-img-frame:last-child  { margin-bottom: 0; }
```

### Print handling (`@media print` in `ogloszenia.html`)

In print, the ambient backdrop and frame chrome are unnecessary (and waste ink) — print should show the whole image natural and clean:

```css
@media print {
  .ogloszenia-article-body .ogloszenia-img-frame {
    aspect-ratio: auto;
    max-height: none;
    overflow: visible;
    background: none;
    border-radius: 0;
  }
  .ogloszenia-article-body .ogloszenia-img-frame::before { display: none; }  /* no blur in print */
  .ogloszenia-article-body .ogloszenia-img-block {
    height: auto;                /* natural aspect, full flyer */
    object-fit: contain;
    page-break-inside: avoid;
  }
}
```

This supersedes the current print rule that resets `max-height: none` on `.ogloszenia-img-block`.

## Data Flow

```
Google Sheet (bulletin body JSON blocks)
        │
        ▼
js/ogloszenia.js  renderBlocks(body)
        │  for each {t:'img'}: resolve Drive URL → wrap in .ogloszenia-img-frame
        ▼
ogloszenia.html  #ogloszenia-article-body  ← frame CSS applies the ambient look
```

No backend, no sheet, no endpoint changes. Image resolution (Drive id → lh3 URL) is unchanged.

## Edge Cases

- **Portrait A4 flyer (the common case, ≈0.707):** nearly fills the 3/4 frame; thin ambient bands top/bottom. Looks full and premium. Text fully readable.
- **Landscape photo (e.g. 4:3):** fits by width in the portrait frame; ambient glow fills top/bottom. Looks intentional.
- **Square / wide banner / very tall banner:** all handled by contain + ambient fill. A very tall banner (e.g. 1:3) shrinks with wide ambient side-bands — acceptable trade-off of a fixed frame; the user chose this look knowing it. Most uploads are A4.
- **Multiple images in one bulletin:** each image gets its own frame, stacked with `1.25rem` vertical rhythm.
- **Legacy HTML body (non-block):** `renderBlocks` returns the raw HTML untouched (today's behavior). No frame applied — acceptable; legacy rows predate the block editor and are rare.
- **Malformed `--img` URL:** the CSS-escape helper neutralizes quote/paren injection; worst case the backdrop fails to paint and the cream fallback shows behind a correctly-contained sharp image. No layout break, no XSS (the value lives in a `style` attribute, escaped).
- **`filter: blur` unsupported (ancient browser):** backdrop simply doesn't blur or doesn't paint; the contained image on cream still looks fine.
- **No image in bulletin:** no frames emitted; nothing changes.

## Testing Plan

Manual (no test runner in repo), against `python3 -m http.server` then live:

1. With the current Sheet row (Sacred Heart portrait image), open `/ogloszenia.html`: the image shows **complete** (no sliced top/bottom), centered, with a soft blurred glow of its own colors filling the frame. The "…14:00" header is fully visible.
2. Temporarily point the bulletin image block at a **landscape** image (or test locally with `images/basilika-fassade.webp`): it sits centered with ambient top/bottom glow, uncropped.
3. **Print preview** (`Drukuj`): image shown whole at natural aspect, no blur, no frame tint, clean A4. Navbar/footer/chatbot still hidden (from the prior redesign).
4. **DE toggle:** image behavior unchanged (image is language-agnostic).
5. **Mobile viewport (<640px):** frame scales to full width, blur still works, image uncropped.
6. **Console:** no errors; the `--img` custom property is present and correctly escaped in the emitted markup (inspect element).
7. **Performance sanity:** the image URL is fetched once (Network tab shows a single request for the lh3 URL, reused by the backdrop). No second download.
8. Deploy via `netlify deploy --prod --dir=.` and repeat 1–5 on `pmk-berlinpl.netlify.app`.

## Deployment

Per project convention (`feedback_no_netlify_auto_deploy`), `git push` does not deploy. After local verification: `netlify deploy --prod --dir=.`. Note: this deploy also ships the previously-built-but-undeployed teaser strip + detail page (currently stale on live) — they go live together.

## File Inventory

**Modified:**
- `js/ogloszenia.js` — `renderBlocks()` wraps images in the ambient frame; add `escapeCssUrl()` helper.
- `ogloszenia.html` — replace `.ogloszenia-img-block` cover-crop CSS with `.ogloszenia-img-frame` ambient rules; update `@media print` block.

**Created:**
- `docs/superpowers/specs/2026-05-30-ogloszenia-image-display-design.md` — this spec.

**Untouched:**
- `index.html` (homepage strip has no image), `main.js`, `translations/*`, `admin/*`, `netlify/functions/*`, all event/hero/photo CSS, Google Sheet.

**Throwaway (delete before finishing):**
- `_bildvergleich.html` — the local comparison demo. Not committed, removed once the design is locked.

## Known Issues (flagged, out of scope)

- **`events.html` carries a dead old `.ogloszenia-card`** (with `#ogloszenia-body`, `.ogloszenia-image`, `.ogloszenia-img-block` markup and CSS) but does not load `js/ogloszenia.js`, so `main.js`'s `loadOgloszenie()` bails and the card never populates. This is leftover from the strip redesign. Recommendation: in a separate cleanup, remove the dead card markup + CSS from `events.html` (it duplicates the homepage strip / detail page). Not addressed here.

## Open Questions

None. The frame aspect ratio (3/4), blur radius (26px), and max-width (640px) are sensible defaults derived from the research; they can be tuned during implementation review if the live result wants adjustment, but none block the plan.
