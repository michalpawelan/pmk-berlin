// admin/ki.js — KI-Tab Logic (Liste + Side-Panel mit Flag/Notiz).

const KI = (function() {
  let convos = [];
  let filterChannel = 'all';
  let filterStatus = 'all';
  let searchTerm = '';
  let rangeDays = 7;
  let selectedId = null;
  let loading = false;

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
      const url = `/.netlify/functions/ki-conversations?pin=${encodeURIComponent(pin)}&days=${rangeDays}`;
      const res = await fetch(url);
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
        <input class="ki-search" placeholder="Szukaj w pytaniach…" value="${escapeHtml(searchTerm)}">
        <select class="ki-ch">
          <option value="all">Wszystkie kanały</option>
          <option value="chat"  ${filterChannel === 'chat'  ? 'selected' : ''}>💬 Czat</option>
          <option value="phone" ${filterChannel === 'phone' ? 'selected' : ''}>📞 Telefon</option>
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
        <thead><tr><th>Czas</th><th>Kanał</th><th>Język</th><th>Pierwsze pytanie</th><th>Status</th></tr></thead>
        <tbody>
          ${rows.length === 0 ? `
            <tr><td colspan="5" class="ki-empty">${loading ? 'Wczytywanie…' : 'Brak rozmów w tym okresie'}</td></tr>
          ` : rows.map(c => `
            <tr data-id="${escapeHtml(c.conversation_id)}" class="ki-row">
              <td>${escapeHtml(fmtTime(c.started_at))}</td>
              <td>${c.channel === 'phone' ? '📞 Telefon' : '💬 Czat'}</td>
              <td>${escapeHtml((c.language || '').toUpperCase())}</td>
              <td class="ki-msg">${escapeHtml((c.first_user_message || '').slice(0, 80)) || '<em>—</em>'}</td>
              <td><span class="ki-status ki-status-${c.flag?.status || 'unhandled'}">${statusLabel(c.flag?.status || 'unhandled')}</span></td>
            </tr>
          `).join('')}
        </tbody>
      </table>

      ${selected ? `
      <aside class="ki-panel" role="dialog" aria-label="Szczegóły rozmowy">
        <header>
          <h2>Rozmowa</h2>
          <button class="btn btn-ghost btn-sm ki-close">Zamknij</button>
        </header>
        <p class="ki-meta">${escapeHtml(fmtTime(selected.started_at))} · ${selected.channel === 'phone' ? '📞 Telefon' : '💬 Czat'} · ${escapeHtml((selected.language || '').toUpperCase())}</p>
        <div class="ki-transcript">
          <em>Transkrypt ładuje się asynchronicznie z ElevenLabs (V2). Na razie wyświetlamy pierwszą wiadomość:</em>
          <p>${escapeHtml(selected.first_user_message) || '<em>—</em>'}</p>
        </div>
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
window.addEventListener('hashchange', () => { if (location.hash === '#ki') { KI.render(); KI.load(); } });
window.addEventListener('DOMContentLoaded', () => { if (location.hash === '#ki') { KI.render(); KI.load(); } });
