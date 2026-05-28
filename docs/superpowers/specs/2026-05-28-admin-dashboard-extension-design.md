# Admin-Dashboard Erweiterung — Design Spec

**Datum:** 2026-05-28
**Status:** Draft, awaiting user review
**Scope:** Erweiterung des bestehenden `admin/index.html` („Panel Wydarzeń") um zwei neue Tabs (KI-Anfragen, Newsletter) plus Politur des Events-Tabs. Keine Änderung am visuellen System.

---

## 1. Ziel

Aus dem aktuellen single-purpose Event-Manager wird ein modulares Admin-Dashboard, das Sekretärin und Pfarrer benutzen können. Drei Tabs aktiv (Events, KI-Anfragen, Newsletter), zwei Tabs als ausgegraute Platzhalter (Übersicht, Statystyki) — diese werden später aktiviert, wenn echte Daten reifen.

**Nicht-Ziele dieser Iteration:**
- Newsletter-Versand
- Per-User-Logins (nur Vorbereitung der Struktur)
- Cockpit-/Übersichtsseite mit Live-Kacheln
- Mobile-first Redesign

---

## 2. Direction: Modular jetzt, Cockpit später

Bewusst gegen ein „echtes Cockpit" mit Overview-Tiles entschieden. Begründung: Solange KI-Logs und Newsletter-Anmeldungen keine echten Volumina haben, hat eine Live-Übersicht keine Information. Wir bauen die Module einzeln zu Ende, sehen welche Daten tatsächlich fließen, und die Übersichtsseite kommt in einer späteren Phase mit echten Erkenntnissen.

---

## 3. Information Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  PMK Admin                                       [Wyloguj]  │  Topbar
├──────────────┬──────────────────────────────────────────────┤
│ AKTYWNE      │                                              │
│ 📅 Events    │                                              │
│ 💬 KI-Chat   │     Inhalt des aktiven Tabs                  │
│ ✉️ Newsletter│                                              │
│              │                                              │
│ WKRÓTCE      │                                              │
│ 🏠 Przegląd  │                                              │
│ 📊 Statystyki│                                              │
└──────────────┴──────────────────────────────────────────────┘
```

- **Routing per URL-Hash:** `admin/#events` (default), `admin/#ki`, `admin/#newsletter`
- **Login-Screen** wie heute davor (PIN, sessionStorage)
- **Sidebar** in derselben Cream/Warm-Palette wie das bestehende Login + Events-Panel
- **„WKRÓTCE"-Sektion** zeigt ausgegraute Einträge — kommunikatives Signal an die Sekretärin: „das wird noch was, aber jetzt nicht"
- **Mobile:** Sidebar wird zum Hamburger-Menü; bestehende mobile Logik der Event-Tabelle bleibt

---

## 4. Auth

Bleibt unverändert: PIN-Eingabe → `sessionStorage.pmk_admin_pin` → Validierung über `netlify/functions/events-proxy.js`. **Eine** Anmeldung authentifiziert dich für alle Tabs.

**Vorbereitung für später:** Der PIN-Check wird aus dem inline-Script von `admin/index.html` in eine separate `admin/auth.js` herausgezogen. So lässt sich später Rollen-Logik (Owner / Sekretärin / Pfarrer) ergänzen, ohne den Rest des Dashboards anzufassen.

---

## 5. Events-Tab — Politur

Bestehende Funktionen bleiben 1:1 (Modal-Editing, Apps-Script-Sync, Filter-Tabs „Wszystkie/Nadchodzące/Przeszłe", Lösch-Bestätigung).

**Neu:**

1. **Suchzeile** über der Liste — filtert client-side über Titel und Ort.
2. **Community-Filter** (Dropdown) — Werte: „Wszystkie wspólnoty" + die ~10 Wspólnoty aus `wspolnota-*.html`. Pflicht-Feld im Modal beim Anlegen/Editieren.
3. **Community-Badge** pro Event-Zeile — weiche Pastellfarben aus der Cream/Warm-Palette, ein Badge pro Wspólnota. Mapping als Konstante (`COMMUNITY_COLORS`).
4. **Status-Tag** pro Zeile — berechnet aus `event.date`: „Dziś" / „Jutro" / „Za N dni" / leer (Vergangenheit zeigt nichts).
5. **Sidebar-Integration** — Events-Tab ist der erste/Default-Eintrag.

**Datenquelle bleibt:** Google Sheet via Apps Script (über existierende `events-proxy.js`).

---

## 6. KI-Anfragen Tab

**Datenquelle:** ElevenLabs Conversational AI API
- Endpoint: `GET https://api.elevenlabs.io/v1/convai/conversations`
- API-Key bleibt in Netlify-Env (`ELEVENLABS_API_KEY`)
- Übergangsphase: solange n8n-Chatbot noch live ist, kann ein zweiter Adapter ähnliche Daten aus n8n ziehen — Design der `ki-conversations.js`-Function so, dass Datenquellen austauschbar sind.

**Daten-Modell (was wir uns interessieren):**
- `conversation_id`
- `started_at` (UTC, im UI lokalisiert)
- `channel` — `chat` oder `phone` (aus ElevenLabs `metadata.channel`)
- `language` — PL / DE (aus `metadata.language` oder Sprache erkannt)
- `first_user_message` — gekürzt für Listen-Snippet
- `transcript` — Liste `[{role, text, timestamp}]`

**Flags + Notiz (eigene Daten):**
- `status`: einer von `unhandled` (default) | `done` | `followup` | `bad_answer` | `spam`
- `note`: Freitext (max 1000 Zeichen)
- `flagged_by`: PIN-Identifier (reicht für jetzt; später User-ID)
- `flagged_at`: ISO-Timestamp

**Speicherung der Flags: Netlify Blobs**
- Store-Name: `ki-flags`
- Key: `conversation_id`
- Value: JSON-Objekt `{status, note, flagged_by, flagged_at}`
- Begründung: keine neue Infra, keine extra Sheet-Tab-Pflege, atomarer Read/Write pro Conversation.

**Backend-Funktionen:**
- `netlify/functions/ki-conversations.js` — GET. Zieht Liste von ElevenLabs, merged jeweils Blob-Flag rein, gibt sortiert (neueste oben) zurück. Caching: 30 Sek im Memory.
- `netlify/functions/ki-flag.js` — POST. Body: `{conversation_id, status, note}`. Schreibt in Blob. Auth: PIN-Header.

**Frontend-Verhalten:**
- Default-Filter: „offen" (status = `unhandled`)
- Klick auf Zeile öffnet **Side-Panel** rechts (slide-in, ähnlich Modal-Pattern des Events-Tabs)
- Side-Panel zeigt: vollständiges Transkript chronologisch + 4 Flag-Buttons + Textarea für Notiz + „Zapisz"-Button
- Toolbar oben: Volltext-Suche, Kanal-Filter (alle/chat/phone), Flag-Filter (alle/offen/erledigt/follow-up/spam), Datums-Range (letzte 7/30/90 Tage)

---

## 7. Newsletter Tab

**Was schon existiert:**
- `netlify/functions/newsletter-subscribe.js` — nimmt E-Mail entgegen, leitet an Apps Script weiter (Honeypot, Email-Regex, Lang/Source-Tracking).
- Apps-Script-Side (deployed): muss bereits ein `action=subscribe`-Handler haben (da die Function ihn aufruft).

**Was wir bauen:**

### 7.1 Frontend Signup-Form
- Position: **Footer** auf allen Public-Pages (`<footer class="footer">`).
- Inhalt (PL/DE via `data-i18n`):
  - Heading: „Bądź na bieżąco" / „Bleib auf dem Laufenden"
  - Subline: ein-Satz Erklärung (Newsletter kommt bald, sammeln jetzt Adressen)
  - Email-Input + Submit-Button
  - Honeypot (hidden `website`-field) — Function ignoriert bereits
  - GDPR-Hinweis-Link auf `datenschutz.html`
- Submission via `fetch`-POST an `/.netlify/functions/newsletter-subscribe` mit Body `{email, lang, source: window.location.pathname}`.
- Erfolg: Inline-Confirmation („Dziękujemy — Twój e-mail został zapisany"). Fehler: Inline-Fehlermeldung.

### 7.2 Apps-Script Erweiterung
- Neue Route `action=list_subscribers`:
  - Auth: gleicher Pin-Vergleich wie `action=list_events`
  - Output: JSON-Array `[{email, lang, source, created_at}, …]` sortiert neueste oben.
- **Nicht** in dieser Iteration: Bestätigungs-Mails, Double-Opt-In, Unsubscribe-Links (kommt mit Versand-Phase).

### 7.3 Backend-Function
- `netlify/functions/newsletter-list.js` — GET. Ruft Apps-Script mit `action=list_subscribers` auf. Cache: 60 Sek.

### 7.4 Admin Newsletter-Tab UI
- Header-Kachel: „**N** Abonnenten, **+M in den letzten 7 Tagen**"
- Suchzeile: Filter über Email-Text
- Sprach-Filter Dropdown (alle / PL / DE)
- Tabelle: Email · Sprache (Badge) · Quelle (Pfad) · Angemeldet am
- Delete-Button: **nicht** in V1 — Unsubscribe wird mit Versand-Phase eingeführt
- „CSV exportieren" Button oben rechts — generiert Datei client-side aus aktuell sichtbarer/gefilterter Liste

---

## 8. File-Struktur — vorher / nachher

**Heute:**
```
admin/
  index.html              ← Login + Events-Panel (2076 Zeilen, alles inline)
  events.html             ← scheint identische Kopie von index.html
  config.yml              ← CMS-Config (vermutlich Altlast)
  google-apps-script.js   ← lokales Mirror des deployten Scripts

netlify/functions/
  events.js
  events-proxy.js
  agent-events.js
  newsletter-subscribe.js
  support-ticket.js
```

**Nach dieser Iteration:**
```
admin/
  index.html              ← Shell: Login + Sidebar + Tab-Container + Hash-Router
  admin.css               ← extrahiert aus dem inline-Block (gemeinsame Styles)
  auth.js                 ← PIN-Check, sessionStorage, Logout
  events.js               ← bestehende Event-Logik aus index.html ausgelagert
  ki.js                   ← neu: KI-Tab Logic
  newsletter.js           ← neu: Newsletter-Tab Logic
  google-apps-script.js   ← um list_subscribers ergänzt
  events.html             ← bleibt als Backup / wird entfernt wenn index.html geprüft ist
  config.yml              ← bleibt unangetastet

netlify/functions/
  events.js               ← unverändert
  events-proxy.js         ← unverändert
  agent-events.js         ← unverändert
  newsletter-subscribe.js ← unverändert
  newsletter-list.js      ← neu
  ki-conversations.js     ← neu
  ki-flag.js              ← neu
  support-ticket.js       ← unverändert
```

**Public-Pages Änderung:**
Alle 29 HTML-Seiten bekommen das Newsletter-Signup-Snippet in den Footer. Da der Footer aktuell pro Seite kopiert ist, muss das Snippet 29-mal eingefügt werden (oder via Build-Skript verteilt — Empfehlung: erst einmal per Hand 29× einfügen, kein neuer Tooling-Layer).

---

## 9. Error Handling

- **ElevenLabs API down:** KI-Tab zeigt eine cremefarbene Empty-State-Card: „Nie udało się pobrać rozmów. Spróbuj odświeżyć." + Retry-Button. Kein Crash, kein leerer State ohne Erklärung.
- **Apps-Script down:** Events- und Newsletter-Tabs zeigen analoge Empty-State-Karten.
- **Netlify Blobs Fehler beim Flag-Schreiben:** Inline-Snackbar „Nie udało się zapisać. Spróbuj ponownie." — Flag-Status revertiert auf Vor-Klick-Wert.
- **Public-Newsletter-Form Validierungsfehler:** Inline rote Hint-Zeile direkt unterm Input — kein modaler Alert.
- **Auth-Fail:** wie heute — rote Login-Error-Zeile.

---

## 10. Daten-Sicherheit / Datenschutz

- **Newsletter-Anmeldungen:** Datenschutzhinweis-Link bei Signup, Datensparsamkeit (Email + Sprache + Quelle). Kein Tracking-Cookie.
- **KI-Transkripte:** liegen schon bei ElevenLabs; wir ziehen sie nur lesend ins Dashboard. Im Dashboard nicht persistent gespeichert (kommen jedes Mal frisch). Flags + Notizen werden in Netlify Blobs gespeichert — diese enthalten **keine** Klartext-Transkripte, nur Metadaten.
- **API-Keys:** alle in Netlify-Env, nie im Client.
- **PIN:** sessionStorage (kein localStorage) — räumt sich beim Browser-Schließen auf.
- **Impressum/Datenschutz:** Datenschutzseite muss um KI-Logging und Newsletter-Datenverarbeitung ergänzt werden. **Out of scope dieser Spec** — separater Task für die Pfarrerei (rechtlicher Text).

---

## 11. Testing-Strategie

Da das Projekt rein vanilla HTML/JS ohne Test-Framework ist, halten wir es leichtgewichtig:

- **Manuelle Smoke-Tests** über das `gstack`-Tool (Headless Chromium): Login → Tab-Switch → Events sichtbar → KI sichtbar (auch leer ok) → Newsletter sichtbar.
- **Function-Tests** mit `netlify dev` lokal: jede neue Function bekommt einen manuellen curl-Test im Plan dokumentiert.
- **Form-Smoke-Test:** auf Staging einen Test-Email anmelden, im Admin sehen.
- Keine Unit-Tests — wäre für Vanilla-Code unverhältnismäßig.

---

## 12. Migration-Strategie

Da bestehende Sekretärinnen-Arbeit nicht unterbrochen werden darf:

1. **Phase A:** `admin/index.html` wird in Shell + `events.js` + `auth.js` + `admin.css` zerlegt. Funktional identisch zum heutigen Zustand. **Deploy & verifizieren** vor jeder weiteren Änderung.
2. **Phase B:** Sidebar + Hash-Router einbauen. Events-Tab ist Default. Andere Tabs noch nicht da. **Deploy & verifizieren.**
3. **Phase C:** Newsletter-Tab + Frontend-Footer-Form + `newsletter-list.js` + Apps-Script `list_subscribers`. **Deploy & verifizieren.**
4. **Phase D:** KI-Tab + `ki-conversations.js` + `ki-flag.js`. **Deploy & verifizieren.**
5. **Phase E:** Events-Politur (Suche, Community-Filter, Badges, Status-Tags). **Deploy & verifizieren.**

Reihenfolge bewusst: erst Plumbing (A, B), dann das einfachste neue Feature (Newsletter — Backend existiert), dann das komplexere (KI), dann die kosmetische Politur. Jede Phase ist ein eigener Commit.

---

## 13. Out-of-Scope (explizit nicht jetzt)

- Newsletter-Versand inkl. Mailservice-Integration
- Per-User-Logins
- Übersichts-/Cockpit-Tab mit Live-Kacheln
- Statystyki-Tab
- Mobile-first Redesign des Admins
- Datenschutz-Seite (Text-Update für KI + Newsletter)
- Newsletter-Banner auf Index-Page (nur Footer in V1)
- Unsubscribe-Mechanismus (kommt mit Versand)
- Double-Opt-In (kommt mit Versand)
- Bulk-Aktionen für Events
- Sortierung der Events nach Custom-Kriterien

---

## 14. Offene Fragen

Keine — alle wesentlichen Punkte im Brainstorming geklärt.

---

## 15. Nächster Schritt

Diese Spec wird mit dem **writing-plans** Skill in einen ausführbaren Plan überführt. Der Plan deckt die fünf Phasen (A–E) aus Abschnitt 12 ab, mit klaren Akzeptanzkriterien pro Phase und Rollback-Pfad.
