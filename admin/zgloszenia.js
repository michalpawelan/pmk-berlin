// admin/zgloszenia.js — Tab "Zgłoszenia" (Anliegen aus dem Voice-/Chat-Agenten).
// Liest die Liste via Apps Script (action=listZgloszenia, PIN) und erlaubt
// das Umschalten offen <-> erledzone wie eine To-do-Liste.

const Zgloszenia = (function () {
  let items = [];
  let filterStatus = 'offen'; // 'offen' | 'erledzone' | 'all'
  let loading = false;
  let busyId = null;

  function escapeHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  async function apiGet(action, extra) {
    const pin = Auth.getPin();
    const url = new URL(Auth.url);
    url.searchParams.set('action', action);
    url.searchParams.set('pin', pin);
    if (extra) Object.keys(extra).forEach(k => url.searchParams.set(k, extra[k]));
    const res = await fetch(url.toString(), { redirect: 'follow' });
    const text = await res.text();
    try { return JSON.parse(text); } catch (e) { return { success: false, error: 'Błąd serwera' }; }
  }

  async function load() {
    const pin = Auth.getPin();
    if (!pin) { render(); return; }
    loading = true;
    render();
    try {
      const data = await apiGet('listZgloszenia');
      items = (data && Array.isArray(data.zgloszenia)) ? data.zgloszenia : [];
    } catch (e) {
      items = [];
    } finally {
      loading = false;
      render();
    }
  }

  async function toggle(id) {
    if (busyId) return;
    busyId = id;
    render();
    try {
      const data = await apiGet('toggleZgloszenie', { id: id });
      if (data && data.success) {
        const it = items.find(x => x.id === id);
        if (it) {
          it.status = data.status;
          it.resolved_at = data.status === 'erledigt' ? new Date().toISOString() : '';
        }
      }
    } catch (e) { /* still */ }
    finally {
      busyId = null;
      render();
    }
  }

  function filtered() {
    if (filterStatus === 'all') return items;
    if (filterStatus === 'erledzone') return items.filter(i => i.status === 'erledigt');
    return items.filter(i => i.status !== 'erledigt'); // offen
  }

  function openCount() { return items.filter(i => i.status !== 'erledigt').length; }

  function fmtDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleString('pl-PL', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  }

  function sourceLabel(s) {
    if (s === 'chat') return '💬 Czat';
    return '📞 Telefon';
  }

  function card(it) {
    const done = it.status === 'erledigt';
    const phoneHtml = it.phone
      ? `<a class="zg-phone" href="tel:${escapeHtml(it.phone.replace(/\s+/g, ''))}">${escapeHtml(it.phone)}</a>`
      : '<span class="zg-muted">— brak numeru —</span>';
    return `
      <article class="zg-card ${done ? 'zg-done' : ''} ${it.urgent && !done ? 'zg-urgent' : ''}">
        <div class="zg-card-main">
          <div class="zg-card-top">
            ${it.urgent ? '<span class="zg-badge zg-badge-urgent">PILNE</span>' : ''}
            <span class="zg-badge zg-badge-src">${sourceLabel(it.source)}</span>
            ${it.lang ? `<span class="zg-badge zg-badge-lang">${escapeHtml(it.lang.toUpperCase())}</span>` : ''}
            <span class="zg-date">${fmtDate(it.created_at)}</span>
          </div>
          <div class="zg-name">${escapeHtml(it.name || 'Bez nazwiska')}</div>
          <div class="zg-phone-row">${phoneHtml}</div>
          <p class="zg-concern">${escapeHtml(it.concern || '—')}</p>
        </div>
        <div class="zg-card-actions">
          <button class="btn btn-sm ${done ? 'btn-ghost' : 'btn-accent'} zg-toggle" data-id="${escapeHtml(it.id)}" ${busyId === it.id ? 'disabled' : ''}>
            ${busyId === it.id ? '…' : (done ? '↺ Otwórz ponownie' : '✓ Załatwione')}
          </button>
        </div>
      </article>
    `;
  }

  function render() {
    const root = document.getElementById('tab-zgloszenia');
    if (!root) return;
    const rows = filtered();
    root.innerHTML = `
      <div class="news-head">
        <h1>Zgłoszenia</h1>
        <div class="news-stats">
          <span class="news-stat-num">${openCount()}</span> do oddzwonienia
        </div>
      </div>
      <p class="zg-intro">Sprawy przekazane przez asystenta telefonicznego i czat — gdy ktoś chciał rozmawiać z człowiekiem. Oddzwoń i oznacz jako załatwione.</p>
      <div class="filter-tabs zg-filter">
        <button class="filter-tab ${filterStatus === 'offen' ? 'active' : ''}" data-f="offen">Do załatwienia <span class="tab-count">${openCount()}</span></button>
        <button class="filter-tab ${filterStatus === 'erledzone' ? 'active' : ''}" data-f="erledzone">Załatwione <span class="tab-count">${items.filter(i => i.status === 'erledigt').length}</span></button>
        <button class="filter-tab ${filterStatus === 'all' ? 'active' : ''}" data-f="all">Wszystkie <span class="tab-count">${items.length}</span></button>
      </div>
      <div class="zg-list">
        ${rows.length === 0 ? (loading ? `
          <div class="ki-loading"><div class="ki-spinner"></div><span>Wczytywanie zgłoszeń…</span></div>
        ` : `
          <div class="zg-empty">
            <div class="zg-empty-icon">📭</div>
            <p>${filterStatus === 'offen' ? 'Brak spraw do załatwienia. 🎉' : 'Brak zgłoszeń.'}</p>
          </div>
        `) : rows.map(card).join('')}
      </div>
    `;

    root.querySelectorAll('.zg-filter .filter-tab').forEach(btn => {
      btn.addEventListener('click', () => { filterStatus = btn.dataset.f; render(); });
    });
    root.querySelectorAll('.zg-toggle').forEach(btn => {
      btn.addEventListener('click', () => toggle(btn.dataset.id));
    });
  }

  return { load, render };
})();

window.Zgloszenia = Zgloszenia;
window.addEventListener('hashchange', () => { if (location.hash === '#zgloszenia') { Zgloszenia.render(); Zgloszenia.load(); } });
window.addEventListener('DOMContentLoaded', () => { if (location.hash === '#zgloszenia') { Zgloszenia.render(); Zgloszenia.load(); } });
