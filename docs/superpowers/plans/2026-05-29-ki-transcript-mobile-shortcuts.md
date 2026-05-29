# Phase F — KI-Transkript + Mobile + Keyboard-Shortcuts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Erweitere das KI-Czat Side-Panel um ein vollständiges chronologisches Transkript aus ElevenLabs, polish das Dashboard für Mobile (Drawer / Card-List / Bottom-Sheet / Fullscreen-Modal), und füge Keyboard-Shortcuts für Power-User hinzu.

**Architecture:** Single Netlify Function (`ki-transcript.js`) als ElevenLabs-Proxy mit gleichem PIN-Auth-Pattern wie `ki-conversations.js`. Frontend lädt Transkripte lazy, cacht in-memory per Session. Mobile-Polish via CSS @media + zwei kleine JS-Module (`mobile-drawer.js`, `shortcuts.js`).

**Tech Stack:** Vanilla JS (kein Build-Step), Netlify Functions (Node 18, plain fetch), ElevenLabs Conversational AI API, CSS @media queries.

**Spec:** [`docs/superpowers/specs/2026-05-29-ki-transcript-mobile-shortcuts-design.md`](../specs/2026-05-29-ki-transcript-mobile-shortcuts-design.md)

**Test approach:** Vanilla-Code ohne Test-Framework. Verifikation per:
1. `curl` Smoke-Tests gegen die Netlify Function
2. `gstack` browse für End-to-End Browser-Flows (Desktop + Mobile DevTools-Emulation)
3. Manuelle Akzeptanz auf `pmk-berlinpl.netlify.app` nach Deploy

**Frequent commits:** Jeder Task = ein Commit. Keine Batch-Commits.

**Deploy after each phase:** `netlify deploy --prod --dir=.` nach Phase-Ende, Live-Smoke.

---

## Phase F1 — Backend: ki-transcript Function

**Ziel:** ElevenLabs Conversation-Detail-Endpoint als PIN-gated Netlify Function exponieren. Returns `{conversation_id, transcript: [{role, text, time_in_call_secs}, ...]}` als JSON.

### Task F1.1: Function `ki-transcript.js` erstellen

**Files:**
- Create: `netlify/functions/ki-transcript.js`

- [ ] **Step 1: Confirm prerequisites**

```bash
cd /Users/michal/VintAI/Projekte/pmk-redesign
git status  # must be clean
grep -E "^ELEVENLABS_(API_KEY|PMK_AGENT_ID)" .env | wc -l   # expect 2
ls netlify/functions/ki-conversations.js   # must exist
```

Expected: clean, 2, file exists.

- [ ] **Step 2: Create the function**

Create `netlify/functions/ki-transcript.js` with:

```javascript
// netlify/functions/ki-transcript.js
// GET /.netlify/functions/ki-transcript?id=conv_XXX&pin=YYY
// Returns chronological transcript for a single ElevenLabs conversation.

const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL
  || 'https://script.google.com/macros/s/AKfycbwr6u5qQRUuQ37gIaczdCG0DmfQRlazDGYUbQOC2CaSCy_tJBywwwChXwtAS8Ivqe9HPw/exec';
const ADMIN_PIN = process.env.ADMIN_PIN || '';

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
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: JSON.stringify({ success: false, error: 'method_not_allowed' }) };
  }

  const q = event.queryStringParameters || {};
  const pin = q.pin || '';
  const id = q.id || '';

  if (!pin || !(await verifyPin(pin))) {
    return { statusCode: 401, body: JSON.stringify({ success: false, error: 'unauthorized' }) };
  }
  if (!id || !id.startsWith('conv_')) {
    return { statusCode: 400, body: JSON.stringify({ success: false, error: 'invalid_id' }) };
  }

  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, body: JSON.stringify({ success: false, error: 'elevenlabs_not_configured' }) };
  }

  const url = `https://api.elevenlabs.io/v1/convai/conversations/${encodeURIComponent(id)}`;

  try {
    const res = await fetch(url, { headers: { 'xi-api-key': apiKey } });
    if (!res.ok) {
      return { statusCode: 502, body: JSON.stringify({ success: false, error: 'elevenlabs_error', status: res.status }) };
    }
    const data = await res.json();

    // Extract chronological transcript: each message has role ('user' | 'agent') and message text
    const transcript = Array.isArray(data.transcript) ? data.transcript.map(m => ({
      role: m.role || 'unknown',
      text: m.message || m.text || '',
      time_in_call_secs: m.time_in_call_secs || 0
    })) : [];

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, max-age=300' },
      body: JSON.stringify({
        success: true,
        conversation_id: id,
        transcript,
        message_count: transcript.length
      })
    };
  } catch (err) {
    return { statusCode: 502, body: JSON.stringify({ success: false, error: 'elevenlabs_unreachable' }) };
  }
};
```

- [ ] **Step 3: Syntax check + grep verifications**

```bash
node -c netlify/functions/ki-transcript.js
grep -c "ELEVENLABS_API_KEY" netlify/functions/ki-transcript.js   # expect 1
grep -c "verifyPin\|method_not_allowed\|unauthorized\|invalid_id\|elevenlabs_error" netlify/functions/ki-transcript.js   # expect ≥5
```

Expected: no syntax error, 1, 5.

- [ ] **Step 4: Commit**

```bash
git add netlify/functions/ki-transcript.js
git commit -m "feat(functions): ki-transcript proxy to ElevenLabs conversation detail"
```

---

### Task F1.2: Deploy + Live Smoke

- [ ] **Step 1: Deploy**

```bash
netlify deploy --prod --dir=.
```

Expected: `🚀 Deploy complete`.

- [ ] **Step 2: Smoke with valid PIN + valid ID**

```bash
curl -s "https://pmk-berlinpl.netlify.app/.netlify/functions/ki-transcript?pin=pmk2026&id=conv_3101ksarhqc3ffetzbe75hg5h87c" | python3 -m json.tool | head -30
```

Expected: `success: true`, `transcript: [...]` array. If transcript is empty for this specific conversation, try another id from the list endpoint.

- [ ] **Step 3: Smoke error paths**

```bash
# Missing PIN
curl -s "https://pmk-berlinpl.netlify.app/.netlify/functions/ki-transcript?id=conv_3101ksarhqc3ffetzbe75hg5h87c" | head -c 100
echo
# Invalid ID
curl -s "https://pmk-berlinpl.netlify.app/.netlify/functions/ki-transcript?pin=pmk2026&id=nonsense" | head -c 100
echo
# Wrong PIN
curl -s "https://pmk-berlinpl.netlify.app/.netlify/functions/ki-transcript?pin=wrong&id=conv_3101ksarhqc3ffetzbe75hg5h87c" | head -c 100
```

Expected:
- Missing PIN → `{"success":false,"error":"unauthorized"}`
- Invalid ID → `{"success":false,"error":"invalid_id"}`
- Wrong PIN → `{"success":false,"error":"unauthorized"}`

- [ ] **Step 4: No commit needed (deploy-only step). Mark task complete.**

---

## Phase F2 — Frontend: Transkript im Side-Panel

**Ziel:** Im KI-Side-Panel ein expandierbares Accordion „Pokaż pełną rozmowę" hinzufügen. Lazy-Load on first expand, cache in IIFE, chronological render mit role-labels und alternierender Färbung.

### Task F2.1: KI.js — transcript state + load + render

**Files:**
- Modify: `admin/ki.js`

- [ ] **Step 1: Find the side-panel render section**

```bash
grep -n "ki-transcript\|Transkrypt ładuje\|.ki-panel" admin/ki.js
```

Note the lines — likely around where the side panel template is built.

- [ ] **Step 2: Add transcript state to IIFE**

In `admin/ki.js`, inside the `KI = (function() { ... })()` IIFE, near the other state variables (top), add:

```javascript
let transcriptCache = {};           // key = conversation_id, value = {state, transcript, error}
```

The shape: `{state: 'idle'|'loading'|'ready'|'error', transcript: [...], error: string}`.

- [ ] **Step 3: Add fetchTranscript function**

Inside the IIFE (before `render()`), add:

```javascript
async function fetchTranscript(conversationId) {
  if (transcriptCache[conversationId]?.state === 'ready') return;
  if (transcriptCache[conversationId]?.state === 'loading') return;
  transcriptCache[conversationId] = { state: 'loading' };
  render();
  try {
    const pin = Auth.getPin();
    const url = `/.netlify/functions/ki-transcript?id=${encodeURIComponent(conversationId)}&pin=${encodeURIComponent(pin)}`;
    const res = await fetch(url);
    const data = await res.json();
    if (data && data.success && Array.isArray(data.transcript)) {
      transcriptCache[conversationId] = { state: 'ready', transcript: data.transcript };
    } else {
      transcriptCache[conversationId] = { state: 'error', error: data?.error || 'unknown' };
    }
  } catch (e) {
    transcriptCache[conversationId] = { state: 'error', error: 'network' };
  }
  render();
}
```

- [ ] **Step 4: Replace the placeholder transcript section in render()**

Find the existing `ki-transcript` block in the panel template. It currently contains a `<em>Transkrypt ładuje się asynchronicznie...</em>` placeholder. Replace the entire `<div class="ki-transcript">` block with:

```javascript
<details class="ki-transcript-toggle" ${selected.__transcriptOpen ? 'open' : ''}>
  <summary>▸ Pokaż pełną rozmowę ${selected.message_count ? `(${selected.message_count} wiadomości)` : ''}</summary>
  <div class="ki-transcript-content">
    ${(() => {
      const cache = transcriptCache[selected.conversation_id];
      if (!cache || cache.state === 'idle') return '<div class="ki-transcript-empty">Kliknij powyżej, aby załadować transkrypt.</div>';
      if (cache.state === 'loading') return '<div class="ki-loading"><div class="ki-spinner"></div><span>Wczytywanie transkryptu…</span></div>';
      if (cache.state === 'error') return '<div class="ki-transcript-empty">Nie udało się pobrać transkryptu. <button class="ki-transcript-retry" data-id="' + escapeHtml(selected.conversation_id) + '">Spróbuj ponownie</button></div>';
      if (cache.transcript.length === 0) return '<div class="ki-transcript-empty">Brak treści w tej rozmowie.</div>';
      return '<ol class="ki-msg-list">' + cache.transcript.map(m => `
        <li class="ki-msg ki-msg-${m.role === 'user' ? 'user' : 'agent'}">
          <span class="ki-msg-role">${m.role === 'user' ? 'Użytkownik' : 'Asystent'}</span>
          <p>${escapeHtml(m.text || '—')}</p>
        </li>
      `).join('') + '</ol>';
    })()}
  </div>
</details>
```

- [ ] **Step 5: Wire the toggle to trigger fetch**

In the post-innerHTML wiring section (where the panel's button handlers are attached), find the `panel` element setup. Add:

```javascript
const transcriptToggle = panel.querySelector('.ki-transcript-toggle');
if (transcriptToggle) {
  transcriptToggle.addEventListener('toggle', () => {
    selected.__transcriptOpen = transcriptToggle.open;
    if (transcriptToggle.open) fetchTranscript(selected.conversation_id);
  });
  const retryBtn = panel.querySelector('.ki-transcript-retry');
  if (retryBtn) retryBtn.addEventListener('click', () => fetchTranscript(retryBtn.dataset.id));
}
```

- [ ] **Step 6: Verify syntax + grep**

```bash
node -c admin/ki.js
grep -c "fetchTranscript\|transcriptCache\|ki-transcript-toggle\|ki-msg-" admin/ki.js   # expect ≥8
```

Expected: no syntax error, ≥8.

- [ ] **Step 7: Commit**

```bash
git add admin/ki.js
git commit -m "feat(admin): expandable transcript in KI side-panel with lazy fetch + cache"
```

---

### Task F2.2: CSS — transcript styling

**Files:**
- Modify: `admin/admin.css`

- [ ] **Step 1: Locate the KI styles section**

```bash
grep -n "/\* === KI Tab\|.ki-panel\|.ki-status-" admin/admin.css | head -5
```

Identify where the KI tab styles end so we append at the right place.

- [ ] **Step 2: Append transcript styles**

Append to `admin/admin.css`:

```css
/* ============================================
   KI Side-Panel — Transcript
   ============================================ */
.ki-transcript-toggle { margin: 0.75rem 0 1.25rem 0; }
.ki-transcript-toggle summary {
  cursor: pointer; padding: 0.5rem 0.75rem;
  background: var(--color-warm-50); border-radius: var(--radius-md);
  font-size: var(--text-sm); color: var(--color-warm-700);
  list-style: none;
}
.ki-transcript-toggle summary::-webkit-details-marker { display: none; }
.ki-transcript-toggle summary:hover { background: var(--color-warm-100); }
.ki-transcript-toggle[open] summary { background: var(--color-warm-100); margin-bottom: 0.5rem; }

.ki-transcript-content { padding: 0.5rem 0; }
.ki-transcript-empty {
  padding: 1rem; text-align: center;
  color: var(--color-warm-500); font-size: var(--text-sm);
}
.ki-transcript-retry {
  background: var(--color-accent); color: white;
  border: 0; padding: 0.4rem 0.85rem; border-radius: var(--radius-md);
  font-size: var(--text-xs); cursor: pointer; margin-left: 0.5rem;
}

.ki-msg-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 0.5rem; }
.ki-msg {
  padding: 0.6rem 0.85rem; border-radius: var(--radius-md);
  font-size: var(--text-sm); line-height: 1.4;
  max-width: 92%;
}
.ki-msg p { margin: 0.25rem 0 0 0; }
.ki-msg-role {
  font-size: var(--text-xs); font-weight: 600; text-transform: uppercase;
  letter-spacing: 0.04em; opacity: 0.7;
}
.ki-msg-user {
  background: var(--color-warm-50);
  align-self: flex-start;
}
.ki-msg-agent {
  background: rgba(166, 139, 91, 0.10);
  align-self: flex-end;
}
.ki-msg-user .ki-msg-role { color: var(--color-warm-700); }
.ki-msg-agent .ki-msg-role { color: var(--color-accent-dark); }
```

- [ ] **Step 3: Verify**

```bash
grep -c "ki-transcript-toggle\|ki-msg-list\|ki-msg-user\|ki-msg-agent" admin/admin.css   # expect ≥6
```

Expected: ≥6.

- [ ] **Step 4: Commit**

```bash
git add admin/admin.css
git commit -m "style(admin): KI transcript message list (user vs agent alternating)"
```

---

### Task F2.3: Deploy + Browser smoke

- [ ] **Step 1: Deploy**

```bash
netlify deploy --prod --dir=.
```

- [ ] **Step 2: Browser smoke with gstack**

```bash
B=~/.claude/skills/gstack/browse/dist/browse
$B stop && sleep 3
$B chain <<'EOF'
[["viewport","1440x900"],
["goto","https://pmk-berlinpl.netlify.app/admin/#ki"],
["fill","#pinInput","pmk2026"],
["click","#loginBtn"],
["wait","#tab-ki .ki-row:first-child"],
["click","#tab-ki .ki-row:first-child"],
["wait",".ki-panel"]]
EOF
```

Then verify side-panel has the transcript-toggle:

```bash
$B js "JSON.stringify({hasToggle:!!document.querySelector('.ki-panel .ki-transcript-toggle'),summaryText:document.querySelector('.ki-panel .ki-transcript-toggle summary')?.textContent})"
```

Expected: `hasToggle: true`, summary text contains „Pokaż pełną rozmowę".

- [ ] **Step 3: Expand and verify lazy fetch**

```bash
$B chain <<'EOF'
[["click",".ki-panel .ki-transcript-toggle summary"]]
EOF
sleep 3
$B js "JSON.stringify({msgs:document.querySelectorAll('.ki-msg-list .ki-msg').length,sample:document.querySelector('.ki-msg-list .ki-msg p')?.textContent?.slice(0,80)})"
```

Expected: `msgs` ≥ 0 (some conversations might have 0 messages — that's OK if loading didn't error). If specific test conversation has known content, sample shows it.

Also take a screenshot:

```bash
$B screenshot /tmp/transcript-live.png
```

Read `/tmp/transcript-live.png` and verify visually that user vs agent messages are distinguishable.

- [ ] **Step 4: No commit. Mark task complete.**

---

## Phase F3 — Mobile: Hamburger Drawer + KI Card-Layout + Bottom-Sheet

**Ziel:** Auf <720px wird Sidebar zum Hamburger-Drawer, KI-Tabelle wird Card-Liste, Side-Panel wird Bottom-Sheet.

### Task F3.1: Hamburger button in topbar + admin/mobile-drawer.js

**Files:**
- Create: `admin/mobile-drawer.js`
- Modify: `admin/index.html`

- [ ] **Step 1: Add hamburger button to topbar**

Find in `admin/index.html` the `<header class="admin-topbar">`. Add the hamburger button BEFORE `<div class="admin-brand">`:

```html
<button class="admin-hamburger" id="adminHamburger" aria-label="Menu" hidden>
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2">
    <line x1="3" y1="6" x2="21" y2="6"/>
    <line x1="3" y1="12" x2="21" y2="12"/>
    <line x1="3" y1="18" x2="21" y2="18"/>
  </svg>
</button>
```

Also add a backdrop element just BEFORE the closing `</body>`:

```html
<div class="admin-backdrop" id="adminBackdrop" hidden></div>
```

And add the script tag in `<head>`, after the existing admin scripts:

```html
<script src="mobile-drawer.js" defer></script>
```

- [ ] **Step 2: Create admin/mobile-drawer.js**

```javascript
// admin/mobile-drawer.js
// Activates the mobile drawer behavior at viewport <= 720px.

(function () {
  const BREAKPOINT = 720;
  const sidebar = () => document.querySelector('.admin-sidebar');
  const hamburger = () => document.getElementById('adminHamburger');
  const backdrop = () => document.getElementById('adminBackdrop');

  function isMobile() { return window.matchMedia(`(max-width: ${BREAKPOINT}px)`).matches; }

  function openDrawer() {
    sidebar()?.classList.add('admin-sidebar-open');
    backdrop().hidden = false;
    document.body.style.overflow = 'hidden';
  }
  function closeDrawer() {
    sidebar()?.classList.remove('admin-sidebar-open');
    backdrop().hidden = true;
    document.body.style.overflow = '';
  }

  function applyMode() {
    const h = hamburger();
    if (!h) return;
    h.hidden = !isMobile();
    if (!isMobile()) closeDrawer();
  }

  document.addEventListener('DOMContentLoaded', () => {
    applyMode();
    hamburger()?.addEventListener('click', () => {
      const isOpen = sidebar()?.classList.contains('admin-sidebar-open');
      if (isOpen) closeDrawer(); else openDrawer();
    });
    backdrop()?.addEventListener('click', closeDrawer);
    // close on nav item click
    document.querySelectorAll('.admin-sidebar .admin-nav-item').forEach(el => {
      el.addEventListener('click', () => { if (isMobile()) closeDrawer(); });
    });
    window.addEventListener('resize', applyMode);
  });
})();
```

- [ ] **Step 3: Verify**

```bash
node -c admin/mobile-drawer.js
grep -c "adminHamburger\|adminBackdrop\|admin-sidebar-open" admin/mobile-drawer.js admin/index.html   # ≥4
```

Expected: ≥4.

- [ ] **Step 4: Commit**

```bash
git add admin/index.html admin/mobile-drawer.js
git commit -m "feat(admin/mobile): hamburger button + drawer behavior <720px"
```

---

### Task F3.2: CSS — Drawer + Card-Layout + Bottom-Sheet + Fullscreen Modal

**Files:**
- Modify: `admin/admin.css`

- [ ] **Step 1: Append mobile rules**

Append to `admin/admin.css`:

```css
/* ============================================
   Mobile Polish — <720px
   ============================================ */
.admin-hamburger {
  display: inline-flex; align-items: center; justify-content: center;
  width: 40px; height: 40px;
  background: transparent; border: 0; border-radius: var(--radius-md);
  color: var(--color-warm-800); cursor: pointer;
  margin-right: 0.5rem;
}
.admin-hamburger:hover { background: var(--color-warm-100); }
.admin-backdrop {
  position: fixed; inset: 0;
  background: rgba(0, 0, 0, 0.35);
  z-index: 55;
}

@media (max-width: 720px) {
  .admin-sidebar {
    position: fixed; top: 0; left: 0; bottom: 0;
    width: 260px; transform: translateX(-100%);
    transition: transform 0.25s var(--ease-out);
    z-index: 60; background: white;
    border-right: 1px solid var(--color-warm-200);
    flex-direction: column; padding: 1rem;
    overflow-y: auto;
  }
  .admin-sidebar.admin-sidebar-open { transform: translateX(0); }
  .admin-nav-label { display: block; }
  .admin-nav-item { white-space: normal; }

  /* KI Card-Layout: hide table, show cards */
  .ki-table { display: none; }
  .ki-mobile-cards { display: flex; flex-direction: column; gap: 0.5rem; }
  .ki-mobile-card {
    background: white; padding: 0.85rem 1rem;
    border-radius: var(--radius-lg);
    border: 1px solid var(--color-warm-100);
    box-shadow: var(--shadow-sm);
    position: relative;
  }
  .ki-mobile-card.ki-row-urgent { border-left: 4px solid #cc5555; }
  .ki-card-row1 {
    display: flex; align-items: center; gap: 0.6rem;
    margin-bottom: 0.4rem; font-size: var(--text-xs);
    color: var(--color-warm-600);
  }
  .ki-card-row1 input[type=checkbox] { width: 22px; height: 22px; accent-color: var(--color-accent); }
  .ki-card-row1 .ki-status { margin-left: auto; }
  .ki-card-row2 { font-size: var(--text-sm); color: var(--color-warm-900); line-height: 1.35; }

  /* Side-Panel becomes Bottom-Sheet */
  .ki-panel {
    width: 100%; height: 92vh; top: auto; bottom: 0;
    border-left: 0; border-top: 1px solid var(--color-warm-200);
    border-radius: 16px 16px 0 0;
    box-shadow: 0 -8px 30px rgba(0, 0, 0, 0.10);
    animation: slideInUp 0.25s var(--ease-out);
    z-index: 100;
  }
  @keyframes slideInUp { from { transform: translateY(100%); } to { transform: translateY(0); } }

  /* Drag-handle visual cue */
  .ki-panel::before {
    content: ''; display: block;
    width: 40px; height: 4px;
    background: var(--color-warm-300);
    border-radius: 2px;
    margin: 6px auto 0 auto;
  }

  /* Events Modal Fullscreen */
  .modal-overlay { padding: 0; }
  .modal-panel {
    width: 100vw; height: 100vh; max-width: none; max-height: none;
    border-radius: 0;
  }
}

@media (max-width: 600px) {
  .modal-header { position: sticky; top: 0; background: white; z-index: 5; }
  .modal-footer { position: sticky; bottom: 0; background: white; z-index: 5; }
}
```

- [ ] **Step 2: Verify**

```bash
grep -c "admin-sidebar-open\|ki-mobile-card\|slideInUp\|admin-backdrop" admin/admin.css   # ≥4
```

Expected: ≥4.

- [ ] **Step 3: Commit**

```bash
git add admin/admin.css
git commit -m "style(admin/mobile): drawer, KI card layout, bottom-sheet, fullscreen modal"
```

---

### Task F3.3: KI.js — Card-Layout Renderer für Mobile

**Files:**
- Modify: `admin/ki.js`

- [ ] **Step 1: Add mobile card render block parallel to table**

Find the current table render in `KI.render()`. After the `<table class="ki-table">...</table>` block, insert a parallel `<div class="ki-mobile-cards">` that renders the SAME data but as cards. Both are in DOM; CSS toggles visibility.

```javascript
<div class="ki-mobile-cards">
  ${rows.length === 0 ? (loading ? `
    <div class="ki-loading"><div class="ki-spinner"></div><span>Wczytywanie rozmów…</span></div>
  ` : `
    <div class="ki-empty">Brak rozmów w tym okresie</div>
  `) : rows.map(c => {
    const urgent = isUrgent(c);
    const eff = effectiveStatus(c);
    return `
      <div class="ki-mobile-card ${urgent ? 'ki-row-urgent' : ''}" data-id="${escapeHtml(c.conversation_id)}">
        <div class="ki-card-row1">
          <input type="checkbox" class="ki-row-check" data-id="${escapeHtml(c.conversation_id)}" ${c.flag?.status === 'done' ? 'checked' : ''}>
          <span>${escapeHtml(fmtTime(c.started_at))}</span>
          <span>${c.channel === 'phone' ? '📞' : '💬'}</span>
          <span>${escapeHtml((c.language || '').toUpperCase())}</span>
          <span class="ki-status ki-status-${eff}">${statusLabel(eff)}</span>
        </div>
        <div class="ki-card-row2">
          ${urgent ? '🔴 ' : ''}${escapeHtml((c.first_user_message || '').slice(0, 120) || '—')}
        </div>
      </div>
    `;
  }).join('')}
</div>
```

- [ ] **Step 2: Wire checkbox + tap-to-open on card**

In the post-innerHTML wiring section (where `.ki-row-check` and `.ki-row` click listeners are attached), ALSO wire the mobile cards. After the existing forEach calls, add:

```javascript
root.querySelectorAll('.ki-mobile-card').forEach(card => {
  card.addEventListener('click', (e) => {
    if (e.target.closest('input[type=checkbox]')) return;
    openPanel(card.dataset.id);
  });
});
```

Note: the checkbox handler from `root.querySelectorAll('.ki-row-check')` already covers BOTH the table and the mobile cards (same class).

- [ ] **Step 3: Verify**

```bash
node -c admin/ki.js
grep -c "ki-mobile-card\|ki-mobile-cards" admin/ki.js   # ≥3
```

Expected: ≥3.

- [ ] **Step 4: Commit**

```bash
git add admin/ki.js
git commit -m "feat(admin/mobile): KI card layout renderer parallel to table"
```

---

### Task F3.4: Deploy + Mobile smoke (DevTools 375x812)

- [ ] **Step 1: Deploy**

```bash
netlify deploy --prod --dir=.
```

- [ ] **Step 2: Mobile smoke**

```bash
B=~/.claude/skills/gstack/browse/dist/browse
$B stop && sleep 3
$B chain <<'EOF'
[["viewport","375x812"],
["goto","https://pmk-berlinpl.netlify.app/admin/#ki"],
["fill","#pinInput","pmk2026"],
["click","#loginBtn"],
["wait","#tab-ki .ki-mobile-cards .ki-mobile-card, #tab-ki .ki-loading"]]
EOF
sleep 5
$B js "JSON.stringify({hamburgerVisible:!document.getElementById('adminHamburger').hidden,cards:document.querySelectorAll('.ki-mobile-card').length,tableHidden:getComputedStyle(document.querySelector('.ki-table')).display==='none'})"
$B screenshot /tmp/mobile-ki.png
```

Expected: hamburger visible, cards > 0, table display=none.

Read `/tmp/mobile-ki.png` — verify card layout looks clean on 375px.

- [ ] **Step 3: Test drawer**

```bash
$B chain <<'EOF'
[["click","#adminHamburger"]]
EOF
sleep 1
$B screenshot /tmp/mobile-drawer.png
$B js "document.querySelector('.admin-sidebar').classList.contains('admin-sidebar-open')"
```

Expected: `true`. Screenshot shows drawer slid out.

- [ ] **Step 4: Test bottom-sheet (click a card)**

```bash
$B chain <<'EOF'
[["click","#adminBackdrop"],
["click",".ki-mobile-card"]]
EOF
sleep 2
$B screenshot /tmp/mobile-sheet.png
```

Read `/tmp/mobile-sheet.png` — bottom-sheet should be visible from bottom.

- [ ] **Step 5: No commit. Mark complete.**

---

## Phase F4 — Keyboard Shortcuts

**Ziel:** Globale Keyboard-Navigation für die KI-Tabelle (J/K/Enter/X/Esc), Tab-Switching (1-5), Search-Fokus (/), Shortcut-Modal (?).

### Task F4.1: admin/shortcuts.js erstellen

**Files:**
- Create: `admin/shortcuts.js`
- Modify: `admin/index.html`

- [ ] **Step 1: Add script tag**

In `admin/index.html` `<head>`, after `mobile-drawer.js`:

```html
<script src="shortcuts.js" defer></script>
```

- [ ] **Step 2: Create admin/shortcuts.js**

```javascript
// admin/shortcuts.js
// Global keyboard shortcuts for the PMK admin dashboard.

(function () {
  const TAB_KEYS = { '1': '#przeglad', '2': '#events', '3': '#ki', '4': '#newsletter', '5': '#statystyki' };

  let selectedRowIndex = -1;

  function isInput(el) {
    if (!el) return false;
    const tag = el.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
  }

  function visibleKiRows() {
    // Prefer mobile cards if visible, else table rows
    const cards = Array.from(document.querySelectorAll('#tab-ki .ki-mobile-card'));
    if (cards.length && getComputedStyle(cards[0]).display !== 'none') return cards;
    return Array.from(document.querySelectorAll('#tab-ki .ki-row'));
  }

  function moveSelection(delta) {
    const rows = visibleKiRows();
    if (!rows.length) return;
    rows.forEach(r => r.classList.remove('ki-row-focused'));
    selectedRowIndex = Math.max(0, Math.min(rows.length - 1, selectedRowIndex + delta));
    const r = rows[selectedRowIndex];
    r.classList.add('ki-row-focused');
    r.scrollIntoView({ block: 'nearest' });
  }

  function activateSelection() {
    const rows = visibleKiRows();
    if (selectedRowIndex < 0 || selectedRowIndex >= rows.length) return;
    rows[selectedRowIndex].click();
  }

  function toggleSelectionDone() {
    const rows = visibleKiRows();
    if (selectedRowIndex < 0 || selectedRowIndex >= rows.length) return;
    const cb = rows[selectedRowIndex].querySelector('.ki-row-check');
    if (cb) cb.click();
  }

  function focusSearch() {
    const inputs = document.querySelectorAll('.ki-search, .news-search, #searchInput');
    for (const i of inputs) {
      if (i.offsetParent !== null) { i.focus(); return; }
    }
  }

  function showShortcutsModal() {
    let modal = document.getElementById('shortcutsModal');
    if (modal) { modal.hidden = false; return; }
    modal = document.createElement('div');
    modal.id = 'shortcutsModal';
    modal.className = 'shortcuts-modal';
    modal.innerHTML = `
      <div class="shortcuts-modal-backdrop"></div>
      <div class="shortcuts-modal-panel" role="dialog" aria-label="Skróty klawiszowe">
        <header><h2>Skróty klawiszowe</h2><button class="shortcuts-modal-close" aria-label="Zamknij">×</button></header>
        <table class="shortcuts-table">
          <tr><td><kbd>1</kbd>–<kbd>5</kbd></td><td>Przełącz zakładkę (Przegląd / Wydarzenia / KI / Newsletter / Statystyki)</td></tr>
          <tr><td><kbd>J</kbd> / <kbd>↓</kbd></td><td>Następny wiersz w KI</td></tr>
          <tr><td><kbd>K</kbd> / <kbd>↑</kbd></td><td>Poprzedni wiersz</td></tr>
          <tr><td><kbd>Enter</kbd></td><td>Otwórz panel rozmowy</td></tr>
          <tr><td><kbd>X</kbd></td><td>Oznacz jako załatwione</td></tr>
          <tr><td><kbd>Esc</kbd></td><td>Zamknij panel / menu</td></tr>
          <tr><td><kbd>/</kbd></td><td>Skup się na polu wyszukiwania</td></tr>
          <tr><td><kbd>?</kbd></td><td>Pokaż tę listę</td></tr>
        </table>
      </div>
    `;
    document.body.appendChild(modal);
    modal.querySelector('.shortcuts-modal-close').addEventListener('click', () => modal.hidden = true);
    modal.querySelector('.shortcuts-modal-backdrop').addEventListener('click', () => modal.hidden = true);
  }

  function closeOverlays() {
    const drawer = document.querySelector('.admin-sidebar.admin-sidebar-open');
    if (drawer) { document.getElementById('adminBackdrop')?.click(); return; }
    const panel = document.querySelector('.ki-panel');
    if (panel) { panel.querySelector('.ki-close')?.click(); return; }
    const sm = document.getElementById('shortcutsModal');
    if (sm && !sm.hidden) { sm.hidden = true; return; }
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closeOverlays(); return; }
    if (isInput(e.target)) return;

    if (e.key === '?') { e.preventDefault(); showShortcutsModal(); return; }
    if (e.key === '/') { e.preventDefault(); focusSearch(); return; }

    const tabHash = TAB_KEYS[e.key];
    if (tabHash) { e.preventDefault(); location.hash = tabHash; return; }

    // KI-specific
    if (location.hash !== '#ki') return;
    if (e.key === 'j' || e.key === 'ArrowDown') { e.preventDefault(); moveSelection(1); }
    else if (e.key === 'k' || e.key === 'ArrowUp') { e.preventDefault(); moveSelection(-1); }
    else if (e.key === 'Enter') { e.preventDefault(); activateSelection(); }
    else if (e.key === 'x' || e.key === 'X') { e.preventDefault(); toggleSelectionDone(); }
  });
})();
```

- [ ] **Step 3: Verify**

```bash
node -c admin/shortcuts.js
grep -c "TAB_KEYS\|moveSelection\|showShortcutsModal\|ki-row-focused" admin/shortcuts.js   # ≥6
```

Expected: ≥6.

- [ ] **Step 4: Commit**

```bash
git add admin/shortcuts.js admin/index.html
git commit -m "feat(admin): keyboard shortcuts (J/K/Enter/X, 1-5, /, ?, Esc)"
```

---

### Task F4.2: CSS — focus-ring + shortcuts modal

**Files:**
- Modify: `admin/admin.css`

- [ ] **Step 1: Append styles**

```css
/* ============================================
   Keyboard Shortcuts
   ============================================ */
.ki-row-focused, .ki-mobile-card.ki-row-focused {
  box-shadow: inset 0 0 0 3px var(--color-accent), var(--shadow-sm);
}

.shortcuts-modal { position: fixed; inset: 0; z-index: 300; display: flex; align-items: center; justify-content: center; }
.shortcuts-modal[hidden] { display: none; }
.shortcuts-modal-backdrop { position: absolute; inset: 0; background: rgba(0, 0, 0, 0.4); }
.shortcuts-modal-panel {
  position: relative;
  background: white; max-width: 520px; width: 90%;
  border-radius: var(--radius-2xl); padding: 1.5rem;
  box-shadow: var(--shadow-lg);
  animation: fadeUp 0.25s var(--ease-out);
}
.shortcuts-modal-panel header {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 1rem;
}
.shortcuts-modal-panel h2 {
  font-family: var(--font-serif); font-weight: 500;
  margin: 0; font-size: 1.3rem;
}
.shortcuts-modal-close {
  background: none; border: 0; cursor: pointer;
  font-size: 1.6rem; line-height: 1;
  color: var(--color-warm-500); width: 32px; height: 32px;
}
.shortcuts-table {
  width: 100%; border-collapse: collapse; font-size: var(--text-sm);
}
.shortcuts-table td {
  padding: 0.5rem 0.25rem; border-bottom: 1px solid var(--color-warm-100);
  vertical-align: top;
}
.shortcuts-table td:first-child { white-space: nowrap; color: var(--color-warm-700); }
.shortcuts-table kbd {
  display: inline-block; padding: 0.1rem 0.5rem;
  background: var(--color-warm-100); border-radius: 4px;
  border-bottom: 2px solid var(--color-warm-200);
  font-family: ui-monospace, "SF Mono", monospace;
  font-size: 0.8rem; font-weight: 600;
  color: var(--color-warm-900); margin: 0 0.1rem;
}
```

- [ ] **Step 2: Verify**

```bash
grep -c "shortcuts-modal\|ki-row-focused\|shortcuts-table" admin/admin.css   # ≥5
```

Expected: ≥5.

- [ ] **Step 3: Commit**

```bash
git add admin/admin.css
git commit -m "style(admin): focus-ring + shortcuts modal styling"
```

---

### Task F4.3: Onboarding hint — Shortcut-Tipp

**Files:**
- Modify: `admin/ki.js`

- [ ] **Step 1: Locate the onboarding banner template**

```bash
grep -n "Jak korzystać z KI-Czatu\|ki-onboarding" admin/ki.js | head -5
```

- [ ] **Step 2: Add the tip line**

Inside the onboarding banner template (look for the `<ul>` with the existing tips), add a final `<li>`:

```javascript
<li>💡 Naciśnij <kbd>?</kbd>, aby zobaczyć skróty klawiszowe.</li>
```

- [ ] **Step 3: Verify**

```bash
grep -c "skróty klawiszowe\|Naciśnij" admin/ki.js   # ≥1
```

Expected: ≥1.

- [ ] **Step 4: Commit**

```bash
git add admin/ki.js
git commit -m "ux(admin): hint shortcut tip in KI onboarding banner"
```

---

### Task F4.4: Deploy + Shortcuts smoke

- [ ] **Step 1: Deploy**

```bash
netlify deploy --prod --dir=.
```

- [ ] **Step 2: Browser smoke shortcuts**

```bash
B=~/.claude/skills/gstack/browse/dist/browse
$B stop && sleep 3
$B chain <<'EOF'
[["viewport","1440x900"],
["goto","https://pmk-berlinpl.netlify.app/admin/#ki"],
["fill","#pinInput","pmk2026"],
["click","#loginBtn"],
["wait","#tab-ki .ki-row:first-child"]]
EOF
```

Test the ? modal:

```bash
$B chain <<'EOF'
[["press","Shift+Slash"]]
EOF
sleep 1
$B js "JSON.stringify({modalOpen:!document.getElementById('shortcutsModal')?.hidden,title:document.querySelector('#shortcutsModal h2')?.textContent})"
$B screenshot /tmp/shortcuts-modal.png
```

Expected: `modalOpen: true`, title=„Skróty klawiszowe".

Test Esc closes:

```bash
$B chain <<'EOF'
[["press","Escape"]]
EOF
sleep 1
$B js "document.getElementById('shortcutsModal')?.hidden"
```

Expected: `true`.

Test tab switch via 1-5:

```bash
$B chain <<'EOF'
[["press","2"]]
EOF
sleep 1
$B js "location.hash"
```

Expected: `#events`.

```bash
$B chain <<'EOF'
[["press","3"]]
EOF
sleep 2
$B js "location.hash"
```

Expected: `#ki`.

Test J/K navigation:

```bash
$B chain <<'EOF'
[["press","j"],
["press","j"],
["press","j"]]
EOF
sleep 1
$B js "document.querySelectorAll('#tab-ki .ki-row.ki-row-focused').length"
```

Expected: `1` (third row has focus).

- [ ] **Step 3: Mark complete**

---

## Phase F5 — Final integration tests + memory update

**Ziel:** End-to-end Mobile + Desktop check, screenshot board, memory update for forward-look.

### Task F5.1: Multi-viewport screenshot board

- [ ] **Step 1: Screenshots at 3 viewports**

```bash
B=~/.claude/skills/gstack/browse/dist/browse
$B stop && sleep 3

# Desktop
$B chain <<'EOF'
[["viewport","1440x900"],
["goto","https://pmk-berlinpl.netlify.app/admin/#ki"],
["fill","#pinInput","pmk2026"],
["click","#loginBtn"],
["wait","#tab-ki .ki-row:first-child"]]
EOF
$B screenshot /tmp/final-desktop.png

# Tablet
$B chain <<'EOF'
[["viewport","768x1024"]]
EOF
sleep 2
$B screenshot /tmp/final-tablet.png

# Phone
$B chain <<'EOF'
[["viewport","375x812"]]
EOF
sleep 2
$B screenshot /tmp/final-phone.png
```

- [ ] **Step 2: Review screenshots**

Read all three files. Confirm:
- Desktop: traditional table, sidebar left
- Tablet (768): card layout starts kicking in OR table fits (acceptable either way)
- Phone (375): cards, hamburger visible, no table overflow

If any obvious layout breakage, fix CSS and commit as `style(admin): mobile layout fix for [issue]`.

- [ ] **Step 3: No commit if no fix needed.**

---

### Task F5.2: Update memory with Phase F summary

**Files:**
- Modify: `/Users/michal/.claude/projects/-Users-michal-VintAI-Projekte-pmk-redesign/memory/project_admin_dashboard_shipped.md`

- [ ] **Step 1: Append Phase F notes**

Append at the end of the file:

```markdown

## Phase F shipped (2026-05-29)

Added:
- `netlify/functions/ki-transcript.js` — proxies ElevenLabs conversation detail
- `admin/ki.js` — expandable transcript accordion in side-panel, lazy load + in-memory cache
- `admin/mobile-drawer.js` — hamburger button + sidebar drawer below 720px viewport
- `admin/shortcuts.js` — global keyboard shortcuts (J/K/Enter/X, 1-5, /, ?, Esc)
- `admin/admin.css` — mobile card layout for KI, bottom-sheet panel, fullscreen modal, shortcut modal

No new env vars. No external AI APIs (per user decision — Claude/Anthropic keys stay user-private).

**Forward-looks** (future scope, NOT in F):
- AI summary + auto-draft via Claude/OpenAI (requires parish to provide own API key)
- DNS cutover from WIX to pmk-berlin.de
- Audio playback from ElevenLabs recording URL
```

- [ ] **Step 2: Verify**

```bash
grep -c "Phase F shipped" /Users/michal/.claude/projects/-Users-michal-VintAI-Projekte-pmk-redesign/memory/project_admin_dashboard_shipped.md
```

Expected: 1.

- [ ] **Step 3: No git commit (memory file lives outside repo).**

---

## Self-Review Notes

**Spec coverage:**
- §3 KI Side-Panel UI → F2 (transcript) + F4 (shortcuts hint)
- §4 Mobile Polish → F3 (drawer + card + sheet + modal-fullscreen)
- §5 Keyboard-Shortcuts → F4
- §6 File-Struktur → mapped across F1–F4
- §7 Error Handling → F1 + F2 (in fetchTranscript + UI states)
- §8 Testing → live smoke after every phase
- §9 Migration → mirrored as 5 phases
- §10 Out-of-Scope → respected (no AI, no DNS, no recordings)

**Placeholder scan:** No TBD/TODO. All code blocks complete.

**Type consistency:**
- `transcriptCache` shape `{state, transcript, error}` used identically across `fetchTranscript` and `render()`
- `TAB_KEYS` map maps strictly to existing hash routes from earlier phases
- `effectiveStatus(c)`, `isUrgent(c)`, `escapeHtml(s)`, `statusLabel(s)` all already exist in `ki.js` from previous phases — referenced not redefined
