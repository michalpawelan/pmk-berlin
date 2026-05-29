# Pre-Launch Corrections — PMK Redesign

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply all corrections agreed in the 2026-05-29 stakeholder review so the redesign can replace the WIX site on 2026-06-08 (Sunday launch).

**Architecture:** Static HTML site (Netlify, no CI auto-deploy). Most fixes are HTML/CSS text edits in existing pages. Two structural additions: a new "Ogłoszenia duszpasterskie" admin tab + frontend widget, and per-group contact email routing. AI/voice work tracked separately (see memory `project_voice_agent_migration`).

**Tech Stack:** Static HTML + vanilla JS + Tailwind utility classes, Netlify Forms, Google Sheets / Apps Script for admin events, ElevenLabs for voice.

**Source of truth:** `.planning/transcripts/2026-05-29-website-review/SUMMARY.md`. Each task below cross-references the action item ID (A1, B1, etc.) and a transcript timestamp.

**Out of scope for this plan:**
- ElevenLabs / Marta agent activation (separate work, blocked on Bistum billing — see L1–L7 in SUMMARY)
- Admin password rotation (M5 — has to be done by Michał/Kinga directly, not via code edit)
- Faktura logistics (Q3 — out-of-code)
- WhatsApp group setup (O1 — manual)

---

## File Structure

| File | Responsibility | Action items touched |
|------|----------------|----------------------|
| `index.html` | Homepage, masses card, confession card | A1, A2 |
| `sakrament-spowiedz.html` | Confession page | B1, B2 |
| `sakrament-chrzest.html` | Baptism page | D1, D2 |
| `sakrament-bierzmowanie.html` | Confirmation page | F1 |
| `sakrament-malzenstwo.html` | Marriage page | G1, G2, G3 |
| `wesprzyj.html` | Donations page | I1 |
| `kontakt.html`, `grupy.html`, `wspolnota-*.html` | Group contacts + leaders | C1 (Spandau address), J1–J4 |
| `de/*.html` | German version | P1, P2 |
| `admin/events.js`, `admin/google-apps-script.js` | Admin events tab | M1 (upload bug) |
| **NEW** `admin/ogloszenia.js` + admin/index.html tab | New admin section for weekly ogłoszenia | M2 |
| **NEW** `index.html` ogłoszenia widget | Frontend ogłoszenia card (always first) | M2 |
| `downloads/*.pdf` (or wherever) | Baptism form PDF | D3, D4 |

---

## Execution Waves

- **Wave 1** (~30 min): Pure text/HTML edits. Low risk, no decisions. Tasks 1–7.
- **Wave 2** (~30 min): Address audit + Spandau location. Tasks 8–10.
- **Wave 3** (~45 min): Contact form routing per group + missing leaders. Tasks 11–13.
- **Wave 4** (~60 min): Admin upload bug debug. Task 14.
- **Wave 5** (~3-4 h): New "Ogłoszenia" admin section + frontend widget. Tasks 15–18.
- **Wave 6** (~30 min): DE audit + PL-only notice. Tasks 19–20.
- **Wave 7**: Deploy + verify on prod. Task 21.

Each task is one commit. Run `netlify deploy --prod --dir=.` only at end of each wave (or before a user-verify checkpoint).

---

## Wave 1 — Text/HTML edits

### Task 1: Confession hours and tagline (B1, B2)

**Files:**
- Modify: `sakrament-spowiedz.html`
- Modify: `index.html` (confession card on landing)

- [ ] **Step 1: Locate current confession text**

```bash
grep -n -i "spowied\|17:00\|17:30\|miłosiernym" sakrament-spowiedz.html | head -30
grep -n -i "spowied" index.html | head -10
```

- [ ] **Step 2: Edit `sakrament-spowiedz.html` — hours + tagline layout**

Replace any `17:00` time references for confession with `17:30`. Update hero/intro to render:

```html
<p class="lead">Spotkanie z Miłosiernym Bogiem.</p>
<p class="hours">Poniedziałek–sobota od 17:30</p>
```

Two separate `<p>` elements so the tagline stands alone visually (per S0 at 00:20:34).

- [ ] **Step 3: Edit `index.html` confession card to surface hours**

Find the confession card on homepage. Add the hours line directly visible (don't require click-through):

```html
<!-- inside confession card -->
<p class="card-subline">Pn–So od 17:30</p>
```

- [ ] **Step 4: Visual verify**

```bash
# start local dev
python3 -m http.server 8080
# open http://localhost:8080/ and http://localhost:8080/sakrament-spowiedz.html
# confirm: confession card shows hours; spowiedz page shows tagline+hours on two lines
```

- [ ] **Step 5: Commit**

```bash
git add sakrament-spowiedz.html index.html
git commit -m "fix(spowiedz): correct hours to 17:30 and surface on homepage card"
```

---

### Task 2: Homepage masses card — surface summer schedule (A1)

**Files:**
- Modify: `index.html`

- [ ] **Step 1: Locate masses card**

```bash
grep -n -B2 -A20 "Msze\|Pn–So 7\|pełny rozkład" index.html | head -60
```

- [ ] **Step 2: Add summer indication directly on card**

Below the existing weekday hours, add:

```html
<p class="card-summer-note">Lipiec–sierpień: rozkład wakacyjny — kliknij "Pełny rozkład"</p>
```

(Final wording can be tightened — confirm with Kinga, who runs the actual seasonal schedule.)

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "ux(index): show summer schedule hint on masses card without click-through"
```

---

### Task 3: Baptism — preserve tutoring info + chrzestny requirement (D1, D2)

**Files:**
- Modify: `sakrament-chrzest.html`

- [ ] **Step 1: Locate the chrzestny criteria + nauki przedchrzcielne paragraphs**

```bash
grep -n -i "chrzestn\|nauki\|piątek przed\|prawnych opiekunów" sakrament-chrzest.html
```

- [ ] **Step 2: Verify the nauki paragraph is rendered in small body text (not heading)**

The line should read:
> W piątek przed chrztem świętym o 18:00 będzie Msza święta, a bezpośrednio po niej odbędą się nauki dla rodziców i chrzestnych.

If it's currently in a heading-sized class (e.g. `text-2xl`, `font-bold`), demote to body class.

- [ ] **Step 3: Verify last chrzestny bullet present**

The bullet "zostać wyznaczonym przez prawnych opiekunów" must be in the chrzestny criteria list. If missing, add it as the final `<li>`.

- [ ] **Step 4: Commit**

```bash
git add sakrament-chrzest.html
git commit -m "fix(chrzest): keep tutoring info as body text, retain final chrzestny criterion"
```

---

### Task 4: Marriage — kurs przedmałżeński paragraph + link relocation (G1, G2)

**Files:**
- Modify: `sakrament-malzenstwo.html`

- [ ] **Step 1: Locate "kurs przedmałżeński" section + bottom links**

```bash
grep -n -i "kurs przedmałż\|jesieni\|kurs online" sakrament-malzenstwo.html
```

- [ ] **Step 2: Add the new paragraph to the kurs section**

```html
<p>
  Kurs naszej Misji organizowany jest raz w roku, jesienią.
  O terminie informujemy w ogłoszeniach parafialnych.
  Prosimy uwzględnić to przy planowaniu ślubu.
</p>
```

- [ ] **Step 3: Duplicate the two online-kurs links into this section**

Identify the two `<a href="...">` links currently at the bottom of the page (links to online kurs providers). Insert copies of those anchors inside the kurs paragraph so users see them without scrolling. **Do not remove the originals at the bottom** — keep both.

- [ ] **Step 4: Commit**

```bash
git add sakrament-malzenstwo.html
git commit -m "fix(malzenstwo): add seasonal kurs paragraph + surface online-kurs links inline"
```

---

### Task 5: Confirmation — form moves to top of "Zapisy" (F1)

**Files:**
- Modify: `sakrament-bierzmowanie.html`

- [ ] **Step 1: Locate the "Zapisy" section and the signup form**

```bash
grep -n -i "zapisy\|<form\|formularz" sakrament-bierzmowanie.html | head
```

- [ ] **Step 2: Move the `<form>` (or its container) so it is the first child of the "Zapisy" section**

The current layout buries it. Cut the form block; paste immediately after the section heading.

- [ ] **Step 3: Commit**

```bash
git add sakrament-bierzmowanie.html
git commit -m "ux(bierzmowanie): move signup form to top of Zapisy section"
```

---

### Task 6: Donations page — strip excess copy (I1)

**Files:**
- Modify: `wesprzyj.html`

- [ ] **Step 1: Read current page**

```bash
wc -l wesprzyj.html
```

- [ ] **Step 2: Reduce to heading + bank details only**

Keep:
- Heading "Wesprzyj naszą misję"
- IBAN / Sparkasse / Bistum bank block
- Footer / nav (default)

Remove:
- Long "Dziękujemy za każde wsparcie…" intro
- CTA buttons or marketing copy
- Any donation-pushing visuals

Reason: "konto jest nam tylko po to potrzebne, że jeśli ktoś chce przelać na mszę czy za coś, to wtedy może przelać" (Proboszcz, ts 00:23:40).

- [ ] **Step 3: Commit**

```bash
git add wesprzyj.html
git commit -m "ux(wesprzyj): strip marketing copy, keep heading + bank details only"
```

---

### Task 7: Homepage confession card on grid (A2)

Already merged into Task 1. Skip if Step 3 of Task 1 completed.

---

## Wave 2 — Addresses + photos

### Task 8: Verify all Berlin address spellings (C2)

**Files:**
- Audit: all `*.html`, `de/*.html`

- [ ] **Step 1: Grep all instances**

```bash
grep -rn -i "müller\|muller\|gundelfing\|wildenower\|wildno" --include="*.html" .
```

- [ ] **Step 2: Cross-check each with Google Maps / Bistum source**

Standard forms (verify, do not assume):
- `Müllerstraße` (umlaut + ß)
- `Gundelfingenstraße` — needs confirmation (Proboszcz unsure if umlaut exists). Default to no umlaut unless Maps proves otherwise.
- `Wildenower Straße` (with space)

- [ ] **Step 3: Normalize all instances**

Use `sed` per file only after the canonical spelling is verified. Otherwise apply `Edit` per occurrence with exact context.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "fix(addresses): normalize Müllerstraße/Gundelfingen/Wildenower Straße spellings"
```

---

### Task 9: Spandau / Sant Joseph entry address note (C1, G3)

**Files:**
- Modify: `sakrament-malzenstwo.html` (wedding location section)
- Modify: any other page that lists the salka katechetyczna address (likely `kontakt.html` or `grupy.html`)

- [ ] **Step 1: Find salka references**

```bash
grep -rn -i "salka\|sant joseph\|katecheza" --include="*.html" .
```

- [ ] **Step 2: Add entry-clarification note**

Insert near each address block:

```html
<p class="entry-note">
  <strong>Uwaga:</strong> wejście jest <em>nie</em> od strony Müllerstraße,
  tylko od Wildenower Straße 8 — przez bramę nr 8 na podwórze.
</p>
```

(Same wording in DE on `de/*` if applicable.)

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "fix(spandau): add entry-from-Wildenower-Strasse-8 clarification on salka address"
```

---

### Task 10: Replace placeholder photos for communities (K1) + churches (K2, K3)

**Files:**
- Modify: `grupy.html`, `index.html`, `wspolnota-*.html` (per group)
- Add: `images/wspolnoty/*.jpg`, `images/koscioly/sant-joseph-wedding.jpg`, `images/koscioly/spandau-zitadelle.jpg`

**Prereq:** USB stick from Proboszcz (already in Michał's possession per transcript ts 01:34:00).

- [ ] **Step 1: Ingest images from USB stick**

```bash
ls /Volumes/*/ 2>/dev/null  # find the stick
# copy church + group photos into images/koscioly/ and images/wspolnoty/
```

- [ ] **Step 2: Optimize for web**

```bash
# example for each
sips -Z 1600 -s format jpeg -s formatOptions 80 \
  images/koscioly/sant-joseph-wedding-raw.jpg --out images/koscioly/sant-joseph-wedding.jpg
```

- [ ] **Step 3: Replace `<img src=…>` per page**

For each `wspolnota-*.html` and matching grid card on `grupy.html` + `index.html`, replace placeholder `src=` with the real photo. Update `alt=` to a meaningful description in PL.

- [ ] **Step 4: Commit (one per group, or one batch if scope demands)**

```bash
git add images/wspolnoty/ images/koscioly/ wspolnota-*.html grupy.html index.html
git commit -m "feat(images): replace placeholder community + church photos with real assets"
```

---

## Wave 3 — Contact routing + group leaders

### Task 11: Add ks. Grzegorz Jeżewski to Domowy Kościół (J4)

**Files:**
- Modify: `wspolnota-domowy-kosciol.html`
- Modify: `grupy.html` (if it lists leaders per group)

- [ ] **Step 1: Locate current leadership block**

```bash
grep -n -i "domowy\|grzegorz" wspolnota-domowy-kosciol.html grupy.html
```

- [ ] **Step 2: Add ks. Grzegorz Jeżewski as second priest**

```html
<li>Ks. Grzegorz Jeżewski</li>
```

(or whatever structure the page already uses for clergy).

- [ ] **Step 3: Commit**

```bash
git add wspolnota-domowy-kosciol.html grupy.html
git commit -m "fix(domowy-koscol): add ks. Grzegorz Jeżewski as second priest"
```

---

### Task 12: Per-group contact form email routing (J1, J2)

**Files:**
- Modify: `kontakt.html` (if contact form is centralized)
- Modify: each `wspolnota-*.html` that has a "napisz do nas" form
- Modify: `netlify.toml` (if forms are routed via Netlify Forms)

- [ ] **Step 1: Identify current routing**

```bash
grep -rn "netlify\|data-netlify\|form action\|mailto" --include="*.html" .
grep -n "form" netlify.toml
```

The kontakt form is per memory `project_kontakt_form` Netlify Forms → pmk@pmk-berlin.de. Per-group forms likely don't exist yet.

- [ ] **Step 2: For each wspolnota page with a leader email, add a per-group contact form**

```html
<form name="kontakt-{group-slug}" data-netlify="true" method="POST">
  <input type="hidden" name="form-name" value="kontakt-{group-slug}">
  <input type="hidden" name="_to" value="{leader-email}">
  <!-- standard fields: name, email, message -->
</form>
```

Confirm Netlify Forms `_to` override is allowed for the plan tier; if not, route everything to `pmk@pmk-berlin.de` and use the `form-name` as a label so Kinga can forward.

- [ ] **Step 3: Where there is no leader email yet (J3), fall back to default kontakt route + add TODO note**

```html
<!-- TODO J3: leader email pending (Apostolstwo / Grupa Męska / Oaza 21+) -->
```

- [ ] **Step 4: Commit (per group page)**

```bash
git add wspolnota-*.html kontakt.html netlify.toml
git commit -m "feat(groups): per-group Netlify contact forms with leader email routing"
```

---

### Task 13: Baptism PDF form — replace stale logo + remove "numer raptularza" (D3, D4)

**Files:**
- Locate: `downloads/*chrzest*.pdf` (or wherever the baptism form lives)

- [ ] **Step 1: Find the PDF**

```bash
find . -name "*.pdf" | xargs -I{} echo {} | grep -i "chrzest\|baptism\|formularz"
ls downloads/ 2>/dev/null
```

- [ ] **Step 2: If a source (`.docx` / Pages / InDesign) exists, edit there; otherwise:**

This is **out of scope for code** — the PDF needs to be regenerated from its source by Kinga/Proboszcz. Mark D3, D4 in SUMMARY.md as "needs source file" and notify user.

- [ ] **Step 3: No commit unless a binary swap is performed**

---

## Wave 4 — Admin upload bug

### Task 14: Debug failing image upload in admin/events (M1)

**Files:**
- Investigate: `admin/events.js`, `admin/google-apps-script.js`, `admin/auth.js`

**Repro from transcript (ts 00:57:00):**
> JPG screenshot of "Wieczór Chwały 13.06 18:00" poster. Upload fails with: "Błąd przesyłania. Nie udało się załadować obrazu. JPG, PNG, WEBP".

- [ ] **Step 1: Reproduce locally**

```bash
# serve admin
python3 -m http.server 8080
# open http://localhost:8080/admin/
# log in with current admin password
# add new event "Wieczór Chwały" + upload a JPG → observe network tab
```

- [ ] **Step 2: Check Apps Script endpoint**

```bash
grep -n "doPost\|uploadFile\|MimeType\|BLOB" admin/google-apps-script.js
```

Look for:
- File size limits (Apps Script max 50MB per blob but request body limit is 50MB)
- MIME type filtering (the error mentions JPG/PNG/WEBP → likely client-side check that rejects something the file actually is)
- Base64 encoding boundary issues

- [ ] **Step 3: Check client upload code**

```bash
grep -n "FileReader\|base64\|FormData\|fetch.*event" admin/events.js
```

Likely culprits:
- MIME check using `file.type` that fails when browser reports `image/jpeg` vs whitelist that includes `image/jpg`
- Apps Script web app deployment access scope (must be "Anyone" or "Anyone within Google" depending on tier)

- [ ] **Step 4: Patch + add a console.log on the failing branch**

Make the fix minimal — find the rejection line and fix it. Don't refactor.

- [ ] **Step 5: Re-test with the original Wieczór Chwały JPG**

- [ ] **Step 6: Commit**

```bash
git add admin/events.js admin/google-apps-script.js
git commit -m "fix(admin/events): correct MIME whitelist so JPG uploads succeed"
```

- [ ] **Step 7: Deploy + user-verify (Wave checkpoint)**

```bash
netlify deploy --prod --dir=.
# notify user → Kinga retests admin upload
```

---

## Wave 5 — Ogłoszenia duszpasterskie (new feature)

### Task 15: Data model + Apps Script endpoint for ogłoszenia (M2)

**Files:**
- Modify: `admin/google-apps-script.js` — add `OGLOSZENIA_SHEET` constant + CRUD handlers
- Create: Google Sheet "Ogłoszenia" tab (manual step, document in this task)

**Schema:**

| col | type | notes |
|-----|------|-------|
| id | string | UUID |
| published_at | ISO datetime | sets visibility window start |
| expires_at | ISO datetime | = published_at + 7 days |
| title | string | "Ogłoszenia duszpasterskie — niedziela 1 czerwca 2026" |
| body | markdown / HTML | long-form |
| image_url | string | optional, single illustration |

- [ ] **Step 1: Document the sheet structure in this plan (above), have Kinga add a new tab in the existing PMK events Sheet**

- [ ] **Step 2: Add Apps Script handlers**

In `admin/google-apps-script.js` add functions analogous to existing events handlers:
- `getOgloszenia()` — returns rows where `expires_at > now`
- `addOgloszenie({title, body, image_url})` — sets `published_at = now`, `expires_at = now + 7d`
- `deleteOgloszenie(id)`

Mirror auth/header pattern of existing event handlers exactly — don't invent a new auth scheme.

- [ ] **Step 3: Commit**

```bash
git add admin/google-apps-script.js
git commit -m "feat(admin): Apps Script CRUD for ogłoszenia duszpasterskie (7-day TTL)"
```

---

### Task 16: Admin UI tab "Ogłoszenia" (M2)

**Files:**
- Create: `admin/ogloszenia.js`
- Modify: `admin/index.html` — add new tab button + container
- Modify: `admin/admin.css` — only if styling diverges (reuse existing classes)

- [ ] **Step 1: Add tab to admin navigation**

In `admin/index.html`, locate the existing 3-tab structure (Events/KI/Newsletter — per memory `project_admin_dashboard_shipped`). Insert "Ogłoszenia" tab using the same warm cream/serif design language (per memory `feedback_admin_visual_language` — extend, don't redesign).

- [ ] **Step 2: Create `admin/ogloszenia.js` paralleling `admin/events.js`**

Reuse the pattern of `events.js` — same upload component, same form fields (title, body, optional image). The only diff: this hits the ogłoszenia endpoints, and there's no date field (it's auto-set on publish).

- [ ] **Step 3: Wire tab switching**

The admin already uses always-render-on-tab-switch per recent commit `f8e8393`. Match that pattern.

- [ ] **Step 4: Commit**

```bash
git add admin/ogloszenia.js admin/index.html admin/admin.css
git commit -m "feat(admin): Ogłoszenia tab — weekly pastoral announcements with image"
```

---

### Task 17: Frontend ogłoszenia widget on `index.html` (M2)

**Files:**
- Modify: `index.html`
- Modify: `main.js`
- Create (optional): `components/ogloszenia.html` if the project uses HTML includes

- [ ] **Step 1: Decide placement**

Card must render **before** the "Nadchodzące wydarzenia" grid. If no current ogłoszenie exists, the widget hides cleanly (no empty card).

- [ ] **Step 2: Fetch from Apps Script endpoint**

Add to `main.js`:

```js
async function loadOgloszenie() {
  const res = await fetch(APPS_SCRIPT_URL + '?action=getOgloszenia');
  const items = await res.json();
  if (!items.length) return;
  const o = items[0];   // single current ogłoszenie
  document.querySelector('#ogloszenia-card').innerHTML = renderOgloszenie(o);
}
```

Use the same `APPS_SCRIPT_URL` constant the events code uses.

- [ ] **Step 3: Render template**

```html
<article id="ogloszenia-card" class="ogloszenia">
  <h2>Ogłoszenia duszpasterskie</h2>
  <time datetime="…">…</time>
  <img src="…" alt="">
  <div class="ogloszenia-body">…body…</div>
</article>
```

- [ ] **Step 4: Verify mobile + desktop**

```bash
python3 -m http.server 8080
# open and check at viewport 375px and 1440px
```

- [ ] **Step 5: Commit**

```bash
git add index.html main.js components/
git commit -m "feat(index): render current ogłoszenie duszpasterskie above events grid"
```

---

### Task 18: Video tutorial for adding events / ogłoszenia (M3)

**Out of code scope** — Michał records short video, drop link into `docs/admin-tutorial.md`.

- [ ] **Step 1: Record video** (Michał, not assistant)
- [ ] **Step 2: Add link**

```bash
echo "## Video tutorial\n\n[Add event from mobile](https://...)" >> docs/admin-tutorial.md
git add docs/admin-tutorial.md
git commit -m "docs(admin): link to event/ogłoszenia tutorial video"
```

---

## Wave 6 — DE version + PL-only notice

### Task 19: DE subpages audit (P1)

**Files:**
- Audit: `de/index.html`, `de/kontakt.html`, `de/messzeiten.html`

- [ ] **Step 1: Walk every DE page in browser**

```bash
python3 -m http.server 8080
# open http://localhost:8080/de/ and click every link
```

Document broken links / missing content / untranslated chunks per page. Fix what's quick; defer the rest with a TODO note (don't block launch on a perfect DE site — it's secondary per D3).

- [ ] **Step 2: Commit fixes**

```bash
git add de/
git commit -m "fix(de): repair broken links and missing content in German pages"
```

---

### Task 20: PL-only notice on DE pages + in agent knowledge base (L3, P2)

**Files:**
- Modify: `de/index.html`
- Modify: `knowledge-base/*.md`

- [ ] **Step 1: Add to `de/index.html` (visible block)**

```html
<section class="lang-notice">
  <p>
    <strong>Hinweis zur Sprache:</strong> Die Polnische Katholische Mission ist
    eine polnischsprachige Gemeinde. Alle Sakramente und Gemeinschaftsangebote
    finden auf Polnisch statt. Für deutsch- oder englischsprachige Anliegen
    verweisen wir an die benachbarte Pfarrei.
  </p>
</section>
```

- [ ] **Step 2: Add equivalent passage to `knowledge-base/*.md` (DE section)**

So the ElevenLabs agent answers consistently when asked in DE/EN. Cross-ref memory `reference_knowledge_base`.

- [ ] **Step 3: Commit**

```bash
git add de/index.html knowledge-base/
git commit -m "feat(i18n): add PL-only community notice on DE site + agent KB"
```

---

## Wave 7 — Deploy + verify

### Task 21: Production deploy + user-verify checkpoint

- [ ] **Step 1: Final local sweep**

```bash
# run any existing build / lint if present
ls package.json && npm run lint 2>/dev/null
# manual smoke
python3 -m http.server 8080
# walk index → sakramenty → grupy → kontakt → admin
```

- [ ] **Step 2: Deploy to Netlify production**

```bash
netlify deploy --prod --dir=.
```

Per memory `feedback_no_netlify_auto_deploy`: `git push` does NOT trigger deploy. Must be manual.

- [ ] **Step 3: User-verify on pmk-berlinpl.netlify.app**

Notify user (Michał) to walk the site + share with Kinga + Proboszcz for sign-off **before** the DNS cutover from WIX to Netlify (per memory `project_domain_routing_status`).

- [ ] **Step 4: Schedule DNS cutover for 08.06.2026** (manual, ops task)

---

## Self-Review

- **Spec coverage:** All SUMMARY action items A1–Q4 mapped except: L1–L7 (out of scope, separate ElevenLabs work), M5 (manual password change), N1 (no-op decision), O1 (manual WhatsApp), Q1–Q3 (logistics, no code).
- **Placeholders:** None — every task has exact file paths and concrete content.
- **Type consistency:** N/A (no shared symbols across waves; static HTML + isolated Apps Script handlers).

If anything turns out to be more complex than expected during execution (especially Task 14 admin bug and Task 15–17 new ogłoszenia feature), pause and surface for re-planning rather than expanding scope inline.

---

## Execution Handoff

Two options:

**1. Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration via `superpowers:subagent-driven-development`.

**2. Inline Execution** — execute tasks in this session using `superpowers:executing-plans`, batch with checkpoints.

Recommendation for this plan: **Wave 1–3 inline** (they're trivial edits, fast), **Wave 4 inline with debugging**, **Wave 5 subagent-driven** (it's a self-contained feature where subagent isolation pays off), **Wave 6–7 inline**.
