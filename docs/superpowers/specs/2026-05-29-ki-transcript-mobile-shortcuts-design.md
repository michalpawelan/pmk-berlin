# KI-Transkript + Mobile-Polish + Keyboard-Shortcuts — Design Spec

**Datum:** 2026-05-29 (revidiert nach Kostenentscheidung)
**Status:** Draft, awaiting user review
**Scope:** Drei zusammenhängende UX-Erweiterungen für das PMK-Admin-Dashboard:
1. Vollständiges Transkript im KI-Side-Panel (aus ElevenLabs, keine zusätzlichen AI-Kosten)
2. Mobile-responsive Polish (Sidebar-Drawer, Card-Layout, Bottom-Sheet)
3. Keyboard-Shortcuts für Power-User

**Wichtige Kostenentscheidung:** Keine externen AI-APIs (Claude/OpenAI/etc.) in diesem Scope. Nur Daten verwenden, die ElevenLabs im bestehenden Abo bereits liefert. AI-Funktionen kommen in einem späteren, separaten Scope wenn die Pfarrei eigene API-Keys einrichten möchte.

---

## 1. Ziel

Das KI-Czat-Tab wird vom „Liste anzeigen" zum „in 10 Sekunden verstehen was passiert ist". Sekretärin öffnet ein Gespräch → sieht vollständiges chronologisches Transkript → kann den Status setzen, eine Notatka schreiben, und weiter. Plus: das gesamte Dashboard wird auf Handy nutzbar und für Power-User per Keyboard navigierbar.

**Nicht-Ziele:**
- AI-Zusammenfassung (verschoben — separate Phase wenn Pfarrei eigene Keys hat)
- AI-Antwort-Vorschlag (verschoben)
- Newsletter-Versand
- Per-User-Logins
- DNS-Cutover (separate Workstream)

---

## 2. Architektur Übersicht

**Drei Bausteine:**

| Baustein | Wo | Funktion |
|---|---|---|
| `netlify/functions/ki-transcript.js` | Serverless | GET → ElevenLabs Conversation-Detail-Endpoint, returns transcript JSON |
| `admin/ki.js` Side-Panel erweitert | Frontend | Lazy lädt Transkript on-demand, zeigt chronologisch, Caching client-side |
| `admin/admin.css` Mobile + Shortcuts | Frontend | Media-Queries für <720px, Drawer/Bottom-Sheet, Shortcut-Visual-Cues |
| `admin/shortcuts.js` | Frontend | NEU: globale Keyboard-Handler |
| `admin/mobile-drawer.js` | Frontend | NEU: Hamburger + Drawer-Logik |

**Daten-Fluss für Transkript:**

```
User klickt Zeile in KI-Tabelle
  → KI.openPanel(id)
  → render() zeigt Side-Panel mit ElevenLabs-Daten die schon im Cache sind
    (Topic, Zeit, Kanal, Sprache, Dauer, Status, Notatka)
  → Wenn User auf "▸ Pokaż pełną rozmowę" klickt:
    → fetch /.netlify/functions/ki-transcript?id=X&pin=Y
      → Function prüft Auth (verifyPin wie ki-conversations.js)
      → fetch ElevenLabs GET /v1/convai/conversations/X
      → Extrahiert transcript array, returns als JSON
    → render Transkript chronologisch im Accordion
    → client-side cache für die Browser-Session
```

**Keine neuen Env-Vars nötig.** ElevenLabs API-Key + Agent-ID sind schon konfiguriert.

**Keine Server-Caching nötig.** Transkripte sind klein (typisch <10 KB) und ElevenLabs-Endpoint ist schnell. Client-Side in-memory cache reicht.

---

## 3. KI Side-Panel UI

### 3.1 Struktur

```html
<aside class="ki-panel" role="dialog">
  <header>
    <h2>Rozmowa</h2>
    <button class="ki-close">×</button>
  </header>
  <p class="ki-meta">23.05.2026 17:51 · 📞 Telefon · PL · 4 sek · 2 wiadomości</p>
  
  <!-- Topic-Card aus existing data -->
  <div class="ki-topic">
    <div class="ki-topic-label">Temat</div>
    <p>Chrzest dziecka</p>
  </div>
  
  <!-- Transkript expandable -->
  <details class="ki-transcript-toggle">
    <summary>▸ Pokaż pełną rozmowę</summary>
    <div class="ki-transcript-content">
      <!-- Loaded lazily on first expand -->
      <!-- Loading: <div class="ki-spinner"></div><span>Wczytywanie transkryptu…</span> -->
      <!-- Ready: -->
      <ol class="ki-msg-list">
        <li class="ki-msg ki-msg-user">
          <span class="ki-msg-role">Użytkownik</span>
          <p>{message text}</p>
        </li>
        <li class="ki-msg ki-msg-agent">
          <span class="ki-msg-role">Asystent</span>
          <p>{response text}</p>
        </li>
        <!-- ... chronological ... -->
      </ol>
      <!-- Error: <p class="ki-msg-error">Nie udało się pobrać transkryptu.</p> -->
    </div>
  </details>
  
  <!-- Bestehende Status-Buttons (unverändert) -->
  <div class="ki-flags">
    <p class="ki-flags-label">Status:</p>
    <button class="btn btn-ghost btn-sm ki-flag-btn" data-status="done">Załatwione</button>
    <button class="btn btn-ghost btn-sm ki-flag-btn" data-status="followup">Follow-up</button>
    <button class="btn btn-ghost btn-sm ki-flag-btn" data-status="bad_answer">Zła odpowiedź</button>
    <button class="btn btn-ghost btn-sm ki-flag-btn" data-status="spam">Spam</button>
  </div>
  
  <!-- Bestehende Notatka -->
  <textarea class="ki-note" placeholder="Notatka (opcjonalna)…"></textarea>
  <button class="btn btn-accent btn-sm ki-save">Zapisz</button>
</aside>
```

### 3.2 Interaktionen

- **On panel-open:** Render sofort mit ElevenLabs-Daten die schon in `convos[]` sind (Topic, Meta, Status). Kein Loading-State für die Basics.
- **On „Pokaż pełną rozmowę" click:** Lazy fetch transcript wenn noch nicht da. Inline Spinner während Fetch. Replace mit Liste oder Error.
- **Status + Notatka:** unverändert von bestehender Implementierung (saveFlag etc.)

### 3.3 Client-Side Cache

```javascript
let transcriptCache = {};   // key = conversation_id, value = transcript array
```

Innerhalb derselben Browser-Session: zweites Öffnen → instant.

### 3.4 Transkript-Anzeige

- Chronologisch (älteste oben)
- Sprecher-Label: „Użytkownik" für `role:user`, „Asystent" für `role:agent`
- User-Nachrichten: leicht eingerückt links, anderer Hintergrund
- Agent-Nachrichten: leicht eingerückt rechts, anderer Hintergrund
- Lange Nachrichten umbrechen sauber

---

## 4. Mobile-Responsive Polish

### 4.1 Sidebar → Drawer auf <720px

Aktuelle horizontale Scroll-Strip ist schlecht bedienbar.

**Neu:**
- Topbar zeigt zusätzlich Hamburger-Icon links (☰)
- Klick → Sidebar slidet von links rein als Drawer (Overlay)
- Backdrop auf Hauptinhalt (semitransparent, click closes)
- Klick auf Nav-Item → schließt Drawer + wechselt Tab
- Z-index Drawer = 60 (über topbar=50, unter modals=200)

### 4.2 KI-Tabelle → Card-Liste auf <720px

Auf Mobile wird die Tabelle zu Karten:

```html
<div class="ki-mobile-card ki-row-urgent">
  <div class="ki-card-row1">
    <input type="checkbox" class="ki-row-check">
    <span class="ki-card-time">23.05 17:51</span>
    <span class="ki-card-chan">📞</span>
    <span class="ki-status ki-status-unhandled">Otwarte</span>
  </div>
  <div class="ki-card-row2">
    🔴 Chrzest dziecka
  </div>
</div>
```

- Checkbox links groß (32×32 Tap-Target)
- Urgent: 4px roter linker Rand
- Tap auf Karte (außer Checkbox) → Side-Panel

### 4.3 Side-Panel → Bottom-Sheet auf <720px

420px-Side-Panel ist auf 375px-Display unbenutzbar.

**Neu auf Mobile:**
- Position: fixed bottom 0, full width
- Max-height: 92vh
- Border-radius: 16px oben, 0 unten
- Slide-up animation
- Visueller Drag-Handle oben (4px×40px, halb-rund)
- Scrollbar nur innerhalb des Sheets
- Backdrop click → closes

### 4.4 Events-Modal → Full-screen auf <600px

Aktuell schwebt das Modal — auf 375px zu schmal.

**Neu:**
- Bei <600px: Modal 100vw × 100vh, kein Border-Radius
- Header sticky oben (mit Close-Button)
- Save-Button sticky unten (CTA bar)
- Restliche Felder scrollen dazwischen

### 4.5 Newsletter / Przegląd / Statystyki

Spot-Check Mobile (375px) — Anpassungen falls nötig:
- Stat-Cards bereits auto-fit grid → sollten 1-spaltig fallen
- News-Tabelle horizontal scrollbar → OK
- Stat-Charts (SVG) responsive via viewBox → OK

---

## 5. Keyboard-Shortcuts

### 5.1 Shortcut-Tabelle

| Taste | Kontext | Aktion |
|---|---|---|
| `J` / `↓` | KI-Tab (kein Input fokussiert) | Markiere nächste Zeile |
| `K` / `↑` | KI-Tab | Markiere vorherige Zeile |
| `Enter` | KI-Tab (Zeile markiert) | Öffne Side-Panel für Zeile |
| `Esc` | Side-Panel / Drawer / Modal offen | Schließe |
| `X` | KI-Tab (Zeile markiert) | Toggle Checkbox („Załatwione") |
| `1` | Global | → Przegląd |
| `2` | Global | → Events |
| `3` | Global | → KI-Czat |
| `4` | Global | → Newsletter |
| `5` | Global | → Statystyki |
| `/` | Global | Fokus auf Such-Input (falls Tab hat einen) |
| `?` | Global | Modal mit Shortcut-Übersicht |

### 5.2 Implementation

- Single `keydown` listener auf `document` in `admin/shortcuts.js`
- Filtere wenn `e.target.tagName` ist `INPUT` / `TEXTAREA` / `SELECT` (außer für `Esc`)
- Tab-Wechsel via `location.hash = '#name'` (triggert existing router + tab-spezifische load)
- Zeilen-Markierung: visueller focus-Ring (3px box-shadow inset, color-accent) auf `.ki-row`
- State `selectedRowIndex` in `KI` IIFE — Reset bei Filter/Search/Range change

### 5.3 Visual Cues

- Footer-Hinweis im KI-Onboarding-Banner: „💡 Naciśnij `?` aby zobaczyć skróty klawiszowe."
- `?`-Modal: leicht zentriert, Tabelle, dismissable mit Esc oder Click outside

---

## 6. File-Struktur Änderungen

```
admin/
  ki.js                  ← erweitert: transcript fetch + lazy + selectedRowIndex
  shortcuts.js           ← NEU: globale Keyboard-Handler + ?-Modal
  mobile-drawer.js       ← NEU: Hamburger + Drawer-Logik
  admin.css              ← erweitert: ki-transcript-* + ki-mobile-* + @media + ?-modal styles
  index.html             ← erweitert: <script> tags neu, Hamburger-Button in Topbar

netlify/functions/
  ki-transcript.js       ← NEU: GET → ElevenLabs Conversation-Detail
```

**Keine neuen Env-Vars.**

---

## 7. Error Handling

- **ElevenLabs unreachable beim Transkript-Fetch:** Inline-Error im Accordion: „Nie udało się pobrać transkryptu. [Spróbuj ponownie]"
- **Transkript leer (z.B. abgebrochener Call):** „Brak treści w tej rozmowie."
- **Drawer-State auf Tab-Wechsel:** automatisch schließen
- **Shortcut-Konflikt (z.B. user tippt in Notatka):** keyboard handler ignoriert wenn input fokussiert
- **Mobile-Sheet öffnen ohne Tap-Target zu blockieren:** prevent body-scroll wenn Sheet offen

---

## 8. Testing-Strategie

- **Function-Smoke:** `curl /.netlify/functions/ki-transcript?id=conv_3101k...&pin=pmk2026` → JSON mit transcript array
- **Browser-Smoke** mit `gstack` browse:
  - KI-Tab → klick Zeile → Side-Panel öffnet
  - Klick „Pokaż pełną rozmowę" → Transkript erscheint
  - Zweites Öffnen derselben Conversation → instant (cache)
- **Mobile-Test (375×812 iPhone X DevTools):**
  - Login → Hamburger-Drawer öffnen → Nav-Item klicken → Tab wechseln
  - KI-Tab als Karten dargestellt
  - Klick Karte → Bottom-Sheet öffnet sich 92vh
  - Events „+ Nowe wydarzenie" → Full-screen Modal
- **Keyboard-Test:** alle Tasten aus Tabelle 5.1 einzeln durchklicken
- **Shortcut-Modal:** `?` öffnet, `Esc` schließt

---

## 9. Migration-Strategie

5 Phasen, jede ein eigener Commit, jede deploybar:

1. **Phase F1:** `ki-transcript.js` Function + curl-smoke
2. **Phase F2:** Side-Panel: Transcript-Accordion + lazy fetch + client cache + CSS
3. **Phase F3:** Mobile: Hamburger-Drawer + KI Card-Layout + Bottom-Sheet
4. **Phase F4:** Mobile: Events-Modal full-screen + Spot-Checks
5. **Phase F5:** Keyboard-Shortcuts + ?-Modal + Visual cues

Phasen sind weitgehend unabhängig — bei Bedarf parallelisierbar (außer F3+F4 die beide an admin.css arbeiten).

---

## 10. Out-of-Scope (explizit nicht jetzt)

- **AI-Zusammenfassung (Claude/OpenAI):** kostet User-Geld, später wenn Pfarrei eigene Keys hat
- **AI-Auto-Draft:** dito
- **Newsletter-Versand**
- **DNS-Cutover** (separate Phase, ein paar Minuten Konfig)
- **Multi-User-Logins**
- **Audio-Playback** von Voice-Conversations (ElevenLabs liefert recording URL, könnten wir später anbinden)
- **Charts in Statystyki erweitern**

---

## 11. Nächster Schritt

Spec wird mit **writing-plans** Skill in einen ausführbaren Plan überführt. Plan deckt die fünf Phasen (F1–F5) ab mit klaren Akzeptanzkriterien.
