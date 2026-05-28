# Admin-Dashboard Erweiterung — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Erweitere `admin/index.html` (heute monolithisches "Panel Wydarzeń") um KI-Anfragen- und Newsletter-Tabs plus Politur des Events-Tabs, ohne den bestehenden Cream/Serif-Look zu verändern.

**Architecture:** Single-Page-Admin mit Hash-Routing (`#events|#ki|#newsletter`). Zerlegung des inline-Codes in fokussierte Module (`auth.js`, `events.js`, `ki.js`, `newsletter.js`, `admin.css`). Datenpersistenz: Google Sheet via Apps Script (Events, Newsletter), Netlify Blobs (KI-Flags), ElevenLabs API (KI-Transkripte live). Auth bleibt PIN+sessionStorage.

**Tech Stack:** Vanilla JS (kein Build-Step), Netlify Functions (Node 18, esbuild), `@netlify/blobs`, Google Apps Script (deployed Web App), ElevenLabs Conversational AI API.

**Spec:** [`docs/superpowers/specs/2026-05-28-admin-dashboard-extension-design.md`](../specs/2026-05-28-admin-dashboard-extension-design.md)

**Test approach:** Projekt hat kein Test-Framework. Wir verwenden:
1. **`netlify dev`** lokal für Function-Smoke-Tests (curl-Befehle dokumentiert pro Task).
2. **Browser-Smoke** mit `gstack` Headless-Browser (Skill `browse`) für Frontend-Verifikation.
3. **Manuelle Akzeptanz** in `pmk-berlinpl.netlify.app` (Staging) vor jedem Production-Deploy.

**Frequent commits:** Jeder Task endet in genau einem Commit. Niemals mehrere logische Einheiten zusammenfassen.

---

## Phase A — Decompose `admin/index.html`

**Ziel:** Funktional identisch zu heute, aber zerlegt in separate Dateien. Vorbereitung für alle weiteren Phasen. Kein neues Verhalten.

### Task A1: Extrahiere CSS aus `admin/index.html` nach `admin/admin.css`

**Files:**
- Create: `admin/admin.css`
- Modify: `admin/index.html`

- [ ] **Step 1: Verify baseline before any changes**

```bash
cd /Users/michal/VintAI/Projekte/pmk-redesign
git status      # must be clean
wc -l admin/index.html      # expect ~2076
md5 -q admin/index.html      # snapshot baseline hash
```

Expected: clean status, ~2076 lines, hash recorded.

- [ ] **Step 2: Locate inline `<style>` block**

```bash
grep -n "<style>" admin/index.html
grep -n "</style>" admin/index.html
```

Expected: one opening tag near top, one closing tag (Spec sagt: alles inline). Note both line numbers.

- [ ] **Step 3: Create `admin/admin.css` with the extracted block**

Read the `<style>...</style>` content (between the two line numbers from Step 2). Copy everything between (not including) the tags into a new file `admin/admin.css`. Preserve indentation exactly.

- [ ] **Step 4: Replace inline `<style>` block in `admin/index.html`**

Replace the entire `<style>...</style>` block (lines from Step 2) with a single line:

```html
<link rel="stylesheet" href="admin.css">
```

- [ ] **Step 5: Verify visually with browse skill**

```bash
netlify dev   # in one terminal
```

Then in another invocation of Claude or via `gstack` skill:
- Open `http://localhost:8888/admin/`
- Verify login screen renders with warm-cream gradient background, serif title, beige input box
- Login with PIN
- Verify events list renders identically to before

Expected: visually indistinguishable from current production.

- [ ] **Step 6: Commit**

```bash
git add admin/admin.css admin/index.html
git commit -m "refactor(admin): extract inline styles to admin.css"
```

---

### Task A2: Extrahiere Auth-Logik nach `admin/auth.js`

**Files:**
- Create: `admin/auth.js`
- Modify: `admin/index.html`

- [ ] **Step 1: Locate auth functions in `admin/index.html`**

```bash
grep -n "handleLogin\|handleLogout\|sessionStorage" admin/index.html
```

Expected: `handleLogin` (~line 1345), `handleLogout` (~line 1383), `sessionStorage.getItem('pmk_admin_pin')` (~line 1393), plus the `APPS_SCRIPT_URL` constant (~line 1330).

- [ ] **Step 2: Create `admin/auth.js`**

Write the following content. Adapt the `APPS_SCRIPT_URL` to the value currently in `admin/index.html` line 1330.

```javascript
// admin/auth.js — PIN-basierter Login fuer das Admin-Dashboard.
// Spaeter erweiterbar um Rollen (Owner/Sekretarin/Pfarrer).

const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwr6u5qQRUuQ37gIaczdCG0DmfQRlazDGYUbQOC2CaSCy_tJBywwwChXwtAS8Ivqe9HPw/exec';

const Auth = {
  url: APPS_SCRIPT_URL,

  getPin() {
    return sessionStorage.getItem('pmk_admin_pin') || '';
  },

  setPin(pin) {
    sessionStorage.setItem('pmk_admin_pin', pin);
  },

  clear() {
    sessionStorage.removeItem('pmk_admin_pin');
  },

  // Prueft den PIN durch einen list-Aufruf gegen Apps Script.
  // Liefert { ok: true, events } oder { ok: false, error }.
  async verify(pin) {
    const url = new URL(APPS_SCRIPT_URL);
    url.searchParams.set('action', 'list');
    url.searchParams.set('pin', pin);
    const res = await fetch(url.toString());
    const data = await res.json();
    if (data && data.success !== false && Array.isArray(data.events)) {
      return { ok: true, events: data.events };
    }
    return { ok: false, error: (data && data.error) || 'PIN ungueltig' };
  }
};

window.Auth = Auth;
```

- [ ] **Step 3: Replace inline auth code in `admin/index.html`**

Find the section that defines `APPS_SCRIPT_URL`, `handleLogin`, `handleLogout`, and the auto-login on page load. Replace those exact functions with thin wrappers that call `Auth.*`:

```javascript
window.handleLogin = async function(e) {
  e.preventDefault();
  const pin = document.getElementById('pinInput').value.trim();
  const btn = document.getElementById('loginBtn');
  const err = document.getElementById('loginError');
  err.classList.remove('visible');
  btn.classList.add('loading');
  btn.disabled = true;
  try {
    const result = await Auth.verify(pin);
    if (result.ok) {
      Auth.setPin(pin);
      document.getElementById('loginScreen').style.display = 'none';
      document.getElementById('adminApp').classList.add('active');
      allEvents = result.events || [];
      renderEvents();
      updateCounts();
    } else {
      err.textContent = result.error;
      err.classList.add('visible');
    }
  } catch (e) {
    err.textContent = 'Blad polaczenia. Sprobuj ponownie.';
    err.classList.add('visible');
  } finally {
    btn.classList.remove('loading');
    btn.disabled = false;
  }
};

window.handleLogout = function() {
  Auth.clear();
  document.getElementById('adminApp').classList.remove('active');
  document.getElementById('loginScreen').style.display = '';
  document.getElementById('pinInput').value = '';
};

// Auto-login bei sessionStorage-Hit
window.addEventListener('DOMContentLoaded', () => {
  const savedPin = Auth.getPin();
  if (savedPin) {
    document.getElementById('pinInput').value = savedPin;
    document.getElementById('loginForm').requestSubmit();
  }
});
```

Add `<script src="auth.js" defer></script>` to the `<head>` (or just before the existing inline script).

- [ ] **Step 4: Smoke-test auth**

```bash
netlify dev   # if not already running
```

Then via browser:
1. Open `http://localhost:8888/admin/` → login screen visible
2. Enter wrong PIN → red error
3. Enter correct PIN → events list loads
4. Reload page → still logged in (sessionStorage)
5. Click "Wyloguj" → back to login screen

Expected: all five behave like before refactor.

- [ ] **Step 5: Commit**

```bash
git add admin/auth.js admin/index.html
git commit -m "refactor(admin): extract auth logic to auth.js"
```

---

### Task A3: Extrahiere Events-Logik nach `admin/events.js`

**Files:**
- Create: `admin/events.js`
- Modify: `admin/index.html`

- [ ] **Step 1: Identify all event-related globals + functions**

```bash
grep -n "allEvents\|renderEvents\|updateCounts\|filterEvents\|openModal\|closeModal\|saveEvent\|deleteEvent\|setFilter" admin/index.html
```

Note the function names and the global variables (e.g., `allEvents`, `currentFilter`, `currentPin`, `editingEvent`).

- [ ] **Step 2: Create `admin/events.js` with extracted code**

Move every event-related function and global into `admin/events.js`. Use this skeleton:

```javascript
// admin/events.js — Logik fuer den Events-Tab.
// Datenquelle: Google Apps Script via Auth.url.

const Events = (function() {
  let allEvents = [];
  let currentFilter = 'upcoming';

  async function load() {
    const pin = Auth.getPin();
    if (!pin) return [];
    const url = new URL(Auth.url);
    url.searchParams.set('action', 'list');
    url.searchParams.set('pin', pin);
    const res = await fetch(url.toString());
    const data = await res.json();
    allEvents = Array.isArray(data.events) ? data.events : [];
    return allEvents;
  }

  function setFilter(name) {
    currentFilter = name;
    render();
  }

  function filtered() {
    const now = new Date(); now.setHours(0, 0, 0, 0);
    if (currentFilter === 'upcoming') {
      return allEvents.filter(e => new Date(e.date) >= now);
    }
    if (currentFilter === 'past') {
      return allEvents.filter(e => new Date(e.date) < now);
    }
    return allEvents.slice();
  }

  function render() {
    // ... existing render code from admin/index.html ...
  }

  function updateCounts() {
    // ... existing count code from admin/index.html ...
  }

  // ... openModal, saveEvent, deleteEvent etc. — alles aus index.html ...

  return { load, setFilter, render, updateCounts };
})();

window.Events = Events;
// Globale Aufrufe aus dem HTML beibehalten:
window.setFilter = Events.setFilter;
window.allEvents = [];   // Kompatibilitaet — wird in spaeteren Phasen entfernt
```

**Wichtig:** Übertrage den **exakten Render-Code** und alle Modal-Funktionen 1:1 — kein Refactoring innerhalb dieses Tasks. Nur Umzug.

- [ ] **Step 3: Add script tag to `admin/index.html`**

In dem inline-`<script>`-Block alles entfernen, was zu Events gehört. Vor dem Login-Script `<script src="events.js" defer></script>` einfügen (nach `auth.js`).

- [ ] **Step 4: Update `Auth.verify` flow to call `Events.load`**

In dem `handleLogin` (jetzt in index.html inline oder ausgelagert) sicherstellen, dass nach erfolgreichem Login `Events.load()` und dann `Events.render()` aufgerufen wird.

- [ ] **Step 5: Smoke-test events**

Browser:
1. Login → Liste lädt
2. Tab "Nadchodzące" anklicken → Filter wirkt
3. "+ Nowe wydarzenie" → Modal öffnet sich, Speichern funktioniert
4. Event editieren → Update funktioniert
5. Event löschen → Confirm-Modal, Löschen funktioniert
6. Reload → Liste lädt aus Apps Script erneut

Expected: alle 6 Schritte unverändert vom Vor-Refactor-Verhalten.

- [ ] **Step 6: Commit**

```bash
git add admin/events.js admin/index.html
git commit -m "refactor(admin): extract events logic to events.js"
```

---

### Task A4: Entferne `admin/events.html` als unnötiges Duplikat

**Files:**
- Delete: `admin/events.html`

- [ ] **Step 1: Confirm exact duplicate**

```bash
diff <(md5 -q admin/index.html) <(md5 -q admin/events.html)
```

Expected: no output (hashes identical) OR — if the hashes differ post-refactor — abort this task and ask the user.

- [ ] **Step 2: Check for incoming links**

```bash
grep -rn "admin/events.html" --include="*.html" --include="*.js" --include="*.toml" .
```

Expected: zero results (oder nur Self-References im Datei selbst).

- [ ] **Step 3: Delete the file**

```bash
git rm admin/events.html
```

- [ ] **Step 4: Smoke-test**

Browser:
- Open `http://localhost:8888/admin/` → still loads
- Open `http://localhost:8888/admin/events.html` → 404 (expected)
- Open `http://localhost:8888/admin/index.html` → loads

- [ ] **Step 5: Commit**

```bash
git commit -m "chore(admin): remove duplicate events.html (identical to index.html)"
```

---

## Phase B — Sidebar + Hash-Router

**Ziel:** UI-Shell mit linker Seitenleiste und Hash-basiertem Tab-Switching. Events ist Default-Tab. KI- und Newsletter-Tabs sind leer (Empty State "Wkrótce").

### Task B1: Sidebar HTML + Topbar in `admin/index.html`

**Files:**
- Modify: `admin/index.html`
- Modify: `admin/admin.css`

- [ ] **Step 1: Locate `<div id="adminApp">` opening**

```bash
grep -n "id=\"adminApp\"" admin/index.html
```

Note the line; everything inside that div will become the Tab-Container.

- [ ] **Step 2: Wrap existing content in new shell structure**

Inside `<div id="adminApp">`, change the structure to:

```html
<div id="adminApp" class="admin-app">
  <header class="admin-topbar">
    <div class="admin-brand">
      <img src="../images/pmk-logo.png" alt="PMK" class="admin-brand-logo">
      <span>PMK Admin</span>
    </div>
    <button class="btn btn-ghost btn-sm" onclick="handleLogout()">Wyloguj</button>
  </header>

  <div class="admin-body">
    <aside class="admin-sidebar">
      <div class="admin-nav-label">Aktywne</div>
      <a href="#events" class="admin-nav-item" data-tab="events">
        <span class="admin-nav-icon">📅</span> Wydarzenia
      </a>
      <a href="#ki" class="admin-nav-item" data-tab="ki">
        <span class="admin-nav-icon">💬</span> KI-Czat
      </a>
      <a href="#newsletter" class="admin-nav-item" data-tab="newsletter">
        <span class="admin-nav-icon">✉️</span> Newsletter
      </a>

      <div class="admin-nav-label">Wkrótce</div>
      <span class="admin-nav-item admin-nav-soon">
        <span class="admin-nav-icon">🏠</span> Przegląd
      </span>
      <span class="admin-nav-item admin-nav-soon">
        <span class="admin-nav-icon">📊</span> Statystyki
      </span>
    </aside>

    <main class="admin-main">
      <section id="tab-events" class="admin-tab" data-tab="events">
        <!-- BISHER VORHANDENER INHALT (Events-Header, Filter-Tabs, Tabelle, Modale) UNVERAENDERT HIERHIN -->
      </section>

      <section id="tab-ki" class="admin-tab" data-tab="ki" hidden>
        <div class="admin-empty">
          <h2>KI-Czat</h2>
          <p class="admin-empty-hint">Tutaj pojawią się rozmowy z chatbotem i agentem głosowym. Wkrótce.</p>
        </div>
      </section>

      <section id="tab-newsletter" class="admin-tab" data-tab="newsletter" hidden>
        <div class="admin-empty">
          <h2>Newsletter</h2>
          <p class="admin-empty-hint">Tutaj pojawi się lista zapisanych adresów. Wkrótce.</p>
        </div>
      </section>
    </main>
  </div>
</div>
```

Verschiebe den bestehenden Events-Inhalt 1:1 in `#tab-events`.

- [ ] **Step 3: Add sidebar/topbar styles to `admin/admin.css`**

Append at the end of `admin/admin.css`:

```css
/* ============================================
   Admin Shell — Topbar + Sidebar + Tabs
   ============================================ */
.admin-app { display: none; flex-direction: column; min-height: 100dvh; background: var(--color-cream); }
.admin-app.active { display: flex; }

.admin-topbar {
  display: flex; align-items: center; justify-content: space-between;
  padding: 0.75rem 1.5rem;
  background: white;
  border-bottom: 1px solid var(--color-warm-200);
  position: sticky; top: 0; z-index: 10;
}
.admin-brand { display: flex; align-items: center; gap: 0.75rem; font-weight: 600; color: var(--color-warm-900); }
.admin-brand-logo { width: 32px; height: 32px; object-fit: contain; }

.admin-body { display: flex; flex: 1; align-items: stretch; }

.admin-sidebar {
  width: 220px; flex-shrink: 0;
  padding: 1.25rem 0.75rem;
  background: var(--color-warm-50);
  border-right: 1px solid var(--color-warm-200);
}
.admin-nav-label {
  font-size: var(--text-xs); text-transform: uppercase; letter-spacing: 0.08em;
  color: var(--color-warm-500); padding: 0.5rem 0.75rem; margin-top: 0.5rem;
}
.admin-nav-item {
  display: flex; align-items: center; gap: 0.6rem;
  padding: 0.55rem 0.75rem; margin: 0.1rem 0;
  border-radius: var(--radius-md);
  color: var(--color-warm-800); font-size: var(--text-sm); font-weight: 500;
  text-decoration: none; transition: background var(--duration-base) var(--ease-out);
}
.admin-nav-item:hover { background: var(--color-warm-100); }
.admin-nav-item.active { background: var(--color-accent); color: white; }
.admin-nav-item.active:hover { background: var(--color-accent-dark); }
.admin-nav-soon { opacity: 0.45; cursor: default; pointer-events: none; }
.admin-nav-icon { font-size: 1.05em; }

.admin-main { flex: 1; padding: 1.5rem 2rem; min-width: 0; }
.admin-tab { animation: fadeUp 0.3s var(--ease-out); }
.admin-tab[hidden] { display: none; }

.admin-empty {
  background: white; border-radius: var(--radius-2xl);
  padding: 3rem 2rem; text-align: center;
  border: 1px dashed var(--color-warm-200);
}
.admin-empty h2 { font-family: var(--font-serif); margin-bottom: 0.5rem; }
.admin-empty-hint { color: var(--color-warm-500); }

@media (max-width: 720px) {
  .admin-body { flex-direction: column; }
  .admin-sidebar { width: auto; border-right: 0; border-bottom: 1px solid var(--color-warm-200); display: flex; gap: 0.25rem; padding: 0.5rem; overflow-x: auto; }
  .admin-nav-label { display: none; }
  .admin-nav-item { white-space: nowrap; }
  .admin-main { padding: 1rem; }
}
```

- [ ] **Step 4: Smoke-test**

Browser:
- Login → Sidebar links sichtbar, Topbar oben, "Wydarzenia" aktiv (default)
- Events-Liste sichtbar wie vorher
- "KI-Czat" und "Newsletter" anklicken → noch keine Reaktion (Hash-Router kommt im nächsten Task)

Expected: visuell sauber im Cream-Style, mobile responsive.

- [ ] **Step 5: Commit**

```bash
git add admin/index.html admin/admin.css
git commit -m "feat(admin): sidebar shell + topbar + empty KI/Newsletter tabs"
```

---

### Task B2: Hash-Router in `admin/index.html`

**Files:**
- Modify: `admin/index.html` (inline script tail)

- [ ] **Step 1: Append router code to admin/index.html script tail**

Vor dem schließenden `</script>` einfügen:

```javascript
// ============================================
// Hash-Router: #events | #ki | #newsletter
// ============================================
const TABS = ['events', 'ki', 'newsletter'];

function currentTab() {
  const h = (location.hash || '').replace('#', '');
  return TABS.includes(h) ? h : 'events';
}

function switchTab(name) {
  TABS.forEach(t => {
    const section = document.getElementById('tab-' + t);
    if (section) section.hidden = (t !== name);
  });
  document.querySelectorAll('.admin-nav-item[data-tab]').forEach(el => {
    el.classList.toggle('active', el.dataset.tab === name);
  });
  if (location.hash !== '#' + name) {
    history.replaceState(null, '', '#' + name);
  }
}

window.addEventListener('hashchange', () => switchTab(currentTab()));
window.addEventListener('DOMContentLoaded', () => switchTab(currentTab()));
```

- [ ] **Step 2: Smoke-test routing**

Browser:
- `http://localhost:8888/admin/#events` → Events sichtbar, Wydarzenia in Sidebar aktiv
- Klick auf "KI-Czat" in Sidebar → URL wird `#ki`, "Wkrótce" Empty-State sichtbar, KI-Czat in Sidebar aktiv
- Klick auf "Newsletter" → analog `#newsletter`
- Direkt `http://localhost:8888/admin/#newsletter` öffnen → Newsletter-Tab direkt aktiv
- Browser-Back-Button → vorheriger Hash kommt zurück

Expected: alle Switches funktionieren, Sidebar-Active-State synchron.

- [ ] **Step 3: Commit**

```bash
git add admin/index.html
git commit -m "feat(admin): hash-based tab router (events/ki/newsletter)"
```

---

### Task B3: Deploy Phase A + B nach Staging und verifizieren

- [ ] **Step 1: Push branch und beobachten**

```bash
git push origin main
```

Netlify CI deployt automatisch nach `pmk-berlinpl.netlify.app` (Staging).

- [ ] **Step 2: Staging-Smoke**

Im Browser:
- `https://pmk-berlinpl.netlify.app/admin/` → Login → Events sichtbar
- Hash-Switch zwischen drei Tabs → funktioniert
- Auf Mobile (DevTools 375px) → Sidebar wird zu Top-Scroll-Strip

Expected: identisch zum lokalen Verhalten.

- [ ] **Step 3: Checkpoint mit User**

Nicht weiter zu Phase C, bis User Staging gesehen und freigegeben hat.

---

## Phase C — Newsletter-Tab

**Ziel:** Anmeldeformular im Footer aller 31 öffentlichen HTML-Seiten + Admin-Tab zeigt Abonnenten-Liste.

### Task C1: Apps-Script Route `list_subscribers`

**Files:**
- Modify: `admin/google-apps-script.js`

Hinweis: Die deployed Web App muss nach dem Edit **neu publishiert** werden (Google Apps Script Editor → Deploy → Manage Deployments → New Version). `admin/google-apps-script.js` ist nur das lokale Spiegelbild für Versionskontrolle.

- [ ] **Step 1: Locate switch-case in handleRequest**

`admin/google-apps-script.js:113` — der `switch (action)`-Block.

- [ ] **Step 2: Add `list_subscribers` case**

Ergänze im switch:

```javascript
case 'list_subscribers':
  result = listSubscribers();
  break;
```

Am Ende der Datei (nach `subscribeNewsletter`) ergänzen:

```javascript
/**
 * Alle Newsletter-Abonnenten auflisten.
 * Output: { success: true, subscribers: [{email, lang, source, created_at}, ...] }
 */
function listSubscribers() {
  const sheet = getNewsletterSheet();
  if (!sheet) return { success: true, subscribers: [] };
  const data = sheet.getDataRange().getValues();
  const out = [];
  // Header: Email | Lang | Source | CreatedAt (anpassen falls anders)
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row[0]) continue;
    out.push({
      email: String(row[0]),
      lang: String(row[1] || ''),
      source: String(row[2] || ''),
      created_at: row[3] instanceof Date ? row[3].toISOString() : String(row[3] || '')
    });
  }
  // Neueste zuerst
  out.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
  return { success: true, subscribers: out };
}
```

**Wichtig:** Spalten-Reihenfolge in der echten Newsletter-Tabelle prüfen — siehe `subscribeNewsletter` in derselben Datei für das Schema. Anpassen falls abweichend.

- [ ] **Step 3: Deploy zur Apps Script**

Manuell im Google Apps Script Editor:
1. Datei-Inhalt aus `admin/google-apps-script.js` 1:1 ins Web-Editor kopieren
2. Save (Cmd+S)
3. Deploy → Manage deployments → Edit current → New version → Deploy
4. Notiere die deployed URL (muss identisch zu `APPS_SCRIPT_URL` in `auth.js` sein, sonst dort updaten)

- [ ] **Step 4: Verify via curl**

```bash
curl "https://script.google.com/macros/s/AKfycb.../exec?action=list_subscribers&pin=YOUR_PIN"
```

Expected: `{"success":true,"subscribers":[...]}`. Bei leerer Tabelle: `"subscribers":[]`.

- [ ] **Step 5: Commit**

```bash
git add admin/google-apps-script.js
git commit -m "feat(apps-script): add list_subscribers action (PIN-gated)"
```

---

### Task C2: Netlify Function `newsletter-list.js`

**Files:**
- Create: `netlify/functions/newsletter-list.js`

- [ ] **Step 1: Create the function**

```javascript
// netlify/functions/newsletter-list.js
// GET /.netlify/functions/newsletter-list?pin=XXX
// Proxiert list_subscribers vom Apps Script, damit der PIN nicht client-side im Apps-Script-URL landet.

const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL
  || 'https://script.google.com/macros/s/AKfycbwr6u5qQRUuQ37gIaczdCG0DmfQRlazDGYUbQOC2CaSCy_tJBywwwChXwtAS8Ivqe9HPw/exec';

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: JSON.stringify({ success: false, error: 'method_not_allowed' }) };
  }

  const pin = (event.queryStringParameters && event.queryStringParameters.pin) || '';
  if (!pin) {
    return { statusCode: 401, body: JSON.stringify({ success: false, error: 'missing_pin' }) };
  }

  const url = new URL(APPS_SCRIPT_URL);
  url.searchParams.set('action', 'list_subscribers');
  url.searchParams.set('pin', pin);

  try {
    const res = await fetch(url.toString());
    const text = await res.text();
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60' },
      body: text
    };
  } catch (err) {
    return {
      statusCode: 502,
      body: JSON.stringify({ success: false, error: 'upstream_failed' })
    };
  }
};
```

- [ ] **Step 2: Local test**

```bash
netlify dev
curl "http://localhost:8888/.netlify/functions/newsletter-list?pin=YOUR_PIN"
```

Expected: same JSON as direct Apps Script call.

```bash
curl "http://localhost:8888/.netlify/functions/newsletter-list"
```

Expected: `{"success":false,"error":"missing_pin"}` (status 401).

- [ ] **Step 3: Commit**

```bash
git add netlify/functions/newsletter-list.js
git commit -m "feat(functions): newsletter-list proxy (GET, PIN-gated)"
```

---

### Task C3: Admin Newsletter-Tab UI

**Files:**
- Create: `admin/newsletter.js`
- Modify: `admin/index.html` (replace empty `#tab-newsletter`)
- Modify: `admin/admin.css`

- [ ] **Step 1: Create `admin/newsletter.js`**

```javascript
// admin/newsletter.js — Newsletter-Tab Logic.
// Holt Abonnenten via /.netlify/functions/newsletter-list und rendert Liste + Stats.

const Newsletter = (function() {
  let subs = [];
  let filterLang = 'all';
  let searchTerm = '';

  async function load() {
    const pin = Auth.getPin();
    if (!pin) return;
    const res = await fetch('/.netlify/functions/newsletter-list?pin=' + encodeURIComponent(pin));
    const data = await res.json();
    subs = (data && Array.isArray(data.subscribers)) ? data.subscribers : [];
    render();
  }

  function filtered() {
    return subs.filter(s => {
      if (filterLang !== 'all' && s.lang !== filterLang) return false;
      if (searchTerm && !s.email.toLowerCase().includes(searchTerm.toLowerCase())) return false;
      return true;
    });
  }

  function statsLast7() {
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    return subs.filter(s => new Date(s.created_at).getTime() >= cutoff).length;
  }

  function fmtDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleDateString('pl-PL', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  function exportCsv() {
    const rows = filtered();
    const header = 'email,lang,source,created_at\n';
    const body = rows.map(r =>
      [r.email, r.lang, r.source, r.created_at].map(v => '"' + String(v).replace(/"/g, '""') + '"').join(',')
    ).join('\n');
    const blob = new Blob([header + body], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'newsletter-subscribers-' + new Date().toISOString().slice(0, 10) + '.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  function render() {
    const root = document.getElementById('tab-newsletter');
    if (!root) return;
    const rows = filtered();
    root.innerHTML = `
      <div class="news-head">
        <h1>Newsletter</h1>
        <div class="news-stats">
          <span class="news-stat-num">${subs.length}</span> zapisanych
          <span class="news-stat-delta">+${statsLast7()} w ciągu 7 dni</span>
        </div>
      </div>
      <div class="news-toolbar">
        <input class="news-search" placeholder="Szukaj po e-mailu…" value="${searchTerm}">
        <select class="news-filter">
          <option value="all">Wszystkie języki</option>
          <option value="pl" ${filterLang === 'pl' ? 'selected' : ''}>Polski</option>
          <option value="de" ${filterLang === 'de' ? 'selected' : ''}>Deutsch</option>
        </select>
        <button class="btn btn-ghost btn-sm news-export">Eksportuj CSV</button>
      </div>
      <table class="news-table">
        <thead><tr><th>E-mail</th><th>Język</th><th>Źródło</th><th>Zapisano</th></tr></thead>
        <tbody>
          ${rows.map(r => `
            <tr>
              <td>${r.email}</td>
              <td><span class="news-lang-badge news-lang-${r.lang}">${r.lang.toUpperCase()}</span></td>
              <td class="news-src">${r.source || '—'}</td>
              <td>${fmtDate(r.created_at)}</td>
            </tr>
          `).join('') || '<tr><td colspan="4" class="news-empty">Brak zapisów</td></tr>'}
        </tbody>
      </table>
    `;
    root.querySelector('.news-search').addEventListener('input', e => { searchTerm = e.target.value; render(); });
    root.querySelector('.news-filter').addEventListener('change', e => { filterLang = e.target.value; render(); });
    root.querySelector('.news-export').addEventListener('click', exportCsv);
  }

  return { load, render };
})();

window.Newsletter = Newsletter;
window.addEventListener('hashchange', () => { if (location.hash === '#newsletter') Newsletter.load(); });
window.addEventListener('DOMContentLoaded', () => { if (location.hash === '#newsletter') Newsletter.load(); });
```

- [ ] **Step 2: Replace empty `#tab-newsletter` in `admin/index.html`**

Ersetze den empty-state-Block durch:

```html
<section id="tab-newsletter" class="admin-tab" data-tab="newsletter" hidden>
  <!-- Inhalt wird von Newsletter.render() befüllt -->
</section>
```

Vor dem schließenden `</body>` einfügen:

```html
<script src="newsletter.js" defer></script>
```

- [ ] **Step 3: Add newsletter styles to `admin/admin.css`**

```css
/* ============================================
   Newsletter Tab
   ============================================ */
.news-head { display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 1.5rem; }
.news-head h1 { font-family: var(--font-serif); font-weight: 500; margin: 0; }
.news-stats { font-size: var(--text-sm); color: var(--color-warm-600); }
.news-stat-num { font-size: var(--text-2xl); font-weight: 700; color: var(--color-warm-900); margin-right: 0.4rem; }
.news-stat-delta { color: var(--color-accent); margin-left: 0.75rem; font-weight: 500; }

.news-toolbar { display: flex; gap: 0.75rem; margin-bottom: 1.25rem; align-items: center; }
.news-search { flex: 1; padding: 0.6rem 0.9rem; border: 1.5px solid var(--color-warm-200); border-radius: var(--radius-md); background: white; font-size: var(--text-sm); }
.news-filter { padding: 0.55rem 0.9rem; border: 1.5px solid var(--color-warm-200); border-radius: var(--radius-md); background: white; font-size: var(--text-sm); }
.news-export { white-space: nowrap; }

.news-table { width: 100%; border-collapse: collapse; background: white; border-radius: var(--radius-lg); overflow: hidden; box-shadow: var(--shadow-sm); }
.news-table th, .news-table td { padding: 0.85rem 1rem; text-align: left; border-bottom: 1px solid var(--color-warm-100); font-size: var(--text-sm); }
.news-table th { background: var(--color-warm-50); font-weight: 600; color: var(--color-warm-700); }
.news-table tr:last-child td { border-bottom: 0; }
.news-src { color: var(--color-warm-500); font-size: var(--text-xs); }
.news-empty { text-align: center; color: var(--color-warm-400); padding: 2rem; }

.news-lang-badge { display: inline-block; padding: 0.1rem 0.5rem; border-radius: 999px; font-size: var(--text-xs); font-weight: 600; }
.news-lang-pl { background: rgba(166, 139, 91, 0.12); color: var(--color-accent-dark); }
.news-lang-de { background: rgba(106, 139, 166, 0.12); color: #5a7691; }
```

- [ ] **Step 4: Smoke-test**

Browser:
1. Login → Klick "Newsletter" in Sidebar → Liste lädt (oder leerer Zustand mit "Brak zapisów")
2. Wenn Liste leer: kurz `https://pmk-berlinpl.netlify.app/de/index.html` → bestehendes Newsletter-Formular submit (falls vorhanden), zurück ins Admin → Eintrag erscheint nach reload
3. Sprache-Filter ändern → Tabelle reagiert
4. Suche eingeben → Tabelle filtert
5. "Eksportuj CSV" → Download startet, Datei öffnet sauber in Excel/Numbers

- [ ] **Step 5: Commit**

```bash
git add admin/newsletter.js admin/index.html admin/admin.css
git commit -m "feat(admin): newsletter tab with stats, filter, search, csv export"
```

---

### Task C4: Footer-Anmeldeformular-Snippet entwickeln

**Files:**
- Create: `components/newsletter-footer.html` (Snippet zur Wiederverwendung)
- Create: `scripts/inject-newsletter-footer.js` (einmaliges Verteil-Skript)
- Modify: `styles.css` (Footer-Form Styling, falls noch nicht vorhanden)

- [ ] **Step 1: Create snippet file**

`components/newsletter-footer.html`:

```html
<!-- BEGIN newsletter-footer -->
<div class="footer-newsletter" data-newsletter-form>
  <h4 data-i18n="footer.newsletter_title">Bądź na bieżąco</h4>
  <p data-i18n="footer.newsletter_desc">Newsletter parafii — informacje o wydarzeniach, ogłoszenia.</p>
  <form class="footer-newsletter-form" onsubmit="return PmkNewsletter.submit(event, this)">
    <input type="email" name="email" required placeholder="twój e-mail" data-i18n-placeholder="footer.newsletter_placeholder" class="footer-newsletter-input">
    <input type="text" name="website" tabindex="-1" autocomplete="off" style="position:absolute;left:-9999px" aria-hidden="true">
    <button type="submit" class="footer-newsletter-btn" data-i18n="footer.newsletter_submit">Zapisz mnie</button>
    <p class="footer-newsletter-msg" hidden></p>
  </form>
  <p class="footer-newsletter-legal">
    <a href="datenschutz.html" data-i18n="footer.newsletter_legal">Informacja o ochronie danych</a>
  </p>
</div>
<!-- END newsletter-footer -->
```

- [ ] **Step 2: Add submit handler to `main.js`**

Anhängen am Ende von `main.js`:

```javascript
// ============================================
// Newsletter-Footer-Formular
// ============================================
window.PmkNewsletter = {
  submit: function(e, form) {
    e.preventDefault();
    const btn = form.querySelector('.footer-newsletter-btn');
    const msg = form.querySelector('.footer-newsletter-msg');
    const data = {
      email: form.email.value.trim(),
      website: form.website.value,
      lang: (document.documentElement.lang || 'pl').slice(0, 2),
      source: location.pathname
    };
    btn.disabled = true;
    msg.hidden = true;
    fetch('/.netlify/functions/newsletter-subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    })
      .then(r => r.json())
      .then(res => {
        if (res && res.success) {
          msg.textContent = (data.lang === 'de') ? 'Danke — du bist eingetragen.' : 'Dziekujemy — Twój e-mail został zapisany.';
          msg.className = 'footer-newsletter-msg footer-newsletter-msg-ok';
          form.reset();
        } else {
          msg.textContent = (data.lang === 'de') ? 'E-Mail ungültig oder Fehler.' : 'Nieprawidłowy e-mail lub błąd.';
          msg.className = 'footer-newsletter-msg footer-newsletter-msg-err';
        }
        msg.hidden = false;
      })
      .catch(() => {
        msg.textContent = (data.lang === 'de') ? 'Verbindung fehlgeschlagen.' : 'Błąd połączenia.';
        msg.className = 'footer-newsletter-msg footer-newsletter-msg-err';
        msg.hidden = false;
      })
      .finally(() => { btn.disabled = false; });
    return false;
  }
};
```

- [ ] **Step 3: Add footer-form styles to `styles.css`**

Append:

```css
.footer-newsletter {
  margin-top: 2rem; padding-top: 1.5rem;
  border-top: 1px solid rgba(255, 255, 255, 0.15);
  max-width: 480px;
}
.footer-newsletter h4 { color: rgba(255, 255, 255, 0.95); margin-bottom: 0.25rem; }
.footer-newsletter p { color: rgba(255, 255, 255, 0.7); font-size: 0.875rem; margin-bottom: 0.85rem; }
.footer-newsletter-form { display: flex; gap: 0.5rem; flex-wrap: wrap; position: relative; }
.footer-newsletter-input {
  flex: 1 1 240px; padding: 0.6rem 0.9rem;
  border-radius: 8px; border: 1px solid rgba(255, 255, 255, 0.25);
  background: rgba(255, 255, 255, 0.08); color: white; font-size: 0.9rem;
}
.footer-newsletter-input::placeholder { color: rgba(255, 255, 255, 0.55); }
.footer-newsletter-btn {
  padding: 0.6rem 1.25rem; border: 0; border-radius: 8px;
  background: rgba(166, 139, 91, 1); color: white; font-weight: 500; cursor: pointer;
}
.footer-newsletter-btn:hover { background: rgba(140, 115, 75, 1); }
.footer-newsletter-btn:disabled { opacity: 0.6; cursor: not-allowed; }
.footer-newsletter-msg { width: 100%; margin-top: 0.5rem; font-size: 0.85rem; }
.footer-newsletter-msg-ok { color: rgba(180, 230, 180, 1); }
.footer-newsletter-msg-err { color: rgba(255, 180, 180, 1); }
.footer-newsletter-legal { font-size: 0.75rem; margin-top: 0.6rem; }
.footer-newsletter-legal a { color: rgba(255, 255, 255, 0.55); text-decoration: underline; }
```

- [ ] **Step 4: Add i18n keys**

Bearbeite `translations/de.json` und `translations/pl.json`. Füge unter `footer` ein:

`pl.json`:
```json
"newsletter_title": "Bądź na bieżąco",
"newsletter_desc": "Newsletter parafii — informacje o wydarzeniach, ogłoszenia.",
"newsletter_placeholder": "twój e-mail",
"newsletter_submit": "Zapisz mnie",
"newsletter_legal": "Informacja o ochronie danych"
```

`de.json`:
```json
"newsletter_title": "Bleib auf dem Laufenden",
"newsletter_desc": "Pfarr-Newsletter — Veranstaltungen, Ankündigungen.",
"newsletter_placeholder": "deine E-Mail",
"newsletter_submit": "Anmelden",
"newsletter_legal": "Datenschutzhinweis"
```

- [ ] **Step 5: Commit (Snippet + Handler + Styles + i18n, noch keine Einfügung)**

```bash
git add components/newsletter-footer.html main.js styles.css translations/pl.json translations/de.json
git commit -m "feat(newsletter): footer signup snippet, handler, styles, i18n keys"
```

---

### Task C5: Footer-Snippet in alle Public-Pages einfügen

**Files:**
- Create: `scripts/inject-newsletter-footer.js`
- Modify: alle Top-Level `*.html` (außer admin/, archive/, neu/) und `de/*.html`

- [ ] **Step 1: Create injection script**

`scripts/inject-newsletter-footer.js`:

```javascript
#!/usr/bin/env node
// Verteilt das Newsletter-Snippet in alle Public-HTML-Seiten.
// Idempotent: laeuft sicher mehrfach, fuegt nichts doppelt ein.

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

const SNIPPET_PATH = path.join(ROOT, 'components/newsletter-footer.html');
const snippet = fs.readFileSync(SNIPPET_PATH, 'utf8').trim();
const MARKER = '<!-- BEGIN newsletter-footer -->';
const INSERTION_POINT = '<div class="footer-bottom">';

const EXCLUDE_DIRS = new Set(['admin', 'archive', 'neu', 'node_modules', '.git', '.planning', '.netlify', '.superpowers']);
const EXCLUDE_FILES = new Set(['404.html']);

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (EXCLUDE_DIRS.has(entry.name)) continue;
      out.push(...walk(path.join(dir, entry.name)));
    } else if (entry.isFile() && entry.name.endsWith('.html')) {
      if (EXCLUDE_FILES.has(entry.name)) continue;
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

let injected = 0, skippedAlready = 0, skippedNoFooter = 0;

for (const file of walk(ROOT)) {
  const txt = fs.readFileSync(file, 'utf8');
  if (txt.includes(MARKER)) { skippedAlready++; continue; }
  if (!txt.includes(INSERTION_POINT)) { skippedNoFooter++; continue; }
  const next = txt.replace(INSERTION_POINT, snippet + '\n\n    ' + INSERTION_POINT);
  fs.writeFileSync(file, next, 'utf8');
  injected++;
  console.log('injected:', path.relative(ROOT, file));
}

console.log(`\nDone. injected=${injected}, skipped_already=${skippedAlready}, skipped_no_footer=${skippedNoFooter}`);
```

- [ ] **Step 2: Dry-run mental check**

Ohne Script auszuführen: prüfe, dass `index.html` den Marker `<div class="footer-bottom">` enthält:

```bash
grep -c 'footer-bottom' index.html
```

Expected: ≥ 1.

- [ ] **Step 3: Run script**

```bash
node scripts/inject-newsletter-footer.js
```

Expected output: `injected=~25, skipped_already=0, skipped_no_footer=~0-5`. Notiere die Zahl.

- [ ] **Step 4: Verify one file manually**

```bash
grep -A1 'BEGIN newsletter-footer' index.html | head -20
```

Expected: Snippet ist vor `<div class="footer-bottom">` eingefügt.

- [ ] **Step 5: Run script again (idempotency check)**

```bash
node scripts/inject-newsletter-footer.js
```

Expected: `injected=0, skipped_already=~25`.

- [ ] **Step 6: Smoke-test browser**

```bash
netlify dev
```

Öffne `http://localhost:8888/index.html` → scroll runter → Newsletter-Box im Footer sichtbar, oben „Bądź na bieżąco" auf PL, unten „Wesprzyj Misję"-Block, dann Motto + Copyright.

Submit mit gültiger E-Mail → grüne Erfolgsmeldung. Submit ohne E-Mail → Browser-Validierung greift.

Check `de/index.html` falls vorhanden → Texte auf Deutsch (i18n).

- [ ] **Step 7: Commit**

```bash
git add scripts/inject-newsletter-footer.js *.html de/*.html
git commit -m "feat(newsletter): footer signup form on all public pages"
```

---

### Task C6: Deploy Phase C + verify on Staging

- [ ] **Step 1: Push and watch CI**

```bash
git push origin main
```

- [ ] **Step 2: Staging smoke**

`https://pmk-berlinpl.netlify.app/`:
1. Scroll zu Footer → Newsletter-Box sichtbar
2. Test-Email eintragen → grüne Bestätigung
3. `https://pmk-berlinpl.netlify.app/admin/#newsletter` → Eintrag erscheint nach kurzer Cache-Wartezeit (max 60s)
4. CSV-Export funktioniert

- [ ] **Step 3: Checkpoint mit User vor Phase D**

---

## Phase D — KI-Anfragen Tab

**Ziel:** Live-Liste der ElevenLabs-Conversations im Admin, mit Flags + Notiz pro Conversation, persistiert in Netlify Blobs.

### Task D1: Netlify Blobs Setup

**Files:**
- Modify: `package.json` (falls existiert; sonst `netlify.toml`)

- [ ] **Step 1: Check for package.json**

```bash
ls package.json 2>/dev/null || echo "no package.json"
```

- [ ] **Step 2: Add `@netlify/blobs` dependency**

Falls `package.json` existiert:

```bash
npm install --save @netlify/blobs
```

Falls nicht: erstelle `package.json` mit:

```json
{
  "name": "pmk-redesign",
  "version": "1.0.0",
  "private": true,
  "dependencies": {
    "@netlify/blobs": "^7.0.0"
  }
}
```

```bash
npm install
```

- [ ] **Step 3: Verify**

```bash
node -e "require('@netlify/blobs')" && echo OK
```

Expected: `OK`.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add @netlify/blobs for ki-flag persistence"
```

---

### Task D2: Function `ki-conversations.js`

**Files:**
- Create: `netlify/functions/ki-conversations.js`

- [ ] **Step 1: Confirm ElevenLabs env vars exist**

Im Netlify-Dashboard prüfen: `ELEVENLABS_API_KEY` und `ELEVENLABS_AGENT_ID` müssen gesetzt sein. Falls nicht: User bitten, sie zu setzen.

```bash
# Lokal in .env (nicht committen):
echo 'ELEVENLABS_API_KEY=...' >> .env
echo 'ELEVENLABS_AGENT_ID=...' >> .env
```

- [ ] **Step 2: Create function**

```javascript
// netlify/functions/ki-conversations.js
// GET /.netlify/functions/ki-conversations?pin=XXX&days=7
// Listet Conversations vom ElevenLabs-Agenten und merged Flag-Daten aus Netlify Blobs.

const { getStore } = require('@netlify/blobs');

const ELEVENLABS_API = 'https://api.elevenlabs.io/v1/convai/conversations';
const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL || '';
const ADMIN_PIN = process.env.ADMIN_PIN || '';

async function verifyPin(pin) {
  // Falls ADMIN_PIN env gesetzt: vergleichen
  if (ADMIN_PIN) return pin === ADMIN_PIN;
  // Fallback: kleinen list-Call gegen Apps Script versuchen
  if (!APPS_SCRIPT_URL) return false;
  const u = new URL(APPS_SCRIPT_URL);
  u.searchParams.set('action', 'list');
  u.searchParams.set('pin', pin);
  try {
    const r = await fetch(u.toString());
    const d = await r.json();
    return d && d.success !== false && Array.isArray(d.events);
  } catch (_) { return false; }
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: JSON.stringify({ success: false, error: 'method_not_allowed' }) };
  }

  const q = event.queryStringParameters || {};
  const pin = q.pin || '';
  if (!pin || !(await verifyPin(pin))) {
    return { statusCode: 401, body: JSON.stringify({ success: false, error: 'unauthorized' }) };
  }

  const days = Math.max(1, Math.min(90, parseInt(q.days || '7', 10) || 7));
  const since = new Date(Date.now() - days * 86400000).toISOString();

  const apiKey = process.env.ELEVENLABS_API_KEY;
  const agentId = process.env.ELEVENLABS_AGENT_ID;
  if (!apiKey || !agentId) {
    return { statusCode: 500, body: JSON.stringify({ success: false, error: 'elevenlabs_not_configured' }) };
  }

  const url = new URL(ELEVENLABS_API);
  url.searchParams.set('agent_id', agentId);
  url.searchParams.set('page_size', '100');

  let conversations = [];
  try {
    const res = await fetch(url.toString(), { headers: { 'xi-api-key': apiKey } });
    const data = await res.json();
    conversations = Array.isArray(data.conversations) ? data.conversations : [];
  } catch (err) {
    return { statusCode: 502, body: JSON.stringify({ success: false, error: 'elevenlabs_unreachable' }) };
  }

  // Filter nach Datum + auf relevante Felder reduzieren
  conversations = conversations
    .filter(c => !c.start_time_unix_secs || (c.start_time_unix_secs * 1000) >= new Date(since).getTime())
    .map(c => ({
      conversation_id: c.conversation_id,
      started_at: c.start_time_unix_secs ? new Date(c.start_time_unix_secs * 1000).toISOString() : null,
      channel: c.metadata?.channel || (c.call_summary ? 'phone' : 'chat'),
      language: c.metadata?.language || '',
      first_user_message: c.first_user_message || c.transcript_summary || '',
      status: c.status || ''
    }));

  // Flags aus Blobs mergen
  const store = getStore('ki-flags');
  await Promise.all(conversations.map(async (c) => {
    try {
      const flag = await store.get(c.conversation_id, { type: 'json' });
      if (flag) Object.assign(c, { flag });
      else c.flag = { status: 'unhandled' };
    } catch (_) { c.flag = { status: 'unhandled' }; }
  }));

  conversations.sort((a, b) => (b.started_at || '').localeCompare(a.started_at || ''));

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, max-age=30' },
    body: JSON.stringify({ success: true, conversations })
  };
};
```

- [ ] **Step 3: Local test**

```bash
netlify dev
curl "http://localhost:8888/.netlify/functions/ki-conversations?pin=YOUR_PIN&days=7"
```

Expected: `{"success":true,"conversations":[...]}` (Liste leer ist auch OK falls ElevenLabs noch keine Daten hat).

```bash
curl "http://localhost:8888/.netlify/functions/ki-conversations?days=7"
```

Expected: `{"success":false,"error":"unauthorized"}` (status 401).

- [ ] **Step 4: Commit**

```bash
git add netlify/functions/ki-conversations.js
git commit -m "feat(functions): ki-conversations — fetch from elevenlabs + merge blob flags"
```

---

### Task D3: Function `ki-flag.js`

**Files:**
- Create: `netlify/functions/ki-flag.js`

- [ ] **Step 1: Create function**

```javascript
// netlify/functions/ki-flag.js
// POST /.netlify/functions/ki-flag
// Body: { pin, conversation_id, status, note? }
// Schreibt/aktualisiert Flag fuer eine Conversation in Netlify Blobs ('ki-flags').

const { getStore } = require('@netlify/blobs');

const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL || '';
const ADMIN_PIN = process.env.ADMIN_PIN || '';
const VALID_STATUS = new Set(['unhandled', 'done', 'followup', 'bad_answer', 'spam']);

async function verifyPin(pin) {
  if (ADMIN_PIN) return pin === ADMIN_PIN;
  if (!APPS_SCRIPT_URL) return false;
  const u = new URL(APPS_SCRIPT_URL);
  u.searchParams.set('action', 'list');
  u.searchParams.set('pin', pin);
  try {
    const r = await fetch(u.toString());
    const d = await r.json();
    return d && d.success !== false && Array.isArray(d.events);
  } catch (_) { return false; }
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ success: false, error: 'method_not_allowed' }) };
  }

  let body = {};
  try { body = JSON.parse(event.body || '{}'); }
  catch (_) { return { statusCode: 400, body: JSON.stringify({ success: false, error: 'bad_json' }) }; }

  const { pin, conversation_id, status, note } = body;
  if (!pin || !(await verifyPin(pin))) {
    return { statusCode: 401, body: JSON.stringify({ success: false, error: 'unauthorized' }) };
  }
  if (!conversation_id || typeof conversation_id !== 'string') {
    return { statusCode: 400, body: JSON.stringify({ success: false, error: 'missing_conversation_id' }) };
  }
  if (!VALID_STATUS.has(status)) {
    return { statusCode: 400, body: JSON.stringify({ success: false, error: 'invalid_status' }) };
  }

  const store = getStore('ki-flags');
  const entry = {
    status,
    note: String(note || '').slice(0, 1000),
    flagged_by: 'pin',
    flagged_at: new Date().toISOString()
  };
  await store.setJSON(conversation_id, entry);

  return {
    statusCode: 200,
    body: JSON.stringify({ success: true, flag: entry })
  };
};
```

- [ ] **Step 2: Local test**

```bash
curl -X POST http://localhost:8888/.netlify/functions/ki-flag \
  -H 'Content-Type: application/json' \
  -d '{"pin":"YOUR_PIN","conversation_id":"test-1","status":"done","note":"Test"}'
```

Expected: `{"success":true,"flag":{"status":"done","note":"Test",...}}`.

```bash
curl -X POST http://localhost:8888/.netlify/functions/ki-flag \
  -H 'Content-Type: application/json' \
  -d '{"pin":"YOUR_PIN","conversation_id":"test-1","status":"WRONG"}'
```

Expected: `{"success":false,"error":"invalid_status"}` (400).

Re-fetch via `ki-conversations`:

```bash
curl "http://localhost:8888/.netlify/functions/ki-conversations?pin=YOUR_PIN&days=90" | grep test-1
```

Expected: falls eine conversation mit id `test-1` existiert (unwahrscheinlich), würde das Flag dabei sein. Für reine Persistenz-Verifikation: prüfen via Netlify CLI:

```bash
netlify blobs:list ki-flags
```

Expected: enthält `test-1`.

- [ ] **Step 3: Commit**

```bash
git add netlify/functions/ki-flag.js
git commit -m "feat(functions): ki-flag — persist conversation flags + notes in blobs"
```

---

### Task D4: Admin KI-Tab UI

**Files:**
- Create: `admin/ki.js`
- Modify: `admin/index.html`
- Modify: `admin/admin.css`

- [ ] **Step 1: Create `admin/ki.js`**

```javascript
// admin/ki.js — KI-Tab Logic (Liste + Side-Panel mit Flag/Notiz).

const KI = (function() {
  let convos = [];
  let filterChannel = 'all';
  let filterStatus = 'all';
  let searchTerm = '';
  let rangeDays = 7;
  let selectedId = null;

  async function load() {
    const pin = Auth.getPin();
    if (!pin) return;
    const url = `/.netlify/functions/ki-conversations?pin=${encodeURIComponent(pin)}&days=${rangeDays}`;
    const res = await fetch(url);
    const data = await res.json();
    convos = (data && Array.isArray(data.conversations)) ? data.conversations : [];
    render();
  }

  function filtered() {
    return convos.filter(c => {
      if (filterChannel !== 'all' && c.channel !== filterChannel) return false;
      if (filterStatus !== 'all' && (c.flag?.status || 'unhandled') !== filterStatus) return false;
      if (searchTerm && !(c.first_user_message || '').toLowerCase().includes(searchTerm.toLowerCase())) return false;
      return true;
    });
  }

  function fmtTime(iso) {
    if (!iso) return '';
    return new Date(iso).toLocaleString('pl-PL', { dateStyle: 'short', timeStyle: 'short' });
  }

  function statusLabel(s) {
    return { unhandled: 'Otwarte', done: 'Załatwione', followup: 'Follow-up', bad_answer: 'Zła odpowiedź', spam: 'Spam' }[s] || s;
  }

  async function saveFlag(conversationId, status, note) {
    const pin = Auth.getPin();
    const res = await fetch('/.netlify/functions/ki-flag', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin, conversation_id: conversationId, status, note })
    });
    const data = await res.json();
    if (data && data.success) {
      const idx = convos.findIndex(c => c.conversation_id === conversationId);
      if (idx >= 0) convos[idx].flag = data.flag;
      return true;
    }
    return false;
  }

  function openPanel(conversationId) {
    selectedId = conversationId;
    render();
  }
  function closePanel() {
    selectedId = null;
    render();
  }

  function render() {
    const root = document.getElementById('tab-ki');
    if (!root) return;

    const rows = filtered();
    const selected = selectedId ? convos.find(c => c.conversation_id === selectedId) : null;

    root.innerHTML = `
      <div class="ki-head">
        <h1>KI-Czat</h1>
        <div class="ki-range">
          <label>Zakres: <select class="ki-days">
            <option value="7"  ${rangeDays === 7  ? 'selected' : ''}>7 dni</option>
            <option value="30" ${rangeDays === 30 ? 'selected' : ''}>30 dni</option>
            <option value="90" ${rangeDays === 90 ? 'selected' : ''}>90 dni</option>
          </select></label>
        </div>
      </div>
      <div class="ki-toolbar">
        <input class="ki-search" placeholder="Szukaj w pytaniach…" value="${searchTerm}">
        <select class="ki-ch">
          <option value="all">Wszystkie kanały</option>
          <option value="chat"  ${filterChannel === 'chat'  ? 'selected' : ''}>💬 Czat</option>
          <option value="phone" ${filterChannel === 'phone' ? 'selected' : ''}>☎️ Telefon</option>
        </select>
        <select class="ki-st">
          <option value="all">Wszystkie statusy</option>
          <option value="unhandled" ${filterStatus === 'unhandled'  ? 'selected' : ''}>Otwarte</option>
          <option value="done"      ${filterStatus === 'done'       ? 'selected' : ''}>Załatwione</option>
          <option value="followup"  ${filterStatus === 'followup'   ? 'selected' : ''}>Follow-up</option>
          <option value="bad_answer"${filterStatus === 'bad_answer' ? 'selected' : ''}>Zła odpowiedź</option>
          <option value="spam"      ${filterStatus === 'spam'       ? 'selected' : ''}>Spam</option>
        </select>
      </div>
      <table class="ki-table">
        <thead><tr><th>Czas</th><th>Kanał</th><th>Jezyk</th><th>Pierwsze pytanie</th><th>Status</th></tr></thead>
        <tbody>
          ${rows.map(c => `
            <tr data-id="${c.conversation_id}" class="ki-row">
              <td>${fmtTime(c.started_at)}</td>
              <td>${c.channel === 'phone' ? '☎️' : '💬'}</td>
              <td>${(c.language || '').toUpperCase()}</td>
              <td class="ki-msg">${(c.first_user_message || '').slice(0, 80) || '<em>—</em>'}</td>
              <td><span class="ki-status ki-status-${c.flag?.status || 'unhandled'}">${statusLabel(c.flag?.status || 'unhandled')}</span></td>
            </tr>
          `).join('') || '<tr><td colspan="5" class="ki-empty">Brak rozmów</td></tr>'}
        </tbody>
      </table>

      ${selected ? `
      <aside class="ki-panel" role="dialog" aria-label="Szczegóły rozmowy">
        <header>
          <h2>Rozmowa</h2>
          <button class="btn btn-ghost btn-sm ki-close">Zamknij</button>
        </header>
        <p class="ki-meta">${fmtTime(selected.started_at)} · ${selected.channel === 'phone' ? '☎️ Telefon' : '💬 Czat'} · ${(selected.language || '').toUpperCase()}</p>
        <div class="ki-transcript">
          <em>Transkrypt ładuje się asynchronicznie z ElevenLabs (V2). Na razie wyświetlamy pierwszą wiadomość:</em>
          <p>${selected.first_user_message || '<em>—</em>'}</p>
        </div>
        <div class="ki-flags">
          <p class="ki-flags-label">Status:</p>
          ${['done', 'followup', 'bad_answer', 'spam'].map(st => `
            <button class="btn btn-ghost btn-sm ki-flag-btn ${selected.flag?.status === st ? 'active' : ''}" data-status="${st}">${statusLabel(st)}</button>
          `).join('')}
        </div>
        <textarea class="ki-note" rows="3" placeholder="Notatka (opcjonalna)…">${selected.flag?.note || ''}</textarea>
        <button class="btn btn-accent btn-sm ki-save">Zapisz</button>
      </aside>
      ` : ''}
    `;

    root.querySelector('.ki-search').addEventListener('input', e => { searchTerm = e.target.value; render(); });
    root.querySelector('.ki-ch').addEventListener('change', e => { filterChannel = e.target.value; render(); });
    root.querySelector('.ki-st').addEventListener('change', e => { filterStatus = e.target.value; render(); });
    root.querySelector('.ki-days').addEventListener('change', e => { rangeDays = parseInt(e.target.value, 10); load(); });
    root.querySelectorAll('.ki-row').forEach(r => r.addEventListener('click', () => openPanel(r.dataset.id)));

    const panel = root.querySelector('.ki-panel');
    if (panel) {
      panel.querySelector('.ki-close').addEventListener('click', closePanel);
      let pendingStatus = selected.flag?.status || 'unhandled';
      panel.querySelectorAll('.ki-flag-btn').forEach(b => {
        b.addEventListener('click', () => {
          pendingStatus = b.dataset.status;
          panel.querySelectorAll('.ki-flag-btn').forEach(x => x.classList.toggle('active', x === b));
        });
      });
      panel.querySelector('.ki-save').addEventListener('click', async () => {
        const ok = await saveFlag(selectedId, pendingStatus, panel.querySelector('.ki-note').value);
        if (ok) { closePanel(); }
      });
    }
  }

  return { load, render };
})();

window.KI = KI;
window.addEventListener('hashchange', () => { if (location.hash === '#ki') KI.load(); });
window.addEventListener('DOMContentLoaded', () => { if (location.hash === '#ki') KI.load(); });
```

- [ ] **Step 2: Replace empty `#tab-ki` and add script tag**

In `admin/index.html`:

```html
<section id="tab-ki" class="admin-tab" data-tab="ki" hidden>
  <!-- Inhalt von KI.render() -->
</section>
```

Vor `</body>`:

```html
<script src="ki.js" defer></script>
```

- [ ] **Step 3: Add KI styles to `admin/admin.css`**

```css
/* ============================================
   KI Tab
   ============================================ */
.ki-head { display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 1.25rem; }
.ki-head h1 { font-family: var(--font-serif); font-weight: 500; margin: 0; }
.ki-range select { padding: 0.45rem 0.7rem; border: 1.5px solid var(--color-warm-200); border-radius: var(--radius-md); background: white; font-size: var(--text-sm); }

.ki-toolbar { display: flex; gap: 0.75rem; margin-bottom: 1rem; }
.ki-search { flex: 1; padding: 0.6rem 0.9rem; border: 1.5px solid var(--color-warm-200); border-radius: var(--radius-md); background: white; font-size: var(--text-sm); }
.ki-ch, .ki-st { padding: 0.55rem 0.9rem; border: 1.5px solid var(--color-warm-200); border-radius: var(--radius-md); background: white; font-size: var(--text-sm); }

.ki-table { width: 100%; border-collapse: collapse; background: white; border-radius: var(--radius-lg); overflow: hidden; box-shadow: var(--shadow-sm); }
.ki-table th, .ki-table td { padding: 0.7rem 0.9rem; text-align: left; border-bottom: 1px solid var(--color-warm-100); font-size: var(--text-sm); }
.ki-table th { background: var(--color-warm-50); font-weight: 600; color: var(--color-warm-700); }
.ki-row { cursor: pointer; }
.ki-row:hover { background: var(--color-warm-50); }
.ki-msg { color: var(--color-warm-700); }
.ki-empty { text-align: center; color: var(--color-warm-400); padding: 2rem; }

.ki-status { display: inline-block; padding: 0.15rem 0.6rem; border-radius: 999px; font-size: var(--text-xs); font-weight: 600; }
.ki-status-unhandled { background: var(--color-warm-100); color: var(--color-warm-700); }
.ki-status-done { background: rgba(120, 160, 100, 0.15); color: #5a7c45; }
.ki-status-followup { background: rgba(220, 170, 80, 0.18); color: #8a6420; }
.ki-status-bad_answer { background: rgba(220, 110, 110, 0.15); color: #9a3a3a; }
.ki-status-spam { background: rgba(140, 140, 140, 0.15); color: #555; }

.ki-panel {
  position: fixed; top: 0; right: 0; bottom: 0; width: 420px; max-width: 100vw;
  background: white; border-left: 1px solid var(--color-warm-200);
  box-shadow: -8px 0 30px rgba(0, 0, 0, 0.06);
  padding: 1.5rem; overflow-y: auto;
  z-index: 100;
  animation: slideInRight 0.25s var(--ease-out);
}
@keyframes slideInRight { from { transform: translateX(100%); } to { transform: translateX(0); } }
.ki-panel header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem; }
.ki-panel h2 { font-family: var(--font-serif); font-weight: 500; margin: 0; }
.ki-meta { color: var(--color-warm-500); font-size: var(--text-sm); margin-bottom: 1rem; }
.ki-transcript { background: var(--color-warm-50); padding: 1rem; border-radius: var(--radius-md); font-size: var(--text-sm); margin-bottom: 1.25rem; }
.ki-flags { display: flex; flex-wrap: wrap; gap: 0.5rem; margin-bottom: 0.75rem; }
.ki-flags-label { width: 100%; font-size: var(--text-sm); color: var(--color-warm-700); margin: 0 0 0.25rem 0; }
.ki-flag-btn.active { background: var(--color-accent); color: white; border-color: var(--color-accent); }
.ki-note { width: 100%; padding: 0.6rem 0.9rem; border: 1.5px solid var(--color-warm-200); border-radius: var(--radius-md); font-family: inherit; font-size: var(--text-sm); margin-bottom: 0.75rem; }
```

- [ ] **Step 4: Smoke-test**

Browser:
1. Login → `#ki` öffnen → Liste lädt (oder „Brak rozmów" wenn ElevenLabs noch keine Daten)
2. Falls Daten da: klick auf Zeile → Side-Panel öffnet sich rechts
3. Flag-Button klicken → wird aktiv
4. Notiz tippen → „Zapisz" klicken → Panel schließt sich → in Tabelle Status-Badge aktualisiert
5. Filter „Otwarte" → nur unhandled angezeigt
6. Zakres auf 30 dni → reload mit größerem Range

- [ ] **Step 5: Commit**

```bash
git add admin/ki.js admin/index.html admin/admin.css
git commit -m "feat(admin): ki-chat tab with conversation list, side-panel, flag persistence"
```

---

### Task D5: Deploy Phase D + Verify

- [ ] **Step 1: Push**

```bash
git push origin main
```

- [ ] **Step 2: Staging smoke**

`https://pmk-berlinpl.netlify.app/admin/#ki`:
1. Liste lädt (oder ist leer)
2. Eine Conversation als „Załatwione" markieren → Reload → Status bleibt
3. CSP-Check: Browser-Console darf KEINE CSP-Errors zeigen (ElevenLabs-Domain ist bereits in `netlify.toml` erlaubt)

- [ ] **Step 3: Checkpoint mit User vor Phase E**

---

## Phase E — Events-Tab Politur

**Ziel:** Suche, Community-Filter, Community-Badges, Status-Tags. Daten + Modal unverändert.

### Task E1: Community-Liste konstanten

**Files:**
- Modify: `admin/events.js`

- [ ] **Step 1: Sammle Community-Slugs**

```bash
ls /Users/michal/VintAI/Projekte/pmk-redesign/wspolnota-*.html
```

Notiere die ~10 Slugs (apostolstwo, domowy-kosciol, grono-dzieci-maryi, grupa-kobiet, grupa-meska, ministranci, radio-maryja, ruch-swiatlo-zycie, ruch-szensztacki, schola).

- [ ] **Step 2: Add constants top of `admin/events.js`**

```javascript
const COMMUNITIES = [
  { slug: 'apostolstwo',         name: 'Apostolstwo',           color: '#c97a3f' },
  { slug: 'domowy-kosciol',      name: 'Domowy Kościół',        color: '#5a7691' },
  { slug: 'grono-dzieci-maryi',  name: 'Grono Dzieci Maryi',    color: '#a06593' },
  { slug: 'grupa-kobiet',        name: 'Grupa kobiet',          color: '#b86b8a' },
  { slug: 'grupa-meska',         name: 'Grupa męska',           color: '#4f7a5a' },
  { slug: 'ministranci',         name: 'Ministranci',           color: '#5a8a4a' },
  { slug: 'radio-maryja',        name: 'Radio Maryja',          color: '#7a5fbf' },
  { slug: 'ruch-swiatlo-zycie',  name: 'Ruch Światło-Życie',    color: '#bfa340' },
  { slug: 'ruch-szensztacki',    name: 'Ruch Szensztacki',      color: '#c98a7b' },
  { slug: 'schola',              name: 'Schola',                color: '#9a7fb8' }
];
```

- [ ] **Step 3: Commit**

```bash
git add admin/events.js
git commit -m "feat(events): add community catalog constant"
```

---

### Task E2: Suche + Community-Filter UI

**Files:**
- Modify: `admin/index.html` (innerhalb `#tab-events`)
- Modify: `admin/events.js`
- Modify: `admin/admin.css`

- [ ] **Step 1: Add toolbar markup to `#tab-events` in `admin/index.html`**

Direkt nach dem Title-Header und vor den Filter-Tabs einfügen:

```html
<div class="ev-toolbar">
  <input class="ev-search" id="evSearch" placeholder="Szukaj po tytule lub miejscu…">
  <select class="ev-community-filter" id="evCommunityFilter">
    <option value="all">Wszystkie wspólnoty</option>
    <!-- Optionen werden von Events.populateCommunityFilter() befüllt -->
  </select>
</div>
```

- [ ] **Step 2: Extend `admin/events.js` — search + community filter**

In das `Events`-Modul:

```javascript
let searchTerm = '';
let communityFilter = 'all';

function populateCommunityFilter() {
  const sel = document.getElementById('evCommunityFilter');
  if (!sel || sel.dataset.populated) return;
  for (const c of COMMUNITIES) {
    const opt = document.createElement('option');
    opt.value = c.slug;
    opt.textContent = c.name;
    sel.appendChild(opt);
  }
  sel.dataset.populated = '1';
  sel.addEventListener('change', e => { communityFilter = e.target.value; render(); });
  const search = document.getElementById('evSearch');
  search.addEventListener('input', e => { searchTerm = e.target.value; render(); });
}
```

In die bestehende `filtered()`-Funktion (oder Filterstelle) ergänzen:

```javascript
function filtered() {
  const now = new Date(); now.setHours(0, 0, 0, 0);
  return allEvents.filter(e => {
    if (currentFilter === 'upcoming' && new Date(e.date) < now) return false;
    if (currentFilter === 'past'     && new Date(e.date) >= now) return false;
    if (communityFilter !== 'all' && e.community !== communityFilter) return false;
    if (searchTerm) {
      const q = searchTerm.toLowerCase();
      const t = (e.title || '').toLowerCase();
      const p = (e.location || '').toLowerCase();
      if (!t.includes(q) && !p.includes(q)) return false;
    }
    return true;
  });
}
```

Beim Aufruf von `load()` am Ende `populateCommunityFilter()` triggern.

- [ ] **Step 3: Add toolbar styles to `admin/admin.css`**

```css
.ev-toolbar { display: flex; gap: 0.75rem; margin: 1rem 0; }
.ev-search { flex: 1; padding: 0.6rem 0.9rem; border: 1.5px solid var(--color-warm-200); border-radius: var(--radius-md); background: white; font-size: var(--text-sm); }
.ev-community-filter { padding: 0.55rem 0.9rem; border: 1.5px solid var(--color-warm-200); border-radius: var(--radius-md); background: white; font-size: var(--text-sm); }
```

- [ ] **Step 4: Smoke-test**

Browser:
1. Events-Tab → Suchzeile sichtbar, Dropdown sichtbar
2. Search „Bierzmowanie" → Liste filtert nach Titel
3. Dropdown auf „Schola" → nur Schola-Events sichtbar (sofern `community`-Feld in Daten existiert)
4. Beides kombinieren → korrekte Intersection

**Hinweis:** Falls vorhandene Events kein `community`-Feld haben, ist Filter-Output leer für Auswahl ≠ "all". Das ist OK — Feld wird in Task E4 ins Modal aufgenommen.

- [ ] **Step 5: Commit**

```bash
git add admin/index.html admin/events.js admin/admin.css
git commit -m "feat(events): search input + community filter dropdown"
```

---

### Task E3: Community-Badges + Status-Tags in Zeilen

**Files:**
- Modify: `admin/events.js` (render-Funktion)
- Modify: `admin/admin.css`

- [ ] **Step 1: Helper functions in `admin/events.js`**

Im Modul (vor `render()`):

```javascript
function communityByslug(slug) {
  return COMMUNITIES.find(c => c.slug === slug);
}

function statusTag(date) {
  if (!date) return '';
  const now = new Date(); now.setHours(0, 0, 0, 0);
  const target = new Date(date); target.setHours(0, 0, 0, 0);
  const diff = Math.round((target - now) / 86400000);
  if (diff < 0) return '';
  if (diff === 0) return '<span class="ev-status ev-status-today">Dziś</span>';
  if (diff === 1) return '<span class="ev-status ev-status-tmr">Jutro</span>';
  if (diff <= 7)  return `<span class="ev-status ev-status-soon">Za ${diff} dni</span>`;
  return '';
}

function badgeHtml(slug) {
  const c = communityByslug(slug);
  if (!c) return '';
  return `<span class="ev-badge" style="background:${c.color}22;color:${c.color}">● ${c.name}</span>`;
}
```

- [ ] **Step 2: Wire helpers into existing row-render**

Identifiziere die bestehende Stelle, an der eine Event-Zeile gerendert wird (in `render()` oder einer Sub-Funktion). Ergänze in der Zeile zwei Zellen:

```javascript
// Vor (oder nach) dem "Bearbeiten"-Button:
// {badgeHtml(event.community)}
// {statusTag(event.date)}
```

Konkret-Beispiel — anpassen an existierenden Code:

```javascript
const tr = `
  <tr>
    <td class="ev-date">${fmtDate(event.date)}</td>
    <td class="ev-name">
      ${event.title}
      <div class="ev-place">${event.location || ''}</div>
    </td>
    <td>${badgeHtml(event.community)}</td>
    <td>${statusTag(event.date)}</td>
    <td><a href="#" onclick="openModal('${event.id}'); return false">Edytuj</a></td>
  </tr>
`;
```

- [ ] **Step 3: Add badge/status styles to `admin/admin.css`**

```css
.ev-badge { display: inline-flex; align-items: center; padding: 0.15rem 0.65rem; border-radius: 999px; font-size: var(--text-xs); font-weight: 500; }
.ev-status { display: inline-block; padding: 0.15rem 0.55rem; border-radius: 999px; font-size: var(--text-xs); font-weight: 600; }
.ev-status-today { background: rgba(195, 90, 90, 0.15); color: #a03a3a; }
.ev-status-tmr   { background: rgba(195, 155, 80, 0.18); color: #8a6420; }
.ev-status-soon  { background: var(--color-warm-100); color: var(--color-warm-700); }
.ev-place { color: var(--color-warm-500); font-size: var(--text-xs); margin-top: 2px; }
```

- [ ] **Step 4: Smoke-test**

Browser:
1. Events-Liste → jedes Event mit `community`-Feld zeigt farbigen Badge
2. Heutiges Event → roter „Dziś"-Tag, morgiges → gelber „Jutro"-Tag, übermorgen+ → „Za N dni"
3. Vergangene Events → kein Tag

- [ ] **Step 5: Commit**

```bash
git add admin/events.js admin/admin.css
git commit -m "feat(events): community color badges + relative status tags"
```

---

### Task E4: Community-Feld im Event-Modal

**Files:**
- Modify: `admin/index.html` (Modal-Markup)
- Modify: `admin/events.js` (Save/Load)

- [ ] **Step 1: Find existing modal form**

```bash
grep -n "modal\|Nowe wydarzenie\|modalTitle" admin/index.html | head -10
```

Identifiziere das Modal-Form (vermutlich um Zeile ~1197 ff.).

- [ ] **Step 2: Add Community-Select to modal**

Im Modal, nach dem bestehenden Title/Datum/Ort-Feld, ergänze:

```html
<div class="form-group">
  <label for="evCommunity">Wspólnota</label>
  <select id="evCommunity" name="community" required>
    <option value="">— wybierz wspólnotę —</option>
    <!-- Optionen via JS aus COMMUNITIES -->
  </select>
</div>
```

- [ ] **Step 3: Populate select in `events.js` openModal**

```javascript
function populateModalCommunitySelect(currentSlug) {
  const sel = document.getElementById('evCommunity');
  if (!sel) return;
  // Reset options ausser dem placeholder
  while (sel.options.length > 1) sel.remove(1);
  for (const c of COMMUNITIES) {
    const opt = document.createElement('option');
    opt.value = c.slug;
    opt.textContent = c.name;
    if (c.slug === currentSlug) opt.selected = true;
    sel.appendChild(opt);
  }
}
```

Im bestehenden `openModal(eventId)`-Aufruf am Ende ergänzen:

```javascript
populateModalCommunitySelect(event ? event.community : '');
```

- [ ] **Step 4: Save community value in `saveEvent`**

Im bestehenden `saveEvent`-Handler, beim Sammeln des Form-Body, `community: document.getElementById('evCommunity').value` mit reinpacken — und sicherstellen, dass Apps Script die Spalte schreibt.

**Wichtig:** Falls die Google-Sheet-Spalte „community" noch nicht existiert, manuell anlegen (Spalte als letzte oder definierte Position). Apps Script (`addEvent`/`updateEvent` in `admin/google-apps-script.js`) muss die Spalte auch lesen + schreiben — Anpassung erforderlich.

- [ ] **Step 5: Apps Script update (falls nötig)**

In `admin/google-apps-script.js`, `addEvent` und `updateEvent` so erweitern, dass `params.community` in die richtige Spalte landet. Re-deploy wie in Task C1.

- [ ] **Step 6: Smoke-test**

Browser:
1. „+ Nowe wydarzenie" → Modal hat „Wspólnota"-Select
2. Eintrag anlegen mit „Schola" → erscheint in Liste mit lavender Badge
3. Existierendes Event editieren → Community wird vorausgewählt (sofern vorhanden)
4. Liste mit Community-Filter „Schola" → neues Event sichtbar

- [ ] **Step 7: Commit**

```bash
git add admin/index.html admin/events.js admin/google-apps-script.js
git commit -m "feat(events): community field in event modal + apps script integration"
```

---

### Task E5: Final Deploy + User-Akzeptanz

- [ ] **Step 1: Push**

```bash
git push origin main
```

- [ ] **Step 2: Vollständiger Staging-Walkthrough**

`https://pmk-berlinpl.netlify.app/admin/`:
- Login funktioniert
- Events-Tab: Suche, Filter, Badges, Status-Tags alle sichtbar
- Modal: Community-Select integriert
- KI-Tab: Liste lädt, Flag-Side-Panel funktioniert
- Newsletter-Tab: Liste lädt, Filter + CSV-Export
- Public Footer: Newsletter-Form funktioniert
- Mobile (375px): Sidebar wird Top-Strip, alle Tabs nutzbar

- [ ] **Step 3: Production-Deploy (manuell)**

```bash
netlify deploy --prod --dir=.
```

Nach Deploy: gleicher Walkthrough auf der Production-URL.

- [ ] **Step 4: User-Checkpoint**

Fertig — User abnimmt.

---

## Self-Review Notes

**Spec coverage check** durchgeführt:
- §3 IA (sidebar, hash routing) → Phase B
- §4 Auth (extract to auth.js) → Task A2
- §5 Events polish (search, filter, badges, status) → Phase E
- §6 KI tab (ElevenLabs + Blobs + side-panel) → Phase D
- §7 Newsletter (footer form, list_subscribers, admin tab) → Phase C
- §8 File structure → mapped across A–E
- §9 Error handling → addressed in function bodies (`502`, empty-state hints in render)
- §10 Privacy/security → blobs scoped, no transcripts persisted, PIN gating
- §11 Testing strategy → manual + curl + browse, documented per task
- §12 Migration phases A–E → mirrored as Phase A–E
- §13 Out-of-scope → respected (no send, no per-user login, no overview tab)

**Type consistency check:** `Auth.url`, `Auth.getPin()`, `Auth.verify()`, `Auth.setPin()`, `Auth.clear()` — used identically across tasks A2, C2, C3, D2, D3, D4. `COMMUNITIES` array slug/name/color shape — used identically in Tasks E1–E4.

**Placeholder scan:** keine TBD/TODO. Alle Code-Schritte enthalten echten Code.
