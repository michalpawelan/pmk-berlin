const Statystyki = (function() {
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

  async function load() {
    const pin = Auth.getPin();
    if (!pin) { render(); return; }
    loading = true;
    render();
    try {
      const [convoRes, subsRes] = await Promise.all([
        fetch('/.netlify/functions/ki-conversations?pin=' + encodeURIComponent(pin) + '&days=90').then(r => r.json()),
        fetch('/.netlify/functions/newsletter-list?pin=' + encodeURIComponent(pin)).then(r => r.json())
      ]);
      const convos = convoRes && convoRes.conversations ? convoRes.conversations : [];
      const subs = subsRes && subsRes.subscribers ? subsRes.subscribers : [];

      // 30-day daily buckets for conversations
      const days30 = [];
      for (let i = 29; i >= 0; i--) {
        const d = new Date(Date.now() - i * 86400000);
        days30.push({
          date: d.toISOString().slice(0, 10),
          label: d.toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit' }),
          count: 0
        });
      }
      convos.forEach(function(c) {
        const d = (c.started_at || '').slice(0, 10);
        const bucket = days30.find(function(b) { return b.date === d; });
        if (bucket) bucket.count++;
      });

      // 30-day signups
      const sub30 = days30.map(function(b) { return { date: b.date, label: b.label, count: 0 }; });
      subs.forEach(function(s) {
        const d = (s.created_at || '').slice(0, 10);
        const bucket = sub30.find(function(b) { return b.date === d; });
        if (bucket) bucket.count++;
      });

      // Channel breakdown
      const chans = {};
      convos.forEach(function(c) {
        const ch = c.channel || 'inne';
        chans[ch] = (chans[ch] || 0) + 1;
      });

      // Wspolnoty breakdown from Events module
      const wspol = {};
      if (window.Events && Events.allEvents) {
        Events.allEvents.forEach(function(e) {
          const w = e.community || 'brak';
          wspol[w] = (wspol[w] || 0) + 1;
        });
      }

      cache = {
        days30: days30,
        sub30: sub30,
        chans: chans,
        wspol: wspol,
        totalConvos: convos.length,
        totalSubs: subs.length
      };
    } catch (e) {
      cache = { error: true };
    } finally {
      loading = false;
      render();
    }
  }

  function barChart(buckets, title) {
    if (!buckets || !buckets.length) {
      return '<div class="stat-chart"><h3>' + escapeHtml(title) + '</h3><p>Brak danych</p></div>';
    }
    const max = Math.max(1, Math.max.apply(null, buckets.map(function(b) { return b.count; })));
    const width = 800;
    const height = 140;
    const barWidth = (width - 40) / buckets.length;

    const bars = buckets.map(function(b, i) {
      const h = (b.count / max) * height;
      const x = 20 + i * barWidth;
      const y = height - h;
      const opacity = 0.4 + (b.count / max) * 0.6;
      const label = (i % 5 === 0 || i === buckets.length - 1)
        ? '<text x="' + (x + barWidth / 2) + '" y="' + (height + 18) + '" text-anchor="middle" font-size="10" fill="#888">' + escapeHtml(b.label) + '</text>'
        : '';
      return '<rect x="' + (x + 1) + '" y="' + y + '" width="' + (barWidth - 2) + '" height="' + h + '" fill="var(--color-accent)" opacity="' + opacity + '">' +
        '<title>' + escapeHtml(b.label) + ': ' + b.count + '</title>' +
        '</rect>' + label;
    }).join('');

    return '<div class="stat-chart">' +
      '<h3>' + escapeHtml(title) + '</h3>' +
      '<svg viewBox="0 0 ' + width + ' ' + (height + 30) + '" class="stat-svg" preserveAspectRatio="xMidYMid meet">' +
        bars +
      '</svg>' +
    '</div>';
  }

  function donutChart(data, title) {
    const entries = Object.entries(data);
    const total = entries.reduce(function(a, e) { return a + e[1]; }, 0);
    if (!total) {
      return '<div class="stat-chart"><h3>' + escapeHtml(title) + '</h3><p>Brak danych</p></div>';
    }

    const colors = { chat: '#7a9ab5', phone: '#c97a3f' };
    const defaultColors = ['#a68b5b', '#7a9ab5', '#c97a3f', '#5a8a5e', '#a85c5c'];
    let startAngle = 0;
    const radius = 50;
    const cx = 70;
    const cy = 70;

    const slices = entries.map(function(entry, idx) {
      const key = entry[0];
      const val = entry[1];
      const angle = (val / total) * 360;
      const x1 = cx + radius * Math.cos((startAngle - 90) * Math.PI / 180);
      const y1 = cy + radius * Math.sin((startAngle - 90) * Math.PI / 180);
      const x2 = cx + radius * Math.cos((startAngle + angle - 90) * Math.PI / 180);
      const y2 = cy + radius * Math.sin((startAngle + angle - 90) * Math.PI / 180);
      const largeArc = angle > 180 ? 1 : 0;
      const path = 'M ' + cx + ' ' + cy + ' L ' + x1 + ' ' + y1 +
        ' A ' + radius + ' ' + radius + ' 0 ' + largeArc + ' 1 ' + x2 + ' ' + y2 + ' Z';
      const color = colors[key] || defaultColors[idx % defaultColors.length];
      startAngle += angle;
      return '<path d="' + path + '" fill="' + color + '"><title>' + escapeHtml(key) + ': ' + val + '</title></path>';
    }).join('');

    const legendItems = entries.map(function(entry, idx) {
      const key = entry[0];
      const val = entry[1];
      const color = colors[key] || defaultColors[idx % defaultColors.length];
      const label = key === 'chat' ? '💬 Czat' : key === 'phone' ? '📞 Telefon' : escapeHtml(key);
      return '<li><span class="stat-dot" style="background:' + color + '"></span>' + label + ': <strong>' + val + '</strong></li>';
    }).join('');

    return '<div class="stat-chart stat-chart-donut">' +
      '<h3>' + escapeHtml(title) + '</h3>' +
      '<svg viewBox="0 0 140 140" class="stat-svg-small">' + slices + '</svg>' +
      '<ul class="stat-legend">' + legendItems + '</ul>' +
    '</div>';
  }

  function hbarChart(map, title) {
    const entries = Object.entries(map).sort(function(a, b) { return b[1] - a[1]; });
    if (!entries.length) {
      return '<div class="stat-chart"><h3>' + escapeHtml(title) + '</h3><p>Brak danych</p></div>';
    }
    const max = Math.max.apply(null, entries.map(function(e) { return e[1]; }));
    const items = entries.map(function(entry) {
      const k = entry[0];
      const v = entry[1];
      const pct = (v / max) * 100;
      return '<li>' +
        '<span class="stat-hbar-label">' + escapeHtml(k) + '</span>' +
        '<span class="stat-hbar-bar" style="width:' + pct + '%"></span>' +
        '<span class="stat-hbar-val">' + v + '</span>' +
      '</li>';
    }).join('');
    return '<div class="stat-chart">' +
      '<h3>' + escapeHtml(title) + '</h3>' +
      '<ul class="stat-hbar">' + items + '</ul>' +
    '</div>';
  }

  function render() {
    const root = document.getElementById('tab-statystyki');
    if (!root) return;
    const c = cache || {};

    if (loading && !cache) {
      root.innerHTML = '<h1 class="prz-title">Statystyki</h1>' +
        '<div class="ki-loading"><div class="ki-spinner"></div><span>Wczytywanie…</span></div>';
      return;
    }

    if (c.error) {
      root.innerHTML = '<h1 class="prz-title">Statystyki</h1>' +
        '<div class="admin-empty"><p>Nie udało się wczytać danych.</p></div>';
      return;
    }

    root.innerHTML =
      '<h1 class="prz-title">Statystyki</h1>' +
      '<p class="prz-subtitle">Aktywność z ostatnich 30 dni.</p>' +
      '<div class="stat-grid">' +
        barChart(c.days30 || [], 'Rozmowy KI dziennie (30 dni) · łącznie ' + (c.totalConvos || 0)) +
        barChart(c.sub30 || [], 'Nowe zapisy newsletter dziennie · łącznie ' + (c.totalSubs || 0)) +
        donutChart(c.chans || {}, 'Kanały rozmów') +
        hbarChart(c.wspol || {}, 'Wydarzenia wg wspólnoty') +
      '</div>';
  }

  return { load: load, render: render };
})();

window.Statystyki = Statystyki;

window.addEventListener('hashchange', function() {
  if (location.hash === '#statystyki') Statystyki.load();
});
window.addEventListener('DOMContentLoaded', function() {
  if (location.hash === '#statystyki') Statystyki.load();
});
