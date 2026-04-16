---
name: pmk-content-translator
description: Translates PMK Berlin church website content between Polish and German. This skill should be used when adding German translations to existing Polish pages, creating new bilingual content, or implementing/extending the i18n system. Covers liturgical vocabulary, church-specific terminology, and UI text.
---

# PMK Content Translator

Translate and manage bilingual (Polish/German) content for the Polska Misja Katolicka Berlin website — a static HTML/CSS/JS church website hosted on Netlify.

## When to Use

- Translating existing Polish page content into German
- Adding `data-i18n` attributes to HTML elements for dynamic language switching
- Extending the `translations/` JSON files with new keys
- Creating new pages that need both PL and DE content
- Updating the `setLang()` function or i18n runtime logic
- Reviewing translations for liturgical/church accuracy

## Architecture Overview

The i18n system uses a **JSON + data-attribute** approach:

```
translations/
├── common.json       ← Navigation, footer, buttons, shared UI
├── index.json        ← Homepage-specific content
├── sakramente.json   ← Sacraments page
├── kontakt.json      ← Contact page
├── events.json       ← Events page & cards
└── wspolnoty.json    ← All community/group pages
```

Each JSON file contains Polish (`pl`) and German (`de`) keys:

```json
{
  "nav.home": {
    "pl": "Strona glowna",
    "de": "Startseite"
  },
  "nav.sacraments": {
    "pl": "Sakramenty",
    "de": "Sakramente"
  }
}
```

HTML elements reference keys via `data-i18n`:

```html
<a href="index.html" data-i18n="nav.home">Strona glowna</a>
```

The Polish text remains as the default innerHTML. When German is selected, the i18n runtime replaces it.

## Translation Workflow

### Step 1: Identify translatable content

Scan the target HTML file for user-visible text. Categorize into:

- **Static UI** (nav, buttons, labels, headings) — add `data-i18n` attribute
- **Rich content** (paragraphs with `<em>`, `<strong>`, `<br>`) — use `data-i18n-html` for innerHTML replacement
- **Attributes** (placeholder, alt, title, aria-label) — use `data-i18n-attr="placeholder:key"`
- **Skip**: Proper nouns (Johannes-Basilika), addresses, phone numbers, email

### Step 2: Create translation keys

Use dot-notation namespaced by page and section:

```
{page}.{section}.{element}

Examples:
  index.hero.badge        → "Od 1945 roku w Berlinie" / "Seit 1945 in Berlin"
  index.hero.title        → "Polska Misja Katolicka" / "Polnische Katholische Mission"
  index.mass.sunday.label → "Niedziela" / "Sonntag"
  kontakt.form.name       → "Imie i nazwisko" / "Vor- und Nachname"
```

### Step 3: Write German translations

Consult `references/glossary.md` for church-specific terminology. Key principles:

1. **Liturgical terms** have established German equivalents — never improvise
2. **Tone**: Formal "Sie"-form, respectful, warm — matching the spiritual design
3. **Keep it natural** — translate meaning, not word-for-word
4. **Preserve HTML structure** — if Polish uses `<em>`, German must too
5. **Bible verses**: Use official German translation (Einheitsuebersetzung)

### Step 4: Add data-i18n to HTML

```html
<!-- Plain text -->
<span data-i18n="index.hero.badge">Od 1945 roku w Berlinie</span>

<!-- Rich HTML content -->
<h1 data-i18n-html="index.hero.title">Polska Misja <em>Katolicka</em></h1>

<!-- Attribute translation -->
<input placeholder="Wpisz wiadomosc..." data-i18n-attr="placeholder:kontakt.form.message_placeholder">

<!-- Multiple attributes -->
<img alt="Wnetrze kosciola" data-i18n-attr="alt:index.hero.image_alt">
```

### Step 5: Update JSON translation file

Add the new keys to the appropriate JSON file in `translations/`. Always include both `pl` and `de`.

## i18n Runtime (js/i18n.js)

The runtime script handles language switching. Reference implementation:

```javascript
// Load translations, apply to DOM, persist choice in localStorage
// Listens for setLang() calls
// On page load: check localStorage, apply saved language
// Fallback: Polish (pl) is always the default
```

Key behaviors:
- `setLang('de')` — loads page-specific + common JSON, replaces all `data-i18n` elements
- `setLang('pl')` — restores original Polish innerHTML (stored on first load)
- Language choice persists via `localStorage.setItem('pmk-lang', lang)`
- On page load: auto-apply saved language preference

## File Naming Conventions

- Translation JSON: lowercase, matching HTML filename without extension
- Community pages all share `wspolnoty.json` with keys prefixed by group slug:
  ```
  wspolnoty.apostolstwo.title
  wspolnoty.grupa-meska.title
  wspolnoty.schola.tagline
  ```

## Quality Checklist

Before finalizing translations:

- [ ] All liturgical terms match `references/glossary.md`
- [ ] Bible verses use Einheitsuebersetzung (German) or Biblia Tysiaclecia (Polish)
- [ ] "Sie"-form used consistently (never "du")
- [ ] HTML structure preserved (same `<em>`, `<strong>`, `<br>` tags)
- [ ] No untranslated strings left visible when switching to DE
- [ ] Page title and meta description also have DE variants
- [ ] Proper nouns kept unchanged (Johannes-Basilika, Kreuzberg, PMK)
