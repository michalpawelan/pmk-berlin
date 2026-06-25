// admin/ki.js — KI-Tab Logic (Liste + Side-Panel mit Flag/Notiz).

const KI = (function() {
  let convos = [];
  let filterChannel = 'all';
  let filterStatus = 'all';
  let searchTerm = '';
  let rangeDays = 7;
  let selectedId = null;
  let loading = false;
  let transcriptCache = {};           // key = conversation_id, value = {state, transcript, error}

  const URGENT_KEYWORDS = [
    // PL
    'namaszczenie', 'umiera', 'umrzeć', 'umrzec', 'śmierc', 'smierc', 'śmierć', 'smierci',
    'pogrzeb', 'pilne', 'pilny', 'pilna', 'nagła', 'naglą', 'szpital', 'umar', 'zmarł', 'zmarl',
    'krwotok', 'wypadek', 'umarł', 'sakrament', 'hospicjum', 'reanimacja',
    // DE
    'krankenhaus', 'krankensalbung', 'sterbe', 'sterben', 'gestorben', 'verstorben', 'verstirbt',
    'beerdigung', 'beisetzung', 'notfall', 'dringend', 'seelsorge', 'palliativ', 'hospiz',
    'letzte ölung', 'sterbesakrament', 'unfall', 'intensivstation', 'todesfall',
    // EN
    'hospital', 'dying', 'died', 'funeral', 'urgent', 'emergency', 'last rites', 'palliative', 'hospice'
  ];

  function isUrgent(c) {
    const text = ((c.first_user_message || '') + ' ' + (c.call_summary_title || '')).toLowerCase();
    return URGENT_KEYWORDS.some(k => text.includes(k));
  }

  function effectiveStatus(c) {
    const flagStatus = c.flag?.status;
    const hasManualFlag = flagStatus && flagStatus !== 'unhandled';
    if (hasManualFlag) return flagStatus;
    if (isUrgent(c)) return 'unhandled';
    if (c.call_successful === 'success') return 'auto_ok';
    if (c.call_successful === 'failure') return 'check';
    return 'unhandled';
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  async function load() {
    const pin = Auth.getPin();
    if (!pin) { render(); return; }   // render even without PIN — shows empty state
    loading = true;
    render();
    try {
      const url = `/.netlify/functions/ki-conversations?days=${rangeDays}`;
      const res = await fetch(url, { headers: Auth.headers() });
      const data = await res.json();
      convos = (data && Array.isArray(data.conversations)) ? data.conversations : [];
    } catch (e) {
      convos = [];
    } finally {
      loading = false;
      render();
    }
  }

  function filtered() {
    return convos.filter(c => {
      if (filterChannel !== 'all' && c.channel !== filterChannel) return false;
      if (filterStatus !== 'all') {
        const eff = effectiveStatus(c);
        // "unhandled" filter = needs attention → includes both 'unhandled' and 'check'
        if (filterStatus === 'unhandled' && eff !== 'unhandled' && eff !== 'check') return false;
        if (filterStatus !== 'unhandled' && filterStatus !== eff) return false;
      }
      if (searchTerm && !(c.first_user_message || '').toLowerCase().includes(searchTerm.toLowerCase())) return false;
      return true;
    });
  }

  function fmtTime(iso) {
    if (!iso) return '';
    return new Date(iso).toLocaleString('pl-PL', { dateStyle: 'short', timeStyle: 'short' });
  }

  function statusLabel(s) {
    return {
      unhandled: 'Otwarte',
      done: 'Załatwione',
      followup: 'Follow-up',
      bad_answer: 'Zła odpowiedź',
      spam: 'Spam',
      auto_ok: '✓ Auto',
      check: '⚠ Sprawdź'
    }[s] || s;
  }

  async function saveFlag(conversationId, status, note) {
    const res = await fetch('/.netlify/functions/ki-flag', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...Auth.headers() },
      body: JSON.stringify({ conversation_id: conversationId, status, note })
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

  const ONBOARDING_KEY = 'pmk_ki_onboarded';

  async function fetchTranscript(conversationId) {
    if (transcriptCache[conversationId]?.state === 'ready') return;
    if (transcriptCache[conversationId]?.state === 'loading') return;
    transcriptCache[conversationId] = { state: 'loading' };
    render();
    try {
      const url = `/.netlify/functions/ki-transcript?id=${encodeURIComponent(conversationId)}`;
      const res = await fetch(url, { headers: Auth.headers() });
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

  function render() {
    const root = document.getElementById('tab-ki');
    if (!root) return;

    const rows = filtered();
    const selected = selectedId ? convos.find(c => c.conversation_id === selectedId) : null;
    const showOnboarding = !localStorage.getItem(ONBOARDING_KEY);

    root.innerHTML = `
      ${showOnboarding ? `
      <div class="ki-onboarding">
        <button class="ki-onboarding-close" aria-label="Zamknij">&times;</button>
        <h3>Jak korzystać z KI-Czatu</h3>
        <ul>
          <li><strong>Czerwone wiersze</strong> oznaczają pilne sprawy (namaszczenie, pogrzeb, śmierć).</li>
          <li><strong>Zaznacz pole</strong> z lewej, aby szybko oznaczyć rozmowę jako <em>załatwioną</em>.</li>
          <li><strong>Kliknij wiersz</strong>, aby otworzyć panel z transkryptem i notatką.</li>
          <li>Zmień <strong>Zakres</strong> (7/30/90 dni) z prawej, aby zobaczyć starsze rozmowy.</li>
          <li>💡 Naciśnij <kbd>?</kbd>, aby zobaczyć skróty klawiszowe.</li>
        </ul>
      </div>
      ` : ''}
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
        <input class="ki-search" placeholder="Szukaj w pytaniach…" value="${escapeHtml(searchTerm)}">
        <select class="ki-ch">
          <option value="all">Wszystkie kanały</option>
          <option value="chat"  ${filterChannel === 'chat'  ? 'selected' : ''}>💬 Czat</option>
          <option value="phone" ${filterChannel === 'phone' ? 'selected' : ''}>📞 Telefon</option>
        </select>
        <select class="ki-st">
          <option value="all">Wszystkie statusy</option>
          <option value="unhandled" ${filterStatus === 'unhandled'  ? 'selected' : ''}>Otwarte</option>
          <option value="auto_ok"   ${filterStatus === 'auto_ok'    ? 'selected' : ''}>✓ Auto</option>
          <option value="check"     ${filterStatus === 'check'      ? 'selected' : ''}>⚠ Sprawdź</option>
          <option value="done"      ${filterStatus === 'done'       ? 'selected' : ''}>Załatwione</option>
          <option value="followup"  ${filterStatus === 'followup'   ? 'selected' : ''}>Follow-up</option>
          <option value="bad_answer"${filterStatus === 'bad_answer' ? 'selected' : ''}>Zła odpowiedź</option>
          <option value="spam"      ${filterStatus === 'spam'       ? 'selected' : ''}>Spam</option>
        </select>
      </div>
      <div class="ki-legend">
        <span class="ki-legend-item"><span class="ki-status ki-status-auto_ok">✓ Auto</span> — bot załatwił sam</span>
        <span class="ki-legend-item"><span class="ki-status ki-status-unhandled">Otwarte</span> — wymaga uwagi</span>
        <span class="ki-legend-item"><span class="ki-status ki-status-check">⚠ Sprawdź</span> — bot nie odpowiedział</span>
        <span class="ki-legend-item"><span class="ki-status ki-status-done">Załatwione</span> — zrobione</span>
        <span class="ki-legend-item"><span class="ki-status ki-status-followup">Follow-up</span> — oddzwonić / mail</span>
        <span class="ki-legend-item"><span class="ki-status ki-status-bad_answer">Zła odpowiedź</span> — bot zły</span>
        <span class="ki-legend-item"><span class="ki-status ki-status-spam">Spam</span> — ignorować</span>
      </div>
      <table class="ki-table">
        <thead><tr>
          <th class="ki-check-col"></th>
          <th>Czas</th><th>Kanał</th><th>Język</th><th>Pierwsze pytanie</th><th>Status</th>
        </tr></thead>
        <tbody>
          ${rows.length === 0 ? (loading ? `
            <tr><td colspan="6" class="ki-loading">
              <div class="ki-spinner"></div>
              <span>Wczytywanie rozmów…</span>
            </td></tr>
          ` : `
            <tr><td colspan="6" class="ki-empty">Brak rozmów w tym okresie</td></tr>
          `) : rows.map(c => {
            const urgent = isUrgent(c);
            const eff = effectiveStatus(c);
            return `
              <tr data-id="${escapeHtml(c.conversation_id)}" class="ki-row ${urgent ? 'ki-row-urgent' : ''}">
                <td class="ki-check-cell">
                  <input type="checkbox" class="ki-row-check" data-id="${escapeHtml(c.conversation_id)}" ${c.flag?.status === 'done' ? 'checked' : ''}>
                </td>
                <td>${escapeHtml(fmtTime(c.started_at))}</td>
                <td>${c.channel === 'phone' ? '📞 Telefon' : '💬 Czat'}</td>
                <td>${escapeHtml((c.language || '').toUpperCase())}</td>
                <td class="ki-msg">${urgent ? '<span class="ki-urgent">🔴</span> ' : ''}${escapeHtml((c.first_user_message || '').slice(0, 80) || '—')}</td>
                <td><span class="ki-status ki-status-${eff}">${statusLabel(eff)}</span></td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>

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

      ${selected ? `
      <aside class="ki-panel" role="dialog" aria-label="Szczegóły rozmowy">
        <header>
          <h2>Rozmowa</h2>
          <button class="btn btn-ghost btn-sm ki-close">Zamknij</button>
        </header>
        <p class="ki-meta">${escapeHtml(fmtTime(selected.started_at))} · ${selected.channel === 'phone' ? '📞 Telefon' : '💬 Czat'} · ${escapeHtml((selected.language || '').toUpperCase())}</p>
        ${selected.channel === 'phone' ? `
          <div class="ki-audio">
            <audio controls preload="none" src="/.netlify/functions/ki-audio?id=${encodeURIComponent(selected.conversation_id)}&token=${encodeURIComponent(selected.audio_token || '')}"></audio>
          </div>
        ` : ''}
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
        <div class="ki-flags">
          <p class="ki-flags-label">Status:</p>
          ${['done', 'followup', 'bad_answer', 'spam'].map(st => `
            <button class="btn btn-ghost btn-sm ki-flag-btn ${selected.flag?.status === st ? 'active' : ''}" data-status="${st}">${statusLabel(st)}</button>
          `).join('')}
        </div>
        <textarea class="ki-note" rows="3" placeholder="Notatka (opcjonalna)…">${escapeHtml(selected.flag?.note)}</textarea>
        <button class="btn btn-accent btn-sm ki-save">Zapisz</button>
      </aside>
      ` : ''}
    `;

    const closeBtn = root.querySelector('.ki-onboarding-close');
    if (closeBtn) closeBtn.addEventListener('click', () => {
      localStorage.setItem(ONBOARDING_KEY, '1');
      render();
    });

    root.querySelector('.ki-search').addEventListener('input', e => { searchTerm = e.target.value; render(); });
    root.querySelector('.ki-ch').addEventListener('change', e => { filterChannel = e.target.value; render(); });
    root.querySelector('.ki-st').addEventListener('change', e => { filterStatus = e.target.value; render(); });
    root.querySelector('.ki-days').addEventListener('change', e => { rangeDays = parseInt(e.target.value, 10); load(); });
    root.querySelectorAll('.ki-row').forEach(r => r.addEventListener('click', (e) => {
      if (e.target.closest('.ki-check-cell')) return;   // checkbox click — ignore
      openPanel(r.dataset.id);
    }));
    root.querySelectorAll('.ki-row-check').forEach(cb => {
      cb.addEventListener('click', async (e) => {
        e.stopPropagation();   // don't open side panel
        const id = cb.dataset.id;
        const newStatus = cb.checked ? 'done' : 'unhandled';
        const ok = await saveFlag(id, newStatus, '');
        if (!ok) cb.checked = !cb.checked;   // revert on failure
        else render();   // re-render to update status badge
      });
    });
    root.querySelectorAll('.ki-mobile-card').forEach(card => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('input[type=checkbox]')) return;
        openPanel(card.dataset.id);
      });
    });

    const panel = root.querySelector('.ki-panel');
    if (panel) {
      panel.querySelector('.ki-close').addEventListener('click', closePanel);
      const transcriptToggle = panel.querySelector('.ki-transcript-toggle');
      if (transcriptToggle) {
        transcriptToggle.addEventListener('toggle', () => {
          selected.__transcriptOpen = transcriptToggle.open;
          if (transcriptToggle.open) fetchTranscript(selected.conversation_id);
        });
        const retryBtn = panel.querySelector('.ki-transcript-retry');
        if (retryBtn) retryBtn.addEventListener('click', () => fetchTranscript(retryBtn.dataset.id));
      }
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
