# KI-AI-Zusammenfassung + Mobile-Polish + Keyboard-Shortcuts — Design Spec

**Datum:** 2026-05-29
**Status:** Draft, awaiting user review
**Scope:** Drei zusammenhängende UX-Erweiterungen für das PMK-Admin-Dashboard:
1. AI-Zusammenfassung + Transkript + Antwort-Vorschlag im KI-Side-Panel
2. Mobile-responsive Polish (Sidebar-Drawer, Card-Layout, Bottom-Sheet)
3. Keyboard-Shortcuts für Power-User

---

## 1. Ziel

Das KI-Czat-Tab wird vom „Liste anzeigen" zum „in 5 Sekunden verstehen + handeln" Werkzeug. Sekretärin öffnet ein Gespräch → AI fasst zusammen was los war → ein Klick generiert einen Antwort-Vorschlag den sie kopieren oder als Mailto öffnen kann. Plus: das gesamte Dashboard wird auf Handy nutzbar (Sekretärin nutzt es oft mobil) und für Power-User per Keyboard navigierbar.

**Nicht-Ziele:**
- Newsletter-Versand (explizit von User gestrichen für jetzt)
- Per-User-Logins
- Übersichts-Cockpit oder Statystyki-Erweiterungen (beide schon shipped)
- DNS-Cutover (separate Workstream, später)

---

## 2. Architektur Übersicht

**Drei neue Bausteine:**

| Baustein | Wo | Funktion |
|---|---|---|
| `netlify/functions/ki-summarize.js` | Serverless | POST → ElevenLabs Transkript + Claude Haiku Summary/Draft + Blob-Cache |
| `admin/ki.js` Side-Panel erweitert | Frontend | Lädt Summary on-demand, zeigt strukturiert, Draft-Button, Transcript-Accordion |
| `admin/admin.css` Mobile + Shortcuts | Frontend | Media-Queries für <720px, Drawer/Bottom-Sheet, Shortcut-Visual-Cues |

**Daten-Fluss für Summary:**

```
User klickt Zeile
  → KI.openPanel(id)
  → render() zeigt Side-Panel mit Loading-State
  → fetch /.netlify/functions/ki-summarize?id=X&type=summary&pin=Y
    → Function prüft Blob-Cache (key: "X:summary")
    → Cache hit: 50ms, return cached JSON
    → Cache miss: 
      → fetch ElevenLabs GET /v1/convai/conversations/X
      → POST an Claude Haiku 4.5 mit System-Prompt für strukturierte Polish summary
      → Parse Claude response → JSON
      → store.setJSON("X:summary", result)
      → return result
  → render() ersetzt Loading mit Summary
```

**Draft-Flow** analog mit `type=draft`, anderes System-Prompt.

**Caching:**
- Store: `ki-ai-cache` (eigener Blob-Store, nicht mit `ki-flags` vermischen)
- Key: `{conversation_id}:{type}` z.B. `conv_3101k...:summary`
- Kein TTL — Conversations sind unveränderlich, Cache forever gültig

**Kosten-Schutz:**
- Per-PIN rate limit: 100 Aufrufe pro Stunde
- In-Memory counter in function (resets per cold-start)
- Bei Überschreitung: 429 mit klarer Fehlermeldung

---

## 3. AI-Prompts

### 3.1 Summary-Prompt (System)

```
Jesteś asystentem polskiej parafii w Berlinie. Otrzymujesz transkrypt rozmowy
z chatbotem lub agentem głosowym parafii. Twoim zadaniem jest stworzenie
zwięzłego, użytecznego podsumowania dla sekretarki parafii.

Odpowiedz WYŁĄCZNIE w formacie JSON:
{
  "summary": "Jeden lub dwa zdania po polsku opisujące główny temat rozmowy.",
  "person": "Imię i nazwisko (jeśli podane), inaczej 'Nie podano'",
  "data": "Data wydarzenia/terminu (jeśli wspomniana), inaczej '-'",
  "akcja": "Co sekretarka powinna zrobić (krótko, po polsku)",
  "pilnosc": "niska" | "srednia" | "wysoka"
}

Zasady pilności:
- "wysoka": namaszczenie chorych, pogrzeb, śmierć, wypadek, szpital, "pilne"
- "srednia": zaplanowane sakramenty (chrzest, ślub), wymaga terminu
- "niska": ogólne pytania, informacje, brak wymaganej akcji
```

User-message: das Transkript als JSON-Array `[{role, text}, ...]`.

### 3.2 Draft-Prompt (System)

```
Jesteś asystentem polskiej parafii w Berlinie. Otrzymujesz transkrypt rozmowy
oraz podsumowanie. Twoim zadaniem jest zaproponować uprzejmą, profesjonalną
odpowiedź po polsku, którą sekretarka może wysłać.

Zasady:
- Maksymalnie 5 zdań
- Ton: ciepły, ale formalny ("Szanowna Pani / Szanowny Panie")
- Konkretny: zaproponuj konkretne kroki (godziny biura, telefon, link do strony)
- Jeśli rozmowa nie zawiera adresu email lub telefonu, napisz tekst do skopiowania

Odpowiedz WYŁĄCZNIE w formacie JSON:
{
  "draft": "Pełny tekst odpowiedzi po polsku, gotowy do skopiowania.",
  "via": "email" | "telefon" | "tekst",
  "to": "adres email LUB numer telefonu LUB null"
}
```

### 3.3 Claude API Call

- Model: `claude-haiku-4-5-20251001` (schnell, billig, ausreichend für Zusammenfassung)
- Max output tokens: 500 (Summary) bzw. 800 (Draft)
- Temperature: 0.3 (konsistente, faktische Zusammenfassungen)
- Response-Format: text (wir parsen JSON manuell)
- Anthropic SDK: nicht nötig, plain `fetch` an `https://api.anthropic.com/v1/messages`

---

## 4. KI Side-Panel UI

### 4.1 Struktur

```html
<aside class="ki-panel" role="dialog">
  <header>
    <h2>Rozmowa</h2>
    <button class="ki-close">×</button>
  </header>
  <p class="ki-meta">23.05.2026 · 📞 Telefon · PL</p>
  
  <!-- NEU: AI Summary Card -->
  <div class="ki-ai-summary" data-state="loading|ready|error">
    <!-- loading: spinner + "AI generuje podsumowanie…" -->
    <!-- ready: -->
    <div class="ki-ai-headline">
      🤖 <strong>Podsumowanie</strong>
    </div>
    <p class="ki-ai-text">{summary}</p>
    <dl class="ki-ai-fields">
      <dt>Osoba:</dt><dd>{person}</dd>
      <dt>Data:</dt><dd>{data}</dd>
      <dt>Akcja:</dt><dd>{akcja}</dd>
      <dt>Pilność:</dt><dd class="ki-ai-pilnosc ki-ai-pilnosc-{level}">{pilnosc}</dd>
    </dl>
  </div>
  
  <!-- NEU: Transkript expandable -->
  <details class="ki-transcript-toggle">
    <summary>▸ Pokaż pełną rozmowę ({message_count} wiadomości)</summary>
    <div class="ki-transcript-content">
      <!-- Loaded lazily on first expand -->
    </div>
  </details>
  
  <!-- Existing Status-Buttons (unverändert) -->
  <div class="ki-flags">
    <p class="ki-flags-label">Status:</p>
    <button ...>Załatwione</button> ...
  </div>
  
  <!-- NEU: Draft-Button -->
  <button class="ki-draft-btn">✨ Zaproponuj odpowiedź</button>
  <div class="ki-draft-result" hidden>
    <textarea class="ki-draft-text" readonly></textarea>
    <button class="ki-draft-copy">📋 Kopiuj</button>
    <a class="ki-draft-mailto" href="..." hidden>✉️ Otwórz w mailu</a>
  </div>
  
  <!-- Existing Notatka -->
  <textarea class="ki-note"></textarea>
  <button class="ki-save">Zapisz</button>
</aside>
```

### 4.2 Interaktionen

- **On panel-open:** Render mit Loading-Cards für Summary. Async fetch summary. Replace loading with content.
- **On „Pokaż pełną rozmowę" click:** Lazy fetch transcript wenn noch nicht da. Chronologische Anzeige `[role: text]`.
- **On „Zaproponuj odpowiedź" click:** Button → Spinner → fetch draft → reveal textarea + Kopiu-Button + Mailto (falls Email-Adresse erkannt).
- **On Kopieren:** `navigator.clipboard.writeText`, kurzes Toast „Skopiowano".

### 4.3 Caching auf Client-Seite

In-memory cache in `KI` IIFE: `let summaryCache = {}` und `draftCache = {}` keyed auf `conversation_id`. Innerhalb derselben Browser-Session keine Doppel-Aufrufe.

---

## 5. Mobile-Responsive Polish

### 5.1 Sidebar → Drawer auf <720px

Aktuell wird die Sidebar zu einem horizontalen Scroll-Strip — schlecht bedienbar.

**Neu:**
- Topbar zeigt zusätzlich Hamburger-Icon links (☰)
- Klick → Sidebar slidet von links rein als Drawer (Overlay)
- Backdrop auf Hauptinhalt (semitransparent)
- Klick auf Backdrop oder Nav-Item → schließt Drawer

### 5.2 KI-Tabelle → Card-Liste auf <720px

Aktuelle Tabelle ist horizontal scrollbar (auch nicht ideal).

**Neu auf Mobile:**
- Jede Zeile = Karte (white background, padding, rounded)
- Zwei Reihen pro Karte:
  - Reihe 1: Checkbox (groß, 32×32 tap-target) · Zeit (klein) · Kanał-Icon · Status-Badge
  - Reihe 2: Topic in voller Breite, eventuell 2-zeilig
- Urgent-Karten: zusätzlicher roter linker Rand (4px)
- Tap auf Karte → Side-Panel

### 5.3 Side-Panel → Bottom-Sheet auf <720px

420px-Side-Panel ist auf 375px Display unbedienbar.

**Neu auf Mobile:**
- Side-Panel wird Bottom-Sheet: position fixed, bottom 0, full width, max-height 92vh, border-radius oben 16px
- Slide-up Animation
- Drag-Handle oben (visuell, kein echtes Dragging)
- Scrollbar nur innerhalb Sheet
- Klick auf Backdrop (außerhalb Sheet) → schließt

### 5.4 Events-Modal → Full-screen auf <600px

Aktuell schwebt das Modal — auf 375px zu schmal.

**Neu:**
- Bei <600px: Modal nimmt 100vw × 100vh, kein Border-Radius
- Header sticky oben, Save-Button sticky unten
- Restliche Felder scrollen dazwischen

### 5.5 Newsletter / Przegląd / Statystyki

- Schon responsive via `grid-template-columns: repeat(auto-fit, minmax(180px, 1fr))` und Flexbox
- Nur Spot-Check: alle Felder fit + Schriftgrößen lesbar bei 375px

---

## 6. Keyboard-Shortcuts

### 6.1 Shortcut-Tabelle

| Taste | Kontext | Aktion |
|---|---|---|
| `J` / `↓` | KI-Tab (kein Input fokussiert) | Markiere nächste Zeile |
| `K` / `↑` | KI-Tab | Markiere vorherige Zeile |
| `Enter` | KI-Tab (Zeile markiert) | Öffne Side-Panel für Zeile |
| `Esc` | Side-Panel offen | Schließe Side-Panel |
| `X` | KI-Tab (Zeile markiert) | Toggle Checkbox („Załatwione") |
| `1` | Global | → Przegląd |
| `2` | Global | → Events |
| `3` | Global | → KI-Czat |
| `4` | Global | → Newsletter |
| `5` | Global | → Statystyki |
| `/` | Global | Fokus auf Such-Input (falls Tab hat einen) |
| `?` | Global | Modal mit Shortcut-Übersicht |

### 6.2 Implementation

- Single `keydown` listener auf `document`
- Filtere wenn `e.target.tagName === 'INPUT' || 'TEXTAREA' || 'SELECT'` (außer für `Esc`)
- Tab-Wechsel via `location.hash = '#name'` (triggert existing router)
- Zeilen-Markierung: visueller fokus-Ring auf `.ki-row` (border + box-shadow)
- State `selectedRowIndex` in `KI` IIFE
- Bei Filter/Search change: index reset auf 0

### 6.3 Visual Cues

- Footer-Hinweis im Onboarding-Banner: „Tip: Naciśnij `?` aby zobaczyć skróty klawiszowe"
- `?`-Modal: simple Liste, dismissable
- Hover-Tooltip auf KI-Spaltenheader: „J/K — nawigacja"

---

## 7. File-Struktur Änderungen

```
admin/
  ki.js                  ← erweitert: summary fetch + draft + transcript + shortcuts
  shortcuts.js           ← NEU: globale Keyboard-Handler
  mobile-drawer.js       ← NEU: Hamburger + Drawer für Mobile
  admin.css              ← erweitert: ki-ai-* + mobile @media + shortcut focus-ring

netlify/functions/
  ki-summarize.js        ← NEU: ElevenLabs + Claude + Blob-Cache
```

**Env-Vars (Netlify Production):**
- `ANTHROPIC_API_KEY` — neu (Claude API key, user supplies oder aus existierender Quelle)

---

## 8. Error Handling

- **ElevenLabs unreachable:** Summary card zeigt „Nie udało się pobrać rozmowy" + Retry-Button
- **Claude API quota/limit:** Summary card zeigt „AI niedostępna chwilowo" + Retry
- **Bad JSON from Claude:** Function logged Fehler + returned generischen Fallback-summary „Nie udało się wygenerować podsumowania automatycznie"
- **Rate limit hit (>100/h):** 429 returned, UI zeigt „Zbyt wiele zapytań, spróbuj za chwilę"
- **Blobs-Cache fail:** Function regeneriert ohne Cache-Speicherung, UI bekommt trotzdem Response

---

## 9. Testing-Strategie

- **Function-Tests:** `netlify dev` lokal + curl-Smoke für `/ki-summarize?id=...&type=summary`
- **Browser-Smoke** mit `gstack` browse: KI-Tab → Klick Zeile → Summary erscheint → Draft-Button funktioniert
- **Mobile-Test:** DevTools 375×812 (iPhone X), klicken durch alle Tabs, Side-Panel öffnen
- **Shortcut-Test:** J/K/X/Enter/Esc/1-5 alle einzeln testen

---

## 10. Migration-Strategie

5 Phasen, jede eigener Commit, jede deploybar:

1. **Phase F1:** `ki-summarize.js` Function bauen + env vars setzen + curl-Smoke
2. **Phase F2:** Side-Panel UI: Summary-Card + Loading + Caching + Render
3. **Phase F3:** Side-Panel: Draft-Button + Transcript-Accordion
4. **Phase F4:** Mobile-Polish: Drawer + Card-Layout + Bottom-Sheet + Modal-Fullscreen
5. **Phase F5:** Keyboard-Shortcuts + ?-Modal + Cues

---

## 11. Out-of-Scope (explizit nicht jetzt)

- Newsletter-Versand
- DNS-Cutover (separate)
- Multi-User-Logins
- Auto-Email-Versand (user kopiert Draft, sendet manuell via Mail-Client)
- Charts / Statystyki-Erweiterungen
- Audio-Playback von Voice-Conversations
- Mehrsprachigkeit der AI (nur Polish output)

---

## 12. Nächster Schritt

Spec wird mit **writing-plans** Skill in einen ausführbaren Plan überführt. Plan deckt die fünf Phasen (F1–F5) ab mit klaren Akzeptanzkriterien.
