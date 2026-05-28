// admin/newsletter.js — Newsletter-Tab Logic.
// Holt Abonnenten via /.netlify/functions/newsletter-list und rendert Liste + Stats.

const Newsletter = (function() {
  let subs = [];
  let filterLang = 'all';
  let searchTerm = '';

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

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

  function friendlySource(path) {
    if (!path || path === '/') return 'Strona główna';
    const map = {
      '/sakramente.html': 'Sakramenty',
      '/events.html': 'Wydarzenia',
      '/grupy.html': 'Wspólnoty',
      '/kontakt.html': 'Kontakt',
      '/wesprzyj.html': 'Wesprzyj',
      '/de/index.html': 'Strona DE',
      '/de/sakramente.html': 'Sakramenty DE',
      '/de/events.html': 'Wydarzenia DE',
      '/de/grupy.html': 'Wspólnoty DE',
      '/de/kontakt.html': 'Kontakt DE'
    };
    if (map[path]) return map[path];
    // Wspolnota detail pages: wspolnota-apostolstwo.html → "Apostolstwo"
    const m = path.match(/wspolnota-([a-z-]+)\.html/);
    if (m) return 'Wspólnota: ' + m[1].replace(/-/g, ' ');
    // Sakrament detail pages: sakrament-chrzest.html → "Sakrament: chrzest"
    const s = path.match(/sakrament-([a-z-]+)\.html/);
    if (s) return 'Sakrament: ' + s[1].replace(/-/g, ' ');
    // Fallback: show the path
    return path;
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

  const NL_ONBOARDING_KEY = 'pmk_nl_onboarded';

  function render() {
    const root = document.getElementById('tab-newsletter');
    if (!root) return;
    const rows = filtered();
    const showNlOnboarding = !localStorage.getItem(NL_ONBOARDING_KEY);
    root.innerHTML = `
      <div class="news-head">
        <h1>Newsletter</h1>
        <div class="news-stats">
          <span class="news-stat-num">${subs.length}</span> zapisanych
          <span class="news-stat-delta">+${statsLast7()} w ciągu 7 dni</span>
        </div>
      </div>
      ${showNlOnboarding ? `
      <div class="ki-onboarding">
        <button class="ki-onboarding-close" aria-label="Zamknij">&times;</button>
        <p><strong>Kolumna „Źródło"</strong> pokazuje, na której podstronie ktoś się zapisał. <strong>„Eksportuj CSV"</strong> pobiera listę jako plik do otwarcia w Excelu lub do importu do narzędzia mailingowego.</p>
      </div>
      ` : ''}
      <div class="news-toolbar">
        <input class="news-search" placeholder="Szukaj po e-mailu…" value="${escapeHtml(searchTerm)}">
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
              <td>${escapeHtml(r.email)}</td>
              <td><span class="news-lang-badge news-lang-${escapeHtml(r.lang)}">${escapeHtml(r.lang.toUpperCase())}</span></td>
              <td class="news-src">${escapeHtml(friendlySource(r.source))}</td>
              <td>${fmtDate(r.created_at)}</td>
            </tr>
          `).join('') || '<tr><td colspan="4" class="news-empty">Brak zapisów</td></tr>'}
        </tbody>
      </table>
    `;
    const nlClose = root.querySelector('.ki-onboarding-close');
    if (nlClose) nlClose.addEventListener('click', () => {
      localStorage.setItem(NL_ONBOARDING_KEY, '1');
      render();
    });

    root.querySelector('.news-search').addEventListener('input', e => { searchTerm = e.target.value; render(); });
    root.querySelector('.news-filter').addEventListener('change', e => { filterLang = e.target.value; render(); });
    root.querySelector('.news-export').addEventListener('click', exportCsv);
  }

  return { load, render };
})();

window.Newsletter = Newsletter;
window.addEventListener('hashchange', () => { if (location.hash === '#newsletter') Newsletter.load(); });
window.addEventListener('DOMContentLoaded', () => { if (location.hash === '#newsletter') Newsletter.load(); });
