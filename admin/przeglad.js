const Przeglad = (function() {
  'use strict';

  let cache = null;
  let loading = false;

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function relTime(iso) {
    if (!iso) return '';
    const now = Date.now();
    const t = new Date(iso).getTime();
    const diff = Math.floor((now - t) / 1000);
    if (diff < 60) return 'teraz';
    if (diff < 3600) return Math.floor(diff / 60) + ' min temu';
    if (diff < 86400) return Math.floor(diff / 3600) + ' godz. temu';
    if (diff < 604800) return Math.floor(diff / 86400) + ' dni temu';
    return new Date(iso).toLocaleDateString('pl-PL', { day: '2-digit', month: 'short' });
  }

  async function load() {
    const pin = Auth.getPin();
    if (!pin) { render(); return; }
    loading = true;
    render();
    try {
      const [convoRes, subsRes] = await Promise.all([
        fetch('/.netlify/functions/ki-conversations?days=30', { headers: Auth.headers() }).then(r => r.json()),
        fetch('/.netlify/functions/newsletter-list', { headers: Auth.headers() }).then(r => r.json())
      ]);
      const convos = convoRes && convoRes.conversations ? convoRes.conversations : [];
      const subs = subsRes && subsRes.subscribers ? subsRes.subscribers : [];

      const URGENT_KW = [
        'namaszczenie', 'umiera', 'umrzeć', 'umrzec', 'śmierc', 'smierc',
        'śmierć', 'pogrzeb', 'pilne', 'pilna', 'nagła', 'szpital',
        'zmarł', 'zmarl', 'wypadek'
      ];

      const isUrgent = function(c) {
        const text = ((c.first_user_message || '') + ' ' + (c.call_summary_title || '')).toLowerCase();
        return URGENT_KW.some(function(k) { return text.includes(k); });
      };

      const isOpen = function(c) {
        const flagStatus = c.flag && c.flag.status;
        if (flagStatus && flagStatus !== 'unhandled') return false;
        if (isUrgent(c)) return true;
        if (c.call_successful === 'success') return false;
        return true;
      };

      const todayStr = new Date().toISOString().slice(0, 10);

      cache = {
        openConvos: convos.filter(isOpen).length,
        urgentConvos: convos.filter(function(c) {
          return isUrgent(c) && (!c.flag || !c.flag.status || c.flag.status === 'unhandled');
        }),
        todayCount: convos.filter(function(c) {
          return (c.started_at || '').slice(0, 10) === todayStr;
        }).length,
        totalSubs: subs.length,
        recentSubs: subs.slice(0, 5),
        upcomingEvents: (window.Events && Events.allEvents)
          ? Events.allEvents.filter(function(e) {
              return new Date(e.date) >= new Date(new Date().setHours(0, 0, 0, 0));
            }).length
          : null
      };
    } catch (e) {
      cache = { error: true };
    } finally {
      loading = false;
      render();
    }
  }

  function render() {
    const root = document.getElementById('tab-przeglad');
    if (!root) return;
    const c = cache || {};

    if (loading && !cache) {
      root.innerHTML = '<h1 class="prz-title">Przegląd</h1>' +
        '<div class="ki-loading"><div class="ki-spinner"></div><span>Wczytywanie…</span></div>';
      return;
    }

    if (c.error) {
      root.innerHTML = '<h1 class="prz-title">Przegląd</h1>' +
        '<div class="admin-empty"><p>Nie udało się wczytać danych. Spróbuj odświeżyć.</p></div>';
      return;
    }

    const upcomingCard = (c.upcomingEvents !== null && c.upcomingEvents !== undefined)
      ? '<a href="#events" class="prz-stat">' +
          '<div class="prz-stat-num">' + c.upcomingEvents + '</div>' +
          '<div class="prz-stat-label">Nadchodzące wydarzenia</div>' +
        '</a>'
      : '';

    const openClass = (c.openConvos > 0) ? 'prz-stat prz-stat-attention' : 'prz-stat';

    const statsHtml = '<div class="prz-stats">' +
      upcomingCard +
      '<a href="#ki" class="' + openClass + '">' +
        '<div class="prz-stat-num">' + (c.openConvos || 0) + '</div>' +
        '<div class="prz-stat-label">Otwarte sprawy KI</div>' +
      '</a>' +
      '<a href="#newsletter" class="prz-stat">' +
        '<div class="prz-stat-num">' + (c.totalSubs || 0) + '</div>' +
        '<div class="prz-stat-label">Newsletter zapisanych</div>' +
      '</a>' +
      '<div class="prz-stat">' +
        '<div class="prz-stat-num">' + (c.todayCount || 0) + '</div>' +
        '<div class="prz-stat-label">Dzisiaj rozmów</div>' +
      '</div>' +
    '</div>';

    let urgentHtml = '';
    if (c.urgentConvos && c.urgentConvos.length > 0) {
      const items = c.urgentConvos.slice(0, 5).map(function(u) {
        const text = escapeHtml((u.first_user_message || u.call_summary_title || '—').slice(0, 80));
        return '<li><a href="#ki">' + text +
          ' <span class="prz-rel">' + relTime(u.started_at) + '</span></a></li>';
      }).join('');
      urgentHtml = '<div class="prz-section prz-urgent">' +
        '<h2>🔴 Pilne — wymaga uwagi</h2>' +
        '<ul class="prz-list">' + items + '</ul>' +
        '</div>';
    }

    let subsHtml = '';
    if (c.recentSubs && c.recentSubs.length > 0) {
      const items = c.recentSubs.map(function(s) {
        return '<li><a href="#newsletter">' + escapeHtml(s.email) +
          ' <span class="prz-rel">' + relTime(s.created_at) + '</span></a></li>';
      }).join('');
      subsHtml = '<div class="prz-section">' +
        '<h2>Ostatnie zapisy do newslettera</h2>' +
        '<ul class="prz-list">' + items + '</ul>' +
        '</div>';
    }

    const actionsHtml = '<div class="prz-actions">' +
      '<a href="#events" class="btn btn-accent" onclick="setTimeout(function(){if(window.openModal)openModal();},100)">' +
        '+ Nowe wydarzenie' +
      '</a>' +
      '<a href="#ki" class="btn btn-ghost">Zobacz wszystkie rozmowy</a>' +
    '</div>';

    root.innerHTML =
      '<h1 class="prz-title">Przegląd</h1>' +
      '<p class="prz-subtitle">Co się dzieje w parafii dzisiaj.</p>' +
      statsHtml +
      urgentHtml +
      subsHtml +
      actionsHtml;
  }

  return { load: load, render: render };
})();

window.Przeglad = Przeglad;

window.addEventListener('hashchange', function() {
  if (location.hash === '#przeglad' || location.hash === '') Przeglad.load();
});
window.addEventListener('DOMContentLoaded', function() {
  if (location.hash === '#przeglad' || location.hash === '') Przeglad.load();
});
