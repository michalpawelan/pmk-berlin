/**
 * PMK Berlin — Ogłoszenia shared module
 * Used by:
 *   - main.js (homepage teaser strip)
 *   - ogloszenia.html (detail page)
 *
 * Exposes:
 *   window.PMK_Ogloszenia = {
 *     fetchCurrent(),          // async → { id, title, body, publishedAt } | null
 *     renderBlocks(body),      // string → HTML string
 *     formatWeekRange(date, lang), // (Date, 'pl'|'de') → "Tydzień · 29 maja – 4 czerwca 2026"
 *     getLang()                // () → 'pl' | 'de'
 *   }
 */
(function () {
  'use strict';

  const OGLOSZENIA_API = '/.netlify/functions/ogloszenia-proxy';

  function getLang() {
    // Sprache hängt nur an der URL: /de/* ist Deutsch, alles andere Polnisch
    return window.location.pathname.indexOf('/de/') === 0 ? 'de' : 'pl';
  }

  function escapeHTML(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c];
    });
  }

  function parseGvizDate(cell) {
    if (!cell) return null;
    const raw = cell.v;
    const fmt = cell.f;
    const m = String(raw || '').match(/Date\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*(\d+))?)?/);
    if (m) {
      return new Date(
        parseInt(m[1], 10),
        parseInt(m[2], 10),
        parseInt(m[3], 10),
        m[4] ? parseInt(m[4], 10) : 0,
        m[5] ? parseInt(m[5], 10) : 0,
        m[6] ? parseInt(m[6], 10) : 0
      );
    }
    if (fmt) {
      const d = new Date(fmt);
      if (!isNaN(d.getTime())) return d;
    }
    if (raw) {
      const d = new Date(raw);
      if (!isNaN(d.getTime())) return d;
    }
    return null;
  }

  async function fetchCurrent() {
    try {
      const response = await fetch(OGLOSZENIA_API);
      if (!response.ok) return null;
      const text = await response.text();

      const jsonMatch = text.match(/google\.visualization\.Query\.setResponse\(([\s\S]*)\);?/);
      if (!jsonMatch || !jsonMatch[1]) return null;

      const data = JSON.parse(jsonMatch[1]);
      const rows = (data.table && data.table.rows) || [];
      if (!rows.length) return null;

      const now = new Date();
      const items = [];

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        if (!row || !row.c) continue;

        const val = function (idx) {
          const cell = row.c[idx];
          return cell ? (cell.v != null ? cell.v : (cell.f || '')) : '';
        };

        const id = val(0);
        const title = val(1);
        const body = val(2);
        const publishedAt = parseGvizDate(row.c[4]);
        const expiresAt = parseGvizDate(row.c[5]);
        const published = String(val(6) || '').toUpperCase();

        if (!title || !body) continue;
        if (published !== 'TAK') continue;
        if (!expiresAt || expiresAt <= now) continue;

        items.push({
          id: String(id),
          title: String(title),
          body: String(body),
          publishedAt: publishedAt || new Date(0)
        });
      }

      if (!items.length) return null;
      items.sort(function (a, b) { return b.publishedAt - a.publishedAt; });
      return items[0];
    } catch (e) {
      return null;
    }
  }

  function renderBlocks(body) {
    if (typeof body !== 'string') return '';
    const trimmed = body.trim();
    let blocks = null;
    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) blocks = parsed;
      } catch (e) { /* fall through to legacy HTML */ }
    }
    if (!blocks) return body; // legacy HTML, trusted

    return blocks.map(function (b) {
      if (b && b.t === 'img' && b.u) {
        const raw = String(b.u);
        const m = raw.match(/\/d\/([a-zA-Z0-9_-]+)/) || raw.match(/[?&]id=([a-zA-Z0-9_-]+)/);
        const url = m ? ('https://lh3.googleusercontent.com/d/' + m[1] + '=w1200') : raw;
        // The image is shown at its natural aspect ratio (never cropped), mounted on a
        // clean card (rounded + soft shadow) by .ogloszenia-img-block in ogloszenia.html.
        return '<img class="ogloszenia-img-block" src="' + escapeHTML(url) + '" alt="Plakat ogłoszeń parafialnych" loading="lazy" decoding="async">';
      }
      if (b && b.t === 'txt' && b.c) {
        return String(b.c)
          .split(/\n{2,}/)
          .map(function (par) { return '<p>' + escapeHTML(par).replace(/\n/g, '<br>') + '</p>'; })
          .join('');
      }
      return '';
    }).join('');
  }

  function formatWeekRange(publishedAt, lang) {
    if (!publishedAt || publishedAt.getTime() <= 0) return '';
    const locale = lang === 'de' ? 'de-DE' : 'pl-PL';
    const end = new Date(publishedAt.getTime());
    end.setDate(end.getDate() + 6);
    const startStr = publishedAt.toLocaleDateString(locale, { day: 'numeric', month: 'long' });
    const endStr   = end.toLocaleDateString(locale,         { day: 'numeric', month: 'long', year: 'numeric' });
    const label = lang === 'de' ? 'Woche' : 'Tydzień';
    return label + ' · ' + startStr + ' – ' + endStr;
  }

  window.PMK_Ogloszenia = {
    fetchCurrent: fetchCurrent,
    renderBlocks: renderBlocks,
    formatWeekRange: formatWeekRange,
    getLang: getLang
  };
})();
