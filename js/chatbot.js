/**
 * PMK Berlin - Chatbot Integration (n8n Webhook)
 * Bei Problemen: E-Mail an pmk@pmk-berlin.de
 */
(function() {
  'use strict';

  // N8N WEBHOOK URL
  const WEBHOOK_URL = 'https://michal1234567.app.n8n.cloud/webhook/248af9e0-2a84-4805-adf2-9fef31096fea/chat';

  const CONTACT_EMAIL = 'pmk@pmk-berlin.de';
  const CONTACT_PHONE = '+49 (30) 752 40 80';

  const fab = document.getElementById('chatbotFab');
  const win = document.getElementById('chatbotWindow');
  const closeBtn = document.getElementById('chatbotClose');
  const form = document.getElementById('chatbotForm');
  const input = document.getElementById('chatbotInputField');
  const messages = document.getElementById('chatbotMessages');

  if (!fab || !win) return;

  // Overlay zum Schliessen per Klick daneben
  const overlay = document.createElement('div');
  overlay.className = 'chatbot-overlay';
  document.body.appendChild(overlay);

  let sessionId = 'pmk-' + Math.random().toString(36).substr(2, 9);
  let quickRepliesShown = false;

  // Quick-Reply Optionen
  const QUICK_REPLIES = [
    { icon: '⛪', label: 'Msze Święte', text: 'Kiedy są Msze Święte?' },
    { icon: '🕯️', label: 'Sakramenty', text: 'Jakie sakramenty oferujecie?' },
    { icon: '📅', label: 'Wydarzenia', text: 'Jakie są najbliższe wydarzenia?' },
    { icon: '📍', label: 'Kontakt', text: 'Jak mogę się z wami skontaktować?' },
    { icon: '👶', label: 'Chrzest', text: 'Chcę ochrzcić dziecko – co potrzebuję?' },
    { icon: '💒', label: 'Ślub', text: 'Chcemy wziąć ślub kościelny – jak się przygotować?' }
  ];

  function showQuickReplies() {
    if (quickRepliesShown) return;
    quickRepliesShown = true;

    const container = document.createElement('div');
    container.className = 'chatbot-quick-replies';

    QUICK_REPLIES.forEach(qr => {
      const btn = document.createElement('button');
      btn.className = 'chatbot-qr-btn';
      btn.innerHTML = '<span class="chatbot-qr-icon">' + qr.icon + '</span> ' + qr.label;
      btn.addEventListener('click', () => {
        container.remove();
        input.value = qr.text;
        form.dispatchEvent(new Event('submit'));
      });
      container.appendChild(btn);
    });

    messages.appendChild(container);
    messages.scrollTop = messages.scrollHeight;
  }

  function openChat() {
    win.classList.add('open');
    overlay.classList.add('open');
    fab.style.display = 'none';
    input.focus();

    // Willkommensnachricht + Quick Replies beim ersten Öffnen
    if (!quickRepliesShown) {
      addMessage('Witaj! 👋 Jestem asystentem PMK Berlin. Jak mogę Ci pomóc?', 'bot');
      showQuickReplies();
    }
  }

  function closeChat() {
    win.classList.remove('open');
    overlay.classList.remove('open');
    fab.style.display = 'flex';
  }

  fab.addEventListener('click', openChat);
  closeBtn.addEventListener('click', closeChat);
  overlay.addEventListener('click', closeChat);

  // Nachricht senden
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;

    addMessage(text, 'user');
    input.value = '';

    const typing = addMessage('...', 'bot');
    typing.classList.add('chatbot-typing');

    try {
      const res = await fetch(WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'sendMessage',
          sessionId: sessionId,
          chatInput: text
        })
      });

      const data = await res.json();
      typing.remove();

      const reply = data.output || data.text || data.response || '';

      if (!reply || detectUnresolved(reply)) {
        // Bot konnte nicht helfen - einfach auf E-Mail verweisen
        const msg = reply
          ? reply + '\n\nJesli potrzebujesz dodatkowej pomocy, napisz do nas: <a href="mailto:' + CONTACT_EMAIL + '">' + CONTACT_EMAIL + '</a>'
          : 'Przepraszam, nie mam odpowiedzi na to pytanie. Napisz do nas na <a href="mailto:' + CONTACT_EMAIL + '">' + CONTACT_EMAIL + '</a> — postaramy sie odpowiedziec jak najszybciej!';
        addMessage(msg, 'bot');
      } else {
        addMessage(reply, 'bot');
      }
    } catch (err) {
      typing.remove();
      addMessage('Przepraszam, cos poszlo nie tak. Napisz do nas na <a href="mailto:' + CONTACT_EMAIL + '">' + CONTACT_EMAIL + '</a> lub zadzwon: ' + CONTACT_PHONE, 'bot');
    }
  });

  function detectUnresolved(reply) {
    if (!reply) return true;
    const phrases = [
      'nie wiem', 'nie mam informacji', 'nie jestem w stanie',
      'nie moge odpowiedziec', 'nie mam pewnosci', 'prosze skontaktowac',
      'prosze zadzwonic', 'nie posiadam', 'nie znam odpowiedzi',
      'I don\'t know', 'I\'m not sure', 'I cannot answer', 'contact the parish'
    ];
    const lower = reply.toLowerCase();
    return phrases.some(p => lower.includes(p));
  }

  // Markdown-Rohtext in sauberes HTML umwandeln
  function formatBotReply(text) {
    let html = text;

    // ### Überschriften → fett auf eigener Zeile
    html = html.replace(/###\s*(.+)/g, '<strong>$1</strong>');
    // **fett** → <strong>
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    // *kursiv* → <em>
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
    // [text](url) → klickbare Links
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    // - Listenpunkte → saubere Zeilen mit Punkt
    html = html.replace(/^- /gm, '• ');
    // Zeilenumbrüche
    html = html.replace(/\n/g, '<br>');
    // Doppelte <br> für Absätze etwas Luft geben
    html = html.replace(/(<br>){3,}/g, '<br><br>');

    return html;
  }

  function addMessage(text, type) {
    const div = document.createElement('div');
    div.className = 'chatbot-msg chatbot-msg-' + (type === 'user' ? 'user' : 'bot');
    const formatted = type === 'bot' ? formatBotReply(text) : text.replace(/\n/g, '<br>');
    div.innerHTML = '<p>' + formatted + '</p>';
    messages.appendChild(div);
    messages.scrollTop = messages.scrollHeight;
    return div;
  }
})();
