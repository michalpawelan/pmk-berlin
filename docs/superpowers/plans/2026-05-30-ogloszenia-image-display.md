# Ogłoszenia Image Display (Ambient Blur-Fill) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Display the Ogłoszenia detail-page bulletin image with an ambient blur-fill frame — full image shown uncropped via `object-fit: contain`, with a blurred copy of the same image filling the letterbox space — so portrait A4 flyers are never text-clipped and any aspect ratio looks intentional.

**Architecture:** One change in the shared `renderBlocks()` (in `js/ogloszenia.js`) that wraps every emitted image in an `.ogloszenia-img-frame` element carrying the URL twice (once as `<img src>`, once as a `--img` CSS custom property for the blurred backdrop), plus matching CSS in `ogloszenia.html` that replaces the current cover-crop rule. Pure vanilla JS + CSS, no build step.

**Tech Stack:** Vanilla JS IIFE module (`window.PMK_Ogloszenia`), plain CSS (`aspect-ratio`, `object-fit`, `filter: blur` — all Baseline), `node` for a standalone unit test (no test runner in repo), manual browser verification, manual `netlify deploy`.

**Spec:** `docs/superpowers/specs/2026-05-30-ogloszenia-image-display-design.md`

**Testing model:** The repo has no test runner. Task 1 (pure JS logic, security-relevant escaping) gets a standalone `node`-runnable unit test. Task 2 (CSS) gets manual browser verification. Task 3 is final verification + cleanup.

---

## File Inventory

**Modify:**
- `js/ogloszenia.js` — add `escapeCssUrl()` helper; change the `{t:'img'}` branch of `renderBlocks()` to emit the ambient frame wrapper.
- `ogloszenia.html` — replace the `.ogloszenia-article-body .ogloszenia-img-block` cover-crop CSS (lines 108-115) with `.ogloszenia-img-frame` ambient rules; update the print rule (line 154).

**Create:**
- `js/ogloszenia.renderBlocks.test.js` — standalone `node` unit test for the new markup + escaping (first test in the repo; the seed of a suite).

**Delete:**
- `_bildvergleich.html` — the throwaway local comparison demo (uncommitted; remove in Task 3).

**Untouched:** `index.html`, `main.js`, `translations/*`, `events.html`, `admin/*`, `netlify/functions/*`, all event/hero/photo CSS, Google Sheet.

---

## Task 1: Ambient-frame markup in `renderBlocks()` + unit test

**Files:**
- Modify: `js/ogloszenia.js` (add `escapeCssUrl` after `escapeHTML` ~line 28; change the img branch in `renderBlocks` ~lines 121-125)
- Create: `js/ogloszenia.renderBlocks.test.js`

- [ ] **Step 1: Write the failing test**

Create `js/ogloszenia.renderBlocks.test.js` with:

```js
// Standalone unit test for renderBlocks() — run with: node js/ogloszenia.renderBlocks.test.js
// The module is an IIFE that assigns window.PMK_Ogloszenia. We shim window, load it, then assert.
'use strict';
const assert = require('assert');

global.window = {};
require('./ogloszenia.js'); // IIFE runs on require, sets global.window.PMK_Ogloszenia

const { renderBlocks } = global.window.PMK_Ogloszenia;

// 1. A Drive image block is wrapped in the ambient frame, with the URL in BOTH src and --img.
const driveBody = JSON.stringify([
  { t: 'img', u: 'https://drive.google.com/file/d/ABC123_xyz-9/view' }
]);
const driveOut = renderBlocks(driveBody);
const resolved = 'https://lh3.googleusercontent.com/d/ABC123_xyz-9=w1200';
assert(driveOut.includes('class="ogloszenia-img-frame"'), 'frame wrapper present');
assert(driveOut.includes("--img:url('" + resolved + "')"), '--img custom property set to resolved url');
assert(driveOut.includes('src="' + resolved + '"'), 'img src set to resolved url');
assert(driveOut.includes('class="ogloszenia-img-block"'), 'inner img keeps its class');
assert(driveOut.includes('loading="lazy"') && driveOut.includes('decoding="async"'), 'perf attrs present');

// 2. A text block still renders as <p> (unchanged behavior).
const textOut = renderBlocks(JSON.stringify([{ t: 'txt', c: 'Hello\n\nWorld' }]));
assert(textOut.includes('<p>Hello</p>') && textOut.includes('<p>World</p>'), 'text blocks render as paragraphs');

// 3. Legacy non-JSON body is passed through untouched.
assert(renderBlocks('<p>legacy</p>') === '<p>legacy</p>', 'legacy html passthrough');

// 4. SECURITY: a hostile raw (non-Drive) url cannot break out of the CSS url('') or the style attribute.
const evilBody = JSON.stringify([
  { t: 'img', u: "http://x/a')}#bad{(\"q" }
]);
const evilOut = renderBlocks(evilBody);
// The raw single-quote / paren / double-quote must NOT appear literally inside the style attribute.
const styleMatch = evilOut.match(/style="([^"]*)"/);
assert(styleMatch, 'style attribute present and not broken by a double-quote');
const styleVal = styleMatch[1];
assert(!styleVal.includes("')"), "raw \"')\" sequence neutralized in CSS url");
assert(!styleVal.includes('("'), 'raw open-paren+quote neutralized in CSS url');

console.log('ok - renderBlocks ambient-frame + escaping: all assertions passed');
```

- [ ] **Step 2: Run the test to verify it FAILS**

Run: `node js/ogloszenia.renderBlocks.test.js`
Expected: an `AssertionError` on the first assertion (`frame wrapper present`) — because `renderBlocks` currently emits a bare `<img>`, not the frame. This confirms the test exercises the new behavior.

- [ ] **Step 3: Add the `escapeCssUrl` helper**

In `js/ogloszenia.js`, immediately after the `escapeHTML` function (which ends at line 28), add:

```js
  function escapeCssUrl(s) {
    // Escape a URL for use inside CSS url('...') within an HTML style="" attribute.
    // Hex-escape every char that could break out of the single-quoted CSS string,
    // the url() function, or the double-quoted HTML attribute. Safe chars
    // (alphanumerics, : / = . - _ ?) are left literal so the URL still works.
    return String(s).replace(/[\\'"()<>&\s]/g, function (c) {
      return '\\' + c.charCodeAt(0).toString(16) + ' ';
    });
  }
```

- [ ] **Step 4: Change the image branch of `renderBlocks`**

In `js/ogloszenia.js`, replace these lines (currently ~121-125):

```js
      if (b && b.t === 'img' && b.u) {
        const raw = String(b.u);
        const m = raw.match(/\/d\/([a-zA-Z0-9_-]+)/) || raw.match(/[?&]id=([a-zA-Z0-9_-]+)/);
        const url = m ? ('https://lh3.googleusercontent.com/d/' + m[1] + '=w1200') : raw;
        return '<img class="ogloszenia-img-block" src="' + escapeHTML(url) + '" alt="" loading="lazy">';
      }
```

with:

```js
      if (b && b.t === 'img' && b.u) {
        const raw = String(b.u);
        const m = raw.match(/\/d\/([a-zA-Z0-9_-]+)/) || raw.match(/[?&]id=([a-zA-Z0-9_-]+)/);
        const url = m ? ('https://lh3.googleusercontent.com/d/' + m[1] + '=w1200') : raw;
        // Ambient blur-fill frame: the URL is referenced twice — as the sharp foreground
        // <img> (object-fit:contain, never cropped) and as the --img custom property the
        // CSS ::before uses for the blurred backdrop. See ogloszenia.html .ogloszenia-img-frame.
        return '<div class="ogloszenia-img-frame" style="--img:url(\'' + escapeCssUrl(url) + '\')">' +
               '<img class="ogloszenia-img-block" src="' + escapeHTML(url) + '" alt="" loading="lazy" decoding="async">' +
               '</div>';
      }
```

- [ ] **Step 5: Run the test to verify it PASSES**

Run: `node js/ogloszenia.renderBlocks.test.js`
Expected: `ok - renderBlocks ambient-frame + escaping: all assertions passed`

- [ ] **Step 6: Syntax check the module**

Run: `node --check js/ogloszenia.js`
Expected: no output (success).

- [ ] **Step 7: Commit**

```bash
git add js/ogloszenia.js js/ogloszenia.renderBlocks.test.js
git commit -m "feat(ogloszenia): renderBlocks emits ambient blur-fill frame for bulletin images"
```

---

## Task 2: Ambient blur-fill CSS on the detail page

**Files:**
- Modify: `ogloszenia.html` (replace `.ogloszenia-article-body .ogloszenia-img-block` rule at lines 108-115; update print rule at line 154)

- [ ] **Step 1: Replace the cover-crop rule with the ambient frame rules**

In `ogloszenia.html`, replace this block (lines 108-115):

```css
    .ogloszenia-article-body .ogloszenia-img-block {
      display: block;
      width: 100%;
      max-height: 460px;
      object-fit: cover;
      border-radius: 6px;
      margin: 1.25rem 0;
    }
```

with:

```css
    /* Ambient blur-fill frame: full image always visible (contain, never cropped),
       letterbox space filled by a blurred copy of the same image so any aspect ratio
       looks intentional. Markup emitted by js/ogloszenia.js renderBlocks(). */
    .ogloszenia-article-body .ogloszenia-img-frame {
      position: relative;
      width: 100%;
      max-width: 640px;
      margin: 1.25rem auto;
      aspect-ratio: 3 / 4;          /* portrait-leaning: A4 flyers nearly fill it */
      max-height: 80vh;
      border-radius: 8px;
      overflow: hidden;
      isolation: isolate;
      background: var(--color-warm-50, #faf6f0);   /* fallback if blur is unsupported */
    }
    .ogloszenia-article-body .ogloszenia-img-frame::before {
      content: "";
      position: absolute;
      inset: -8%;                   /* overscan so blurred edges never fade to transparent */
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
      object-fit: contain;          /* never crops — A4 flyer text stays readable */
      object-position: center;
      display: block;
    }
    .ogloszenia-article-body .ogloszenia-img-frame:first-child { margin-top: 0; }
    .ogloszenia-article-body .ogloszenia-img-frame:last-child  { margin-bottom: 0; }
```

- [ ] **Step 2: Update the print rule for the new frame**

In `ogloszenia.html`, the print block currently has (line 154):

```css
      .ogloszenia-article-body .ogloszenia-img-block { page-break-inside: avoid; max-height: none; }
```

Replace that single line with:

```css
      /* Print: drop the ambient frame + blur, show the whole image at natural aspect. */
      .ogloszenia-article-body .ogloszenia-img-frame {
        aspect-ratio: auto;
        max-height: none;
        overflow: visible;
        background: none;
        border-radius: 0;
        page-break-inside: avoid;
      }
      .ogloszenia-article-body .ogloszenia-img-frame::before { display: none; }
      .ogloszenia-article-body .ogloszenia-img-block {
        height: auto;
        object-fit: contain;
        page-break-inside: avoid;
      }
```

- [ ] **Step 3: Verify the HTML is still well-formed**

Run:
```bash
node -e "const s=require('fs').readFileSync('ogloszenia.html','utf8'); const o=(s.match(/</g)||[]).length, c=(s.match(/>/g)||[]).length; console.log('open',o,'close',c, o===c?'OK':'MISMATCH');"
```
Expected: `open N close N OK` (counts equal).

Also confirm the old cropping rule is gone and the new frame rules are present:
```bash
grep -c "object-fit: cover" ogloszenia.html   # expect 0
grep -c "ogloszenia-img-frame" ogloszenia.html # expect >= 6
```

- [ ] **Step 4: Manual browser verification**

Start a server from the repo root:
```bash
python3 -m http.server 8000
```

Open http://localhost:8000/ogloszenia.html and hard-refresh (Cmd+Shift+R). Verify against the live Sheet's current bulletin image (the portrait Sacred Heart):
- The image is shown **complete** — no sliced top/bottom; the header text (e.g. "…14:00") is fully visible.
- The letterbox space around the image glows with a soft, blurred version of the same image (not flat bars, not black).
- The image is centered, rounded corners on the frame.
- Resize to a narrow (mobile) viewport: frame goes full-width, image still uncropped, blur still present.
- Open DevTools → Network, reload: the lh3 image URL is requested **once** (the backdrop reuses the cached bitmap, no second download).
- Open DevTools → Elements: the `<div class="ogloszenia-img-frame" style="--img:url('…')">` wraps the `<img class="ogloszenia-img-block">`.

Then test **print**: browser menu → Print (Cmd+P). In the preview:
- The image appears whole at its natural aspect ratio (portrait flyer full).
- No blurred backdrop, no frame tint, no rounded frame.
- Navbar, footer, chatbot launcher, back link, print button all hidden (unchanged from prior work).

Stop the server: Ctrl+C.

- [ ] **Step 5: Commit**

```bash
git add ogloszenia.html
git commit -m "style(ogloszenia): ambient blur-fill frame CSS for detail-page image + print handling"
```

---

## Task 3: Final verification + remove throwaway demo

**Files:**
- Delete: `_bildvergleich.html`
- No source changes.

- [ ] **Step 1: Stop the comparison demo server and delete the throwaway file**

The comparison demo from brainstorming runs on port 8777 and the file sits in the repo root (uncommitted). Remove both:

```bash
# stop the demo server if still running
lsof -ti:8777 | xargs kill -9 2>/dev/null || true
# delete the throwaway comparison file
rm -f _bildvergleich.html
```

Confirm it's gone and was never committed:
```bash
test ! -f _bildvergleich.html && echo "demo file removed"
git status --porcelain _bildvergleich.html   # expect: no output (untracked file now gone)
```

- [ ] **Step 2: Re-run the unit test (regression guard)**

Run: `node js/ogloszenia.renderBlocks.test.js`
Expected: `ok - renderBlocks ambient-frame + escaping: all assertions passed`

- [ ] **Step 3: Full local walkthrough via HTTP server**

```bash
python3 -m http.server 8000
```

1. http://localhost:8000/ogloszenia.html → image full, ambient glow, uncropped (desktop + mobile viewport).
2. Print preview → whole image, no blur/frame, clean A4.
3. http://localhost:8000/ → homepage still loads; the teaser strip (already built) is unaffected; no console errors.
4. DevTools console on the detail page: clean (no errors, no missing-translation warnings).

Stop the server: Ctrl+C.

- [ ] **Step 4: Confirm git state is clean and scoped**

```bash
git status
git log --oneline -3
```
Expected: working tree clean; the last two commits are the renderBlocks frame (Task 1) and the CSS (Task 2). No stray files (`_bildvergleich.html` absent).

- [ ] **Step 5: Hand off the deploy to the user (manual — per project convention)**

Do NOT deploy automatically. Report to the user that the work is committed locally and ready, and that deploying with:

```bash
netlify deploy --prod --dir=.
```

will ship the ambient blur-fill image **together with** the previously-built-but-undeployed teaser strip + `/ogloszenia.html` detail page (those are currently stale on live). After deploy, verify the bulletin image on https://pmk-berlinpl.netlify.app/ogloszenia.html, then `git push`.

---

## Self-Review

**1. Spec coverage:**
- Ambient blur-fill via contain + blurred same-image backdrop → Task 1 (markup) + Task 2 (CSS). ✅
- URL referenced twice, safely escaped for src AND CSS var → Task 1 (`escapeHTML` for src, `escapeCssUrl` for `--img`), guarded by the security assertion in the test. ✅
- Frame `aspect-ratio: 3/4`, `max-height: 80vh`, cream fallback, blur 26px → Task 2 Step 1. ✅
- Print: frame/blur off, whole image natural → Task 2 Step 2. ✅
- Event cards / hero / photos untouched → not in any task's file list (only `js/ogloszenia.js` + `ogloszenia.html`). ✅
- Dead `events.html` card flagged not fixed → not touched; noted in spec. ✅
- Throwaway demo removed → Task 3 Step 1. ✅
- Manual deploy convention → Task 3 Step 5. ✅

**2. Placeholder scan:** No TBD/TODO/"handle edge cases". Every code step shows complete code. ✅

**3. Type/name consistency:** `escapeCssUrl` (defined Task 1 Step 3, used Task 1 Step 4). `.ogloszenia-img-frame` and `--img` consistent between the emitted markup (Task 1) and the CSS (Task 2). Inner image keeps `class="ogloszenia-img-block"` in both the markup and the foreground CSS rule. Print rules reference the same two selectors. ✅
