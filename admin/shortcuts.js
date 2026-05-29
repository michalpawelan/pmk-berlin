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
