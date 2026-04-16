/**
 * PMK Berlin — custom chat UI backed by @elevenlabs/client (headless).
 * Full brand-styled floating launcher + chat panel, no native widget chrome.
 * The ElevenLabs agent (voice+text) runs unchanged — we only replace the UI.
 */
import { Conversation } from 'https://esm.sh/@elevenlabs/client@1.2.1';

const AGENT_ID = 'agent_4101kpbhjmptftzr7tscfxk639fq';
const PHONE_NUMBER = '+493075938358';
const PHONE_TEL = 'tel:+493075938358';
const AVATAR_URL = 'images/apple-touch-icon.png';

// -----------------------------------------------------------------------------
// i18n
// -----------------------------------------------------------------------------
const I18N = {
  pl: {
    launcher_title: 'Masz pytania?',
    launcher_sub: 'Napisz do nas',
    header_name: 'Marta',
    header_role: 'PMK Berlin',
    close: 'Zamknij',
    call_tooltip: 'Zadzwoń do parafii',
    input_placeholder: 'Napisz wiadomość…',
    send: 'Wyślij',
    connecting: 'Łączę…',
    connection_error: 'Chwilowy problem z połączeniem. Napisz jeszcze raz albo zadzwoń.',
    greeting: 'Szczęść Boże! Jestem Marta z Polskiej Misji Katolickiej w Berlinie. W czym mogę pomóc?',
    chips_title: 'Popularne pytania',
    chips: [
      { icon: '⛪', label: 'Msze Święte',  text: 'Kiedy są Msze Święte?' },
      { icon: '🕯️', label: 'Sakramenty',   text: 'Jakie sakramenty oferujecie?' },
      { icon: '📅', label: 'Wydarzenia',   text: 'Jakie są najbliższe wydarzenia w parafii?' },
      { icon: '👶', label: 'Chrzest',      text: 'Chcę ochrzcić dziecko – co potrzebuję?' },
      { icon: '💒', label: 'Ślub',          text: 'Chcemy wziąć ślub kościelny – jak się przygotować?' },
      { icon: '📍', label: 'Kontakt',       text: 'Jak mogę się z wami skontaktować?' }
    ]
  },
  de: {
    launcher_title: 'Haben Sie Fragen?',
    launcher_sub: 'Schreiben Sie uns',
    header_name: 'Marta',
    header_role: 'PMK Berlin',
    close: 'Schließen',
    call_tooltip: 'Die Pfarrei anrufen',
    input_placeholder: 'Nachricht schreiben…',
    send: 'Senden',
    connecting: 'Verbinde…',
    connection_error: 'Vorübergehender Verbindungsfehler. Bitte erneut versuchen oder anrufen.',
    greeting: 'Grüß Gott! Ich bin Marta von der Polnischen Katholischen Mission in Berlin. Wie kann ich helfen?',
    chips_title: 'Häufige Fragen',
    chips: [
      { icon: '⛪', label: 'Messzeiten',       text: 'Wann sind die Messen?' },
      { icon: '🕯️', label: 'Sakramente',       text: 'Welche Sakramente bieten Sie an?' },
      { icon: '📅', label: 'Veranstaltungen',  text: 'Welche Veranstaltungen gibt es in der Pfarrei?' },
      { icon: '👶', label: 'Taufe',             text: 'Ich möchte mein Kind taufen lassen — was brauche ich?' },
      { icon: '💒', label: 'Hochzeit',          text: 'Wir möchten kirchlich heiraten — wie bereiten wir uns vor?' },
      { icon: '📍', label: 'Kontakt',           text: 'Wie erreiche ich die Pfarrei?' }
    ]
  },
  en: {
    launcher_title: 'Any questions?',
    launcher_sub: 'Message us',
    header_name: 'Marta',
    header_role: 'PMK Berlin',
    close: 'Close',
    call_tooltip: 'Call the parish',
    input_placeholder: 'Type a message…',
    send: 'Send',
    connecting: 'Connecting…',
    connection_error: 'Temporary connection issue. Please try again or call us.',
    greeting: 'Hello! I\'m Marta from the Polish Catholic Mission in Berlin. How can I help?',
    chips_title: 'Common questions',
    chips: [
      { icon: '⛪', label: 'Mass times',    text: 'When are the Masses?' },
      { icon: '🕯️', label: 'Sacraments',   text: 'What sacraments do you offer?' },
      { icon: '📅', label: 'Events',        text: 'What events are coming up?' },
      { icon: '👶', label: 'Baptism',       text: 'I want to baptise my child — what do I need?' },
      { icon: '💒', label: 'Wedding',       text: 'We want a church wedding — how do we prepare?' },
      { icon: '📍', label: 'Contact',        text: 'How can I contact the parish?' }
    ]
  }
};

function currentLang() {
  const active = document.querySelector('.lang-btn.active');
  if (active && active.dataset.lang) return active.dataset.lang;
  try {
    const s = localStorage.getItem('pmk-lang');
    if (s && I18N[s]) return s;
  } catch (e) {}
  const htmlLang = (document.documentElement.lang || 'pl').slice(0, 2);
  return I18N[htmlLang] ? htmlLang : 'pl';
}

function t(key) {
  const lang = currentLang();
  return (I18N[lang] && I18N[lang][key]) || I18N.pl[key];
}

// -----------------------------------------------------------------------------
// CSS
// -----------------------------------------------------------------------------
const CSS = `
  :root {
    --pmk-cream: #faf8f5;
    --pmk-cream-2: #f5f2ed;
    --pmk-border: #e4dcd1;
    --pmk-border-soft: #f0ebe4;
    --pmk-gold: #a68b5b;
    --pmk-gold-dark: #8a7248;
    --pmk-gold-soft: #f5efe2;
    --pmk-ink: #3d3731;
    --pmk-ink-soft: #7a6d5c;
    --pmk-ink-muted: #a59a8a;
    --pmk-shadow-sm: 0 4px 12px rgba(31, 28, 24, 0.06);
    --pmk-shadow-md: 0 12px 32px rgba(31, 28, 24, 0.10), 0 4px 8px rgba(31, 28, 24, 0.04);
    --pmk-shadow-lg: 0 24px 48px rgba(31, 28, 24, 0.14), 0 6px 12px rgba(31, 28, 24, 0.06);
  }

  /* ================= LAUNCHER (closed state) ================= */
  .pmk-launcher {
    position: fixed;
    bottom: 24px;
    right: 24px;
    z-index: 2147483000;
    display: inline-flex;
    align-items: center;
    gap: 12px;
    padding: 10px 22px 10px 10px;
    background: var(--pmk-cream);
    border: 1px solid var(--pmk-border);
    border-radius: 999px;
    box-shadow: var(--pmk-shadow-md);
    font-family: 'Outfit', -apple-system, BlinkMacSystemFont, sans-serif;
    cursor: pointer;
    opacity: 0;
    transform: translateY(14px);
    transition: opacity 240ms ease, transform 240ms ease, box-shadow 200ms ease;
  }
  .pmk-launcher.is-ready { opacity: 1; transform: translateY(0); }
  .pmk-launcher:hover { box-shadow: var(--pmk-shadow-lg); transform: translateY(-2px); }
  .pmk-launcher:focus-visible { outline: 2px solid var(--pmk-gold); outline-offset: 3px; }
  .pmk-launcher.is-hidden {
    opacity: 0; pointer-events: none; transform: translateY(14px) scale(0.96);
  }
  .pmk-launcher-avatar {
    position: relative;
    width: 44px; height: 44px;
    border-radius: 50%;
    background: #ffffff;
    overflow: hidden; flex-shrink: 0;
    box-shadow: inset 0 0 0 1px var(--pmk-border-soft);
  }
  .pmk-launcher-avatar img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .pmk-launcher-dot {
    position: absolute; bottom: 2px; right: 2px;
    width: 10px; height: 10px;
    background: #5c9a66;
    border: 2px solid var(--pmk-cream);
    border-radius: 50%;
    box-shadow: 0 0 0 0 rgba(92, 154, 102, 0.55);
    animation: pmk-pulse 2.2s ease-out infinite;
  }
  @keyframes pmk-pulse {
    0%   { box-shadow: 0 0 0 0   rgba(92, 154, 102, 0.55); }
    70%  { box-shadow: 0 0 0 8px rgba(92, 154, 102, 0); }
    100% { box-shadow: 0 0 0 0   rgba(92, 154, 102, 0); }
  }
  .pmk-launcher-text { display: flex; flex-direction: column; align-items: flex-start; line-height: 1.25; white-space: nowrap; }
  .pmk-launcher-title { font-size: 0.95rem; font-weight: 500; color: var(--pmk-ink); letter-spacing: -0.005em; }
  .pmk-launcher-sub { font-size: 0.78rem; font-weight: 400; color: var(--pmk-gold); margin-top: 1px; }

  /* ================= PANEL (open state) ================= */
  .pmk-panel {
    position: fixed;
    bottom: 24px;
    right: 24px;
    z-index: 2147483001;
    width: 380px;
    max-width: calc(100vw - 32px);
    height: 580px;
    max-height: calc(100vh - 48px);
    background: var(--pmk-cream);
    border: 1px solid var(--pmk-border);
    border-radius: 22px;
    box-shadow: var(--pmk-shadow-lg);
    display: flex; flex-direction: column;
    overflow: hidden;
    font-family: 'Outfit', -apple-system, BlinkMacSystemFont, sans-serif;
    color: var(--pmk-ink);
    opacity: 0;
    transform: translateY(18px) scale(0.98);
    pointer-events: none;
    transition: opacity 240ms ease, transform 240ms ease;
  }
  .pmk-panel.is-open { opacity: 1; transform: translateY(0) scale(1); pointer-events: auto; }

  /* Header */
  .pmk-header {
    display: flex; align-items: center;
    gap: 12px;
    padding: 16px 18px;
    background: #ffffff;
    border-bottom: 1px solid var(--pmk-border-soft);
  }
  .pmk-header-avatar {
    width: 40px; height: 40px; border-radius: 50%;
    background: var(--pmk-cream); overflow: hidden;
    box-shadow: inset 0 0 0 1px var(--pmk-border-soft);
    flex-shrink: 0;
  }
  .pmk-header-avatar img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .pmk-header-text { flex: 1; display: flex; flex-direction: column; line-height: 1.2; min-width: 0; }
  .pmk-header-name { font-family: 'Cormorant', Georgia, serif; font-weight: 500; font-size: 1.15rem; color: var(--pmk-ink); letter-spacing: -0.01em; }
  .pmk-header-role { font-size: 0.75rem; color: var(--pmk-gold); font-weight: 400; margin-top: 1px; }
  .pmk-header-actions { display: flex; align-items: center; gap: 4px; }
  .pmk-icon-btn {
    width: 36px; height: 36px;
    border-radius: 50%;
    border: none; background: transparent;
    color: var(--pmk-ink-soft);
    display: inline-flex; align-items: center; justify-content: center;
    cursor: pointer;
    transition: background 180ms ease, color 180ms ease;
    text-decoration: none;
  }
  .pmk-icon-btn:hover { background: var(--pmk-cream); color: var(--pmk-gold); }
  .pmk-icon-btn:focus-visible { outline: 2px solid var(--pmk-gold); outline-offset: 2px; }
  .pmk-icon-btn svg { width: 20px; height: 20px; }

  /* Body */
  .pmk-body {
    flex: 1;
    overflow-y: auto;
    padding: 18px 18px 8px;
    display: flex; flex-direction: column;
    gap: 10px;
    scroll-behavior: smooth;
  }
  .pmk-body::-webkit-scrollbar { width: 6px; }
  .pmk-body::-webkit-scrollbar-track { background: transparent; }
  .pmk-body::-webkit-scrollbar-thumb { background: var(--pmk-border); border-radius: 999px; }

  /* Empty state: greeting + chips */
  .pmk-empty {
    padding: 6px 2px 14px;
    display: flex; flex-direction: column; gap: 14px;
  }
  .pmk-greeting {
    font-size: 0.98rem;
    line-height: 1.5;
    color: var(--pmk-ink);
  }
  .pmk-chips-title {
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--pmk-ink-muted);
    font-weight: 500;
    margin-bottom: 2px;
  }
  .pmk-chips {
    display: flex; flex-wrap: wrap;
    gap: 8px;
  }
  .pmk-chip {
    display: inline-flex; align-items: center; gap: 8px;
    padding: 9px 14px;
    background: #ffffff;
    border: 1px solid var(--pmk-border);
    border-radius: 999px;
    font-family: inherit;
    font-size: 0.85rem;
    color: var(--pmk-ink);
    cursor: pointer;
    transition: background 180ms ease, border-color 180ms ease, transform 180ms ease;
  }
  .pmk-chip:hover { background: var(--pmk-gold-soft); border-color: var(--pmk-gold); transform: translateY(-1px); }
  .pmk-chip:focus-visible { outline: 2px solid var(--pmk-gold); outline-offset: 2px; }
  .pmk-chip-icon { font-size: 1rem; line-height: 1; }

  /* Messages */
  .pmk-msg {
    display: flex; gap: 8px;
    max-width: 100%;
    animation: pmk-msg-in 260ms ease;
  }
  @keyframes pmk-msg-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }

  .pmk-msg-agent { align-self: flex-start; }
  .pmk-msg-user  { align-self: flex-end; flex-direction: row-reverse; }

  .pmk-msg-avatar {
    width: 28px; height: 28px; border-radius: 50%;
    background: var(--pmk-cream);
    overflow: hidden;
    flex-shrink: 0;
    box-shadow: inset 0 0 0 1px var(--pmk-border-soft);
    align-self: flex-end;
    margin-bottom: 2px;
  }
  .pmk-msg-avatar img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .pmk-msg-user .pmk-msg-avatar { display: none; }

  .pmk-msg-bubble {
    padding: 10px 14px;
    border-radius: 16px;
    font-size: 0.94rem;
    line-height: 1.5;
    max-width: 84%;
    word-wrap: break-word;
    white-space: pre-wrap;
  }
  .pmk-msg-agent .pmk-msg-bubble {
    background: #ffffff;
    color: var(--pmk-ink);
    border: 1px solid var(--pmk-border-soft);
    border-bottom-left-radius: 6px;
  }
  .pmk-msg-user .pmk-msg-bubble {
    background: var(--pmk-gold);
    color: #ffffff;
    border-bottom-right-radius: 6px;
  }
  .pmk-msg-typing .pmk-msg-bubble {
    display: inline-flex; align-items: center; gap: 4px;
    padding: 14px 16px;
  }
  .pmk-dot {
    width: 6px; height: 6px; border-radius: 50%;
    background: var(--pmk-ink-muted);
    animation: pmk-bounce 1.2s infinite ease-in-out;
  }
  .pmk-dot:nth-child(2) { animation-delay: 0.15s; }
  .pmk-dot:nth-child(3) { animation-delay: 0.3s; }
  @keyframes pmk-bounce {
    0%, 60%, 100% { transform: translateY(0); opacity: 0.4; }
    30% { transform: translateY(-4px); opacity: 1; }
  }

  .pmk-status {
    font-size: 0.76rem;
    color: var(--pmk-ink-muted);
    text-align: center;
    padding: 4px 0;
  }
  .pmk-status.is-error { color: #b5664d; }

  /* Input */
  .pmk-footer {
    border-top: 1px solid var(--pmk-border-soft);
    background: #ffffff;
    padding: 10px 10px 10px 16px;
    display: flex; align-items: center;
    gap: 8px;
  }
  .pmk-input {
    flex: 1;
    border: none;
    background: transparent;
    font-family: inherit;
    font-size: 0.95rem;
    color: var(--pmk-ink);
    resize: none;
    outline: none;
    padding: 8px 0;
    line-height: 1.4;
    max-height: 100px;
  }
  .pmk-input::placeholder { color: var(--pmk-ink-muted); }
  .pmk-send-btn {
    width: 38px; height: 38px;
    border: none;
    border-radius: 50%;
    background: var(--pmk-gold);
    color: #ffffff;
    cursor: pointer;
    display: inline-flex; align-items: center; justify-content: center;
    transition: background 180ms ease, transform 180ms ease;
    flex-shrink: 0;
  }
  .pmk-send-btn:hover:not(:disabled) { background: var(--pmk-gold-dark); transform: translateY(-1px); }
  .pmk-send-btn:disabled { background: var(--pmk-border); cursor: not-allowed; }
  .pmk-send-btn:focus-visible { outline: 2px solid var(--pmk-gold); outline-offset: 2px; }
  .pmk-send-btn svg { width: 18px; height: 18px; }

  /* Mobile */
  @media (max-width: 540px) {
    .pmk-launcher { bottom: 16px; right: 16px; padding: 8px 18px 8px 8px; gap: 10px; }
    .pmk-launcher-avatar { width: 38px; height: 38px; }
    .pmk-launcher-title { font-size: 0.88rem; }
    .pmk-launcher-sub { font-size: 0.72rem; }
    .pmk-panel {
      width: 100vw; height: 100dvh; max-height: 100dvh;
      bottom: 0; right: 0;
      border-radius: 0; border: none;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .pmk-launcher, .pmk-panel, .pmk-msg, .pmk-launcher-dot, .pmk-chip, .pmk-send-btn {
      animation: none !important;
      transition: none !important;
    }
  }
`;

function injectCSS() {
  if (document.getElementById('pmk-chat-styles')) return;
  const s = document.createElement('style');
  s.id = 'pmk-chat-styles';
  s.textContent = CSS;
  document.head.appendChild(s);
}

// -----------------------------------------------------------------------------
// Icons (inline SVG)
// -----------------------------------------------------------------------------
const ICON_CLOSE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>';
const ICON_PHONE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.37 1.9.72 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.35 1.85.59 2.81.72A2 2 0 0 1 22 16.92z"/></svg>';
const ICON_SEND  = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>';

function escapeHTML(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Light markdown: **bold**, *italic*, [text](url), newlines
function renderRich(text) {
  let html = escapeHTML(text);
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  html = html.replace(/\[([^\]]+)\]\(((?:https?:\/\/|mailto:|tel:)[^)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener" style="color:inherit;text-decoration:underline">$1</a>');
  html = html.replace(/\n/g, '<br>');
  return html;
}

// -----------------------------------------------------------------------------
// State + DOM refs
// -----------------------------------------------------------------------------
const state = {
  isOpen: false,
  conversation: null,
  connecting: false,
  messages: [],
  pendingAgentEventId: null
};
const els = {};

// -----------------------------------------------------------------------------
// Mount
// -----------------------------------------------------------------------------
function buildLauncher() {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.id = 'pmkLauncher';
  btn.className = 'pmk-launcher';
  btn.setAttribute('aria-label', t('launcher_title') + ' — ' + t('launcher_sub'));
  btn.innerHTML =
    '<span class="pmk-launcher-avatar">' +
      '<img src="' + AVATAR_URL + '" alt="" width="44" height="44" loading="lazy">' +
      '<span class="pmk-launcher-dot" aria-hidden="true"></span>' +
    '</span>' +
    '<span class="pmk-launcher-text">' +
      '<span class="pmk-launcher-title"></span>' +
      '<span class="pmk-launcher-sub"></span>' +
    '</span>';
  btn.querySelector('.pmk-launcher-title').textContent = t('launcher_title');
  btn.querySelector('.pmk-launcher-sub').textContent = t('launcher_sub');
  btn.addEventListener('click', openChat);
  document.body.appendChild(btn);
  requestAnimationFrame(() => btn.classList.add('is-ready'));
  return btn;
}

function buildPanel() {
  const panel = document.createElement('section');
  panel.id = 'pmkPanel';
  panel.className = 'pmk-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Marta — ' + t('header_role'));

  panel.innerHTML =
    '<header class="pmk-header">' +
      '<span class="pmk-header-avatar">' +
        '<img src="' + AVATAR_URL + '" alt="" width="40" height="40">' +
      '</span>' +
      '<span class="pmk-header-text">' +
        '<span class="pmk-header-name">' + t('header_name') + '</span>' +
        '<span class="pmk-header-role">' + t('header_role') + '</span>' +
      '</span>' +
      '<span class="pmk-header-actions">' +
        '<a href="' + PHONE_TEL + '" class="pmk-icon-btn" title="' + t('call_tooltip') + '" aria-label="' + t('call_tooltip') + '">' + ICON_PHONE + '</a>' +
        '<button type="button" class="pmk-icon-btn" id="pmkClose" title="' + t('close') + '" aria-label="' + t('close') + '">' + ICON_CLOSE + '</button>' +
      '</span>' +
    '</header>' +
    '<div class="pmk-body" id="pmkBody">' +
      '<div class="pmk-empty" id="pmkEmpty">' +
        '<p class="pmk-greeting">' + escapeHTML(t('greeting')) + '</p>' +
        '<div>' +
          '<div class="pmk-chips-title">' + escapeHTML(t('chips_title')) + '</div>' +
          '<div class="pmk-chips" id="pmkChips"></div>' +
        '</div>' +
      '</div>' +
    '</div>' +
    '<form class="pmk-footer" id="pmkForm">' +
      '<textarea class="pmk-input" id="pmkInput" rows="1" placeholder="' + t('input_placeholder') + '" aria-label="' + t('input_placeholder') + '"></textarea>' +
      '<button type="submit" class="pmk-send-btn" id="pmkSend" aria-label="' + t('send') + '" disabled>' + ICON_SEND + '</button>' +
    '</form>';
  document.body.appendChild(panel);

  els.panel = panel;
  els.body = panel.querySelector('#pmkBody');
  els.empty = panel.querySelector('#pmkEmpty');
  els.chips = panel.querySelector('#pmkChips');
  els.form = panel.querySelector('#pmkForm');
  els.input = panel.querySelector('#pmkInput');
  els.send = panel.querySelector('#pmkSend');

  panel.querySelector('#pmkClose').addEventListener('click', closeChat);

  // Render chips
  const chips = t('chips');
  chips.forEach(c => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pmk-chip';
    btn.innerHTML = '<span class="pmk-chip-icon">' + escapeHTML(c.icon) + '</span> ' + escapeHTML(c.label);
    btn.addEventListener('click', () => {
      sendMessage(c.text);
    });
    els.chips.appendChild(btn);
  });

  // Input behaviour
  const autosize = () => {
    els.input.style.height = 'auto';
    els.input.style.height = Math.min(els.input.scrollHeight, 100) + 'px';
    els.send.disabled = els.input.value.trim().length === 0;
  };
  els.input.addEventListener('input', autosize);
  els.input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (els.input.value.trim()) sendMessage(els.input.value.trim());
    }
  });
  els.form.addEventListener('submit', (e) => {
    e.preventDefault();
    const v = els.input.value.trim();
    if (v) sendMessage(v);
  });

  return panel;
}

// -----------------------------------------------------------------------------
// Conversation lifecycle
// -----------------------------------------------------------------------------
async function ensureConversation() {
  if (state.conversation || state.connecting) return state.conversation;
  state.connecting = true;
  showStatus(t('connecting'));
  try {
    state.conversation = await Conversation.startSession({
      agentId: AGENT_ID,
      connectionType: 'websocket',
      textOnly: true,
      overrides: {
        agent: { language: currentLang() }
      },
      onConnect: () => { hideStatus(); },
      onDisconnect: () => {
        state.conversation = null;
        hideTyping();
      },
      onError: (err, ctx) => {
        console.error('PMK Chat error:', err, ctx);
        showStatus(t('connection_error'), true);
      },
      onMessage: ({ source, message }) => {
        // source "ai" = agent, source "user" = echoed user transcript
        if (source === 'ai' && message) {
          hideTyping();
          appendMessage('agent', message);
        }
      },
      onModeChange: ({ mode }) => {
        if (mode === 'speaking' || mode === 'thinking') showTyping();
        else hideTyping();
      }
    });
  } catch (e) {
    console.error('PMK Chat startSession failed:', e);
    showStatus(t('connection_error'), true);
    state.conversation = null;
  } finally {
    state.connecting = false;
  }
  return state.conversation;
}

async function sendMessage(text) {
  if (!text) return;
  appendMessage('user', text);
  els.input.value = '';
  els.input.style.height = 'auto';
  els.send.disabled = true;
  hideEmpty();
  showTyping();
  const conv = await ensureConversation();
  if (!conv) { hideTyping(); return; }
  try {
    // sendUserMessage for text-only conversations
    if (typeof conv.sendUserMessage === 'function') {
      conv.sendUserMessage(text);
    } else if (typeof conv.sendContextualUpdate === 'function') {
      conv.sendContextualUpdate(text);
    }
  } catch (e) {
    console.error('PMK Chat sendMessage failed:', e);
    hideTyping();
    showStatus(t('connection_error'), true);
  }
}

// -----------------------------------------------------------------------------
// DOM helpers
// -----------------------------------------------------------------------------
function hideEmpty() {
  if (els.empty && els.empty.parentNode) {
    els.empty.style.display = 'none';
  }
}
function showEmpty() {
  if (els.empty) els.empty.style.display = '';
}

function appendMessage(role, text) {
  state.messages.push({ role, text });
  const div = document.createElement('div');
  div.className = 'pmk-msg pmk-msg-' + role;
  const avatarSrc = role === 'agent' ? AVATAR_URL : '';
  div.innerHTML =
    (role === 'agent' ? '<span class="pmk-msg-avatar"><img src="' + avatarSrc + '" alt=""></span>' : '') +
    '<div class="pmk-msg-bubble">' + renderRich(text) + '</div>';
  els.body.appendChild(div);
  scrollToBottom();
}

function showTyping() {
  if (document.getElementById('pmkTyping')) return;
  const div = document.createElement('div');
  div.className = 'pmk-msg pmk-msg-agent pmk-msg-typing';
  div.id = 'pmkTyping';
  div.innerHTML =
    '<span class="pmk-msg-avatar"><img src="' + AVATAR_URL + '" alt=""></span>' +
    '<div class="pmk-msg-bubble"><span class="pmk-dot"></span><span class="pmk-dot"></span><span class="pmk-dot"></span></div>';
  els.body.appendChild(div);
  scrollToBottom();
}
function hideTyping() {
  const t = document.getElementById('pmkTyping');
  if (t) t.remove();
}

function showStatus(text, isError) {
  let s = document.getElementById('pmkStatus');
  if (!s) {
    s = document.createElement('div');
    s.id = 'pmkStatus';
    s.className = 'pmk-status';
    els.body.appendChild(s);
  }
  s.textContent = text;
  s.classList.toggle('is-error', !!isError);
}
function hideStatus() {
  const s = document.getElementById('pmkStatus');
  if (s) s.remove();
}

function scrollToBottom() {
  requestAnimationFrame(() => {
    els.body.scrollTop = els.body.scrollHeight;
  });
}

// -----------------------------------------------------------------------------
// Open / close
// -----------------------------------------------------------------------------
function openChat() {
  if (state.isOpen) return;
  state.isOpen = true;
  els.launcher.classList.add('is-hidden');
  els.panel.classList.add('is-open');
  setTimeout(() => { els.input.focus(); }, 250);
}

async function closeChat() {
  if (!state.isOpen) return;
  state.isOpen = false;
  els.panel.classList.remove('is-open');
  els.launcher.classList.remove('is-hidden');
  if (state.conversation) {
    try { await state.conversation.endSession(); } catch (e) {}
    state.conversation = null;
  }
  // Reset state for next open
  state.messages = [];
  if (els.body) {
    // Remove all message nodes but keep empty state markup
    Array.from(els.body.children).forEach(c => {
      if (c.id !== 'pmkEmpty') c.remove();
    });
    showEmpty();
  }
  hideStatus();
  hideTyping();
}

// -----------------------------------------------------------------------------
// Language switch handling
// -----------------------------------------------------------------------------
function handleLanguageChange() {
  document.querySelectorAll('.lang-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      // If user switches language while chat is closed, re-render labels.
      // If open, leave current conversation as-is (they can close+reopen).
      if (!state.isOpen && els.launcher) {
        const title = els.launcher.querySelector('.pmk-launcher-title');
        const sub = els.launcher.querySelector('.pmk-launcher-sub');
        if (title) title.textContent = t('launcher_title');
        if (sub) sub.textContent = t('launcher_sub');
        els.launcher.setAttribute('aria-label', t('launcher_title') + ' — ' + t('launcher_sub'));
      }
    });
  });
}

// -----------------------------------------------------------------------------
// Init
// -----------------------------------------------------------------------------
function init() {
  injectCSS();
  els.launcher = buildLauncher();
  buildPanel();
  handleLanguageChange();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
