/**
 * PMK Berlin - Premium Church Website
 * Main JavaScript Module
 */

(function() {
  'use strict';

  // ============================================
  // Security: HTML escaping for user-provided data
  // ============================================
  function escapeHTML(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }

  // ============================================
  // Configuration
  // ============================================
  const CONFIG = {
    scrollThreshold: 50,
    revealThreshold: 0.01,
    revealMargin: '0px 0px 1500px 0px',
    revealInitialBuffer: 1200,
    animationDelay: 100
  };

  // ============================================
  // DOM Ready
  // ============================================
  document.addEventListener('DOMContentLoaded', function() {
    initNavigation();
    initScrollReveal();
    loadOgloszenie();
    loadEvents();
    initSmoothScroll();
  });

  // ============================================
  // Navigation
  // ============================================
  function initNavigation() {
    const nav = document.getElementById('mainNav');
    let lastScrollY = window.scrollY;
    let ticking = false;

    // Bind hamburger menu button
    const hamburger = document.getElementById('hamburger');
    if (hamburger) {
      hamburger.setAttribute('aria-controls', 'navLinks');
      hamburger.setAttribute('aria-expanded', 'false');
      hamburger.addEventListener('click', toggleMenu);
    }

    // Bind language switcher buttons (data-lang attribute)
    document.querySelectorAll('[data-lang]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        if (typeof window.setLang === 'function') {
          window.setLang(this.getAttribute('data-lang'));
        }
      });
    });

    function updateNav() {
      const scrollY = window.scrollY;

      // Add/remove scrolled class
      if (scrollY > CONFIG.scrollThreshold) {
        nav.classList.add('scrolled');
      } else {
        nav.classList.remove('scrolled');
      }

      lastScrollY = scrollY;
      ticking = false;
    }

    window.addEventListener('scroll', function() {
      if (!ticking) {
        window.requestAnimationFrame(updateNav);
        ticking = true;
      }
    }, { passive: true });

    // Initial check
    updateNav();
  }

  // Mobile menu toggle
  function toggleMenu() {
    const navLinks = document.getElementById('navLinks');
    const hamburger = document.getElementById('hamburger');

    navLinks.classList.toggle('open');
    hamburger.classList.toggle('active');

    const isOpen = navLinks.classList.contains('open');
    hamburger.setAttribute('aria-expanded', String(isOpen));

    // Prevent body scroll when menu is open
    document.body.style.overflow = isOpen ? 'hidden' : '';
  }

  // ============================================
  // Scroll Reveal Animation
  // ============================================
  function initScrollReveal() {
    const reveals = document.querySelectorAll('.reveal');

    if (!reveals.length) return;

    // Elements already in viewport on page load: show instantly (no animation)
    // Buffer reveals just-below-the-fold content so card grids (sakramenty,
    // grupy, kontakt churches) don't appear empty if the visitor never scrolls.
    const viewportHeight = window.innerHeight;
    const buffer = CONFIG.revealInitialBuffer;
    reveals.forEach(el => {
      const rect = el.getBoundingClientRect();
      if (rect.top < viewportHeight + buffer && rect.bottom > -buffer) {
        el.classList.add('visible', 'no-transition');
        // Remove no-transition after a frame so future hover/state transitions still work
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            el.classList.remove('no-transition');
          });
        });
      }
    });

    // Only observe elements not yet visible (below the fold)
    const remaining = document.querySelectorAll('.reveal:not(.visible)');
    if (!remaining.length) return;

    let staggerBase = 0;
    const observer = new IntersectionObserver((entries) => {
      const newEntries = entries.filter(e => e.isIntersecting);
      newEntries.forEach((entry, index) => {
        const delay = index * CONFIG.animationDelay;
        setTimeout(() => {
          entry.target.classList.add('visible');
        }, delay);
        observer.unobserve(entry.target);
      });
    }, {
      threshold: CONFIG.revealThreshold,
      rootMargin: CONFIG.revealMargin
    });

    remaining.forEach(el => observer.observe(el));

    // Safety net: reveal anything still hidden after 4s so content is never
    // permanently invisible if the observer mis-fires or the user never scrolls.
    setTimeout(() => {
      document.querySelectorAll('.reveal:not(.visible)').forEach(el => {
        el.classList.add('visible');
      });
    }, 4000);
  }

  // ============================================
  // Ogłoszenia duszpasterskie (parish announcements)
  // ============================================
  // Single-card widget above the events grid. Shows the most recent
  // ogłoszenie where published === 'TAK' AND expires_at > now.
  // Sheet columns: A=id, B=title, C=body, D=image_url, E=published_at,
  //                F=expires_at, G=published (TAK/NIE).
  // If no current ogłoszenie or fetch fails: section stays hidden, no flicker.
  // localStorage cache helpers — stale-while-revalidate. All wrapped so private
  // mode / disabled storage never throws.
  function readCache(key) {
    try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : null; }
    catch (e) { return null; }
  }
  function writeCache(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* ignore */ }
  }
  function removeCache(key) {
    try { localStorage.removeItem(key); } catch (e) { /* ignore */ }
  }
  const OGLOSZENIE_CACHE_KEY = 'pmk-ogloszenie-v1';
  const EVENTS_CACHE_KEY = 'pmk-events-v1';

  // Populate + reveal the homepage strip from a plain { title, publishedAtISO } object.
  // Used both for the instant cache paint and the fresh network result.
  function applyOgloszenie(data) {
    const section = document.getElementById('ogloszenia');
    if (!section || !data || !data.title) return;
    const titleEl = document.getElementById('ogloszenia-title');
    const dateEl = document.getElementById('ogloszenia-date');
    const linkEl = document.getElementById('ogloszenia-link');
    const publishedAt = data.publishedAtISO ? new Date(data.publishedAtISO) : null;

    if (titleEl) titleEl.textContent = data.title;
    if (dateEl && window.PMK_Ogloszenia && publishedAt) {
      // The "Biuletyn na ten tydzień" label is static markup; here we add only the
      // date range (strip the "Tydzień ·"/"Woche ·" prefix that formatWeekRange adds).
      const wr = window.PMK_Ogloszenia.formatWeekRange(publishedAt, window.PMK_Ogloszenia.getLang());
      const sep = wr.indexOf(' · ');
      dateEl.textContent = sep >= 0 ? wr.slice(sep + 3) : wr;
    }
    if (linkEl) {
      const langLabel = (window.PMK_Ogloszenia && window.PMK_Ogloszenia.getLang() === 'de')
        ? 'Pfarrblatt — ' : 'Ogłoszenia duszpasterskie — ';
      linkEl.setAttribute('aria-label', langLabel + data.title);
    }
    section.removeAttribute('hidden');
  }

  async function loadOgloszenie() {
    const section = document.getElementById('ogloszenia');
    if (!section) return;
    if (!window.PMK_Ogloszenia) return;

    // 1. Instant paint from cache — no pop-in on repeat visits.
    const cached = readCache(OGLOSZENIE_CACHE_KEY);
    if (cached && cached.title) applyOgloszenie(cached);

    // 2. Revalidate against the live sheet.
    const data = await window.PMK_Ogloszenia.fetchCurrent();
    if (!data) {
      // No current ogłoszenie any more — hide a stale cached strip and forget it.
      if (cached) { section.setAttribute('hidden', ''); removeCache(OGLOSZENIE_CACHE_KEY); }
      return;
    }
    const fresh = {
      title: data.title,
      publishedAtISO: (data.publishedAt && data.publishedAt.getTime() > 0) ? data.publishedAt.toISOString() : null
    };
    writeCache(OGLOSZENIE_CACHE_KEY, fresh);
    applyOgloszenie(fresh);
  }

  // ============================================
  // Events Loading
  // ============================================
  // Events API (proxied through Netlify Function)
  const EVENTS_API = '/.netlify/functions/events-proxy';

  // Skeleton placeholder cards shown instantly while events load (no empty flash).
  // Injected directly into a container that already has the .events-group flex layout.
  function eventsSkeletonHtml() {
    const card =
      '<div class="event-skeleton" aria-hidden="true">' +
        '<div class="event-skeleton-img"></div>' +
        '<div class="event-skeleton-lines">' +
          '<span class="sk sk-dot"></span>' +
          '<span class="sk sk-title"></span>' +
          '<span class="sk sk-meta"></span>' +
        '</div>' +
      '</div>';
    return card + card;
  }

  function upcomingCount(events) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return events.filter(function (e) { return new Date(e.date) >= today; }).length;
  }

  async function loadEvents() {
    const weekEl = document.getElementById('events-this-week');
    if (!weekEl) return;

    // 1. Instant paint: cached events if they still yield something upcoming,
    //    otherwise skeleton placeholders — never an empty flash on (re)load.
    let painted = false;
    const cached = readCache(EVENTS_CACHE_KEY);
    if (Array.isArray(cached) && cached.length && upcomingCount(cached) > 0) {
      renderEvents(cached);
      painted = true;
    }
    if (!painted) weekEl.innerHTML = eventsSkeletonHtml();

    // 2. Revalidate: Google Sheets → events.json → (hardcoded only if nothing else).
    let events = [];
    try {
      events = await fetchFromGoogleSheets();
    } catch (e) {
      // Google Sheets fetch failed
    }
    if (events.length === 0) {
      try {
        const response = await fetch('events.json');
        if (response.ok) events = await response.json();
      } catch (e) {
        // events.json fetch failed
      }
    }

    if (events.length > 0) {
      const freshStr = JSON.stringify(events);
      writeCache(EVENTS_CACHE_KEY, events);
      // Skip the re-render (and its reveal animation) when fresh === what we already painted.
      if (!(painted && cached && freshStr === JSON.stringify(cached))) {
        renderEvents(events);
      }
    } else if (!painted) {
      renderEvents(getHardcodedEvents());
    }
  }

  // Split events by timeframe and render into the two homepage sections:
  //   #events-this-week  (under the bulletin, in the "W tym tygodniu" section)
  //   #events-upcoming   (the separate "Nadchodzące" section)
  function renderEvents(events) {
    const weekEl = document.getElementById('events-this-week');
    const upcomingEl = document.getElementById('events-upcoming');
    if (!weekEl) return;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const weekHorizon = new Date(today);
    weekHorizon.setDate(today.getDate() + 7);

    const upcoming = events
      .filter(e => new Date(e.date) >= today)
      .sort((a, b) => new Date(a.date) - new Date(b.date))
      .slice(0, 12);

    const thisWeek = upcoming.filter(e => new Date(e.date) < weekHorizon);
    const later = upcoming.filter(e => new Date(e.date) >= weekHorizon);
    const lang = getLang();

    // This week (the section header already reads "W tym tygodniu").
    weekEl.innerHTML = thisWeek.length
      ? thisWeek.map(renderEventCard).join('')
      : '<p class="no-events">' + (lang === 'de' ? 'Diese Woche keine Termine.' : 'W tym tygodniu brak wydarzeń.') + '</p>';

    // Upcoming (the separate "Nadchodzące" section).
    if (upcomingEl) {
      upcomingEl.innerHTML = later.length
        ? later.map(renderEventCard).join('')
        : '<p class="no-events">' + (lang === 'de' ? 'Keine weiteren Termine.' : 'Brak kolejnych wydarzeń.') + '</p>';
    }

    // Inject Event structured data for SEO (covers both groups)
    injectEventSchema(upcoming);

    initScrollReveal();
  }

  // ============================================
  // Google Sheets Parser
  // ============================================
  // NEUE SPALTEN (vereinfacht, 7 Spalten):
  // A: Tytul  B: Data  C: Godzina  D: Opis  E: Zdjecie (URL)  F: Miejsce  G: Opublikowane (TAK/NIE)
  async function fetchFromGoogleSheets() {
    const response = await fetch(EVENTS_API);
    const text = await response.text();

    const jsonMatch = text.match(/google\.visualization\.Query\.setResponse\(([\s\S]*)\);?/);
    if (!jsonMatch || !jsonMatch[1]) throw new Error('Invalid Google Sheets format');

    const data = JSON.parse(jsonMatch[1]);
    const rows = data.table.rows;
    const events = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (!row.c || !row.c[0]) continue;

      const val = (idx) => {
        const cell = row.c && row.c[idx];
        return cell ? (cell.v || cell.f || '') : '';
      };

      // Spalte H: Opublikowane - nur veroeffentlichte Events anzeigen
      const published = val(7);
      if (published && String(published).toUpperCase() === 'NIE') continue;

      // Datum parsen (Spalte B) - unterstuetzt mehrere Formate
      let dateStr = '';
      const dateCell = row.c && row.c[1];
      if (dateCell) {
        const rawVal = dateCell.v;
        const fmtVal = dateCell.f;

        // "Date(2026,2,23)" Format (Monat ist 0-basiert)
        const dateMatch = String(rawVal || '').match(/Date\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*/);
        if (dateMatch) {
          const y = dateMatch[1];
          const m = String(parseInt(dateMatch[2]) + 1).padStart(2, '0');
          const d = String(dateMatch[3]).padStart(2, '0');
          dateStr = `${y}-${m}-${d}`;
        }
        // YYYY-MM-DD
        if (!dateStr && fmtVal) {
          const isoParts = String(fmtVal).match(/(\d{4})-(\d{2})-(\d{2})/);
          if (isoParts) dateStr = fmtVal;
        }
        // DD.MM.YYYY
        if (!dateStr && fmtVal) {
          const deParts = String(fmtVal).match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
          if (deParts) dateStr = `${deParts[3]}-${deParts[2].padStart(2,'0')}-${deParts[1].padStart(2,'0')}`;
        }
        if (!dateStr && rawVal) dateStr = String(rawVal);
      }

      // Bild-URL (Spalte E) - Google Drive URLs konvertieren
      const imgUrl = val(4);
      let imageUrl = '';
      if (imgUrl) {
        const driveMatch = imgUrl.match(/\/d\/([a-zA-Z0-9_-]+)/) ||
                           imgUrl.match(/[?&]id=([a-zA-Z0-9_-]+)/);
        imageUrl = driveMatch
          ? `https://lh3.googleusercontent.com/d/${driveMatch[1]}=w800`
          : imgUrl;
      }

      // ID aus Titel generieren (slug)
      const title = val(0);
      const slug = title.toLowerCase()
        .replace(/[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/g, c => ({'ą':'a','ć':'c','ę':'e','ł':'l','ń':'n','ó':'o','ś':'s','ź':'z','ż':'z','Ą':'a','Ć':'c','Ę':'e','Ł':'l','Ń':'n','Ó':'o','Ś':'s','Ź':'z','Ż':'z'}[c] || c))
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9-]/g, '');

      // Zeit parsen (Spalte C) - Google Sheets gibt Date(1899,11,30,HH,MM,SS) zurueck
      // Unterstuetzt auch Zeitbereiche wie "10:00-20:00" oder "10:00 - 20:00"
      let timeStr = '';
      let endTimeStr = '';
      const timeCell = row.c && row.c[2];
      if (timeCell) {
        const rawTime = String(timeCell.v || '');
        const fmtTime = timeCell.f || '';
        // Zeitbereich als Text: "10:00-20:00" oder "10:00 - 20:00"
        const rangeMatch = (fmtTime || rawTime).match(/(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/);
        if (rangeMatch) {
          timeStr = rangeMatch[1];
          endTimeStr = rangeMatch[2];
        } else {
          const timeMatch = rawTime.match(/Date\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*(\d+)\s*,\s*(\d+)/);
          if (timeMatch) {
            timeStr = `${String(timeMatch[1]).padStart(2,'0')}:${String(timeMatch[2]).padStart(2,'0')}`;
          } else if (fmtTime && fmtTime.match(/\d{1,2}:\d{2}/)) {
            timeStr = fmtTime;
          } else if (rawTime && rawTime.match(/\d{1,2}:\d{2}/)) {
            timeStr = rawTime;
          }
        }
      }

      const location = val(5) || 'Johannes-Basilika';
      const address = val(6) || 'Lilienthalstraße 5, 10965 Berlin';
      const description = val(3);

      events.push({
        id: slug || `event-${i}`,
        title: title,
        date: dateStr,
        time: timeStr,
        endTime: endTimeStr || undefined,
        shortDesc: description.length > 120 ? description.substring(0, 120) + '...' : description,
        fullDesc: description,
        imageUrl: imageUrl,
        location: location,
        address: address
      });
    }

    return events.filter(e => e.title && e.date);
  }

  // ============================================
  // Hardcoded Fallback Events
  // ============================================
  function getHardcodedEvents() {
    return [];
  }

  // i18n-aware labels for event cards
  const i18nLabels = {
    months: {
      pl: ['sty', 'lut', 'mar', 'kwi', 'maj', 'cze', 'lip', 'sie', 'wrz', 'paź', 'lis', 'gru'],
      de: ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez']
    },
    weekdays: {
      pl: ['Niedziela', 'Poniedziałek', 'Wtorek', 'Środa', 'Czwartek', 'Piątek', 'Sobota'],
      de: ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag']
    },
    status: {
      pl: { upcoming: 'Nadchodzi', today: 'Dzisiaj', soon: 'Wkrótce', past: 'Minione' },
      de: { upcoming: 'Bevorstehend', today: 'Heute', soon: 'In Kürze', past: 'Vergangen' }
    }
  };

  function getLang() {
    try { return localStorage.getItem('pmk-lang') || 'pl'; } catch (e) { return 'pl'; }
  }

  function renderEventCard(ev) {
    const lang = getLang();
    const d = new Date(ev.date);
    const day = String(d.getDate()).padStart(2, '0');
    const month = i18nLabels.months[lang][d.getMonth()];
    const weekday = i18nLabels.weekdays[lang][d.getDay()];
    const eventUrl = `event.html?id=${ev.id}`;

    // Past events get a muted dot (homepage only shows upcoming, but keep it correct).
    const now = new Date(); now.setHours(0, 0, 0, 0);
    const eventDate = new Date(ev.date); eventDate.setHours(0, 0, 0, 0);
    const isPast = Math.round((eventDate - now) / (1000 * 60 * 60 * 24)) < 0;

    const safeTitle = escapeHTML(ev.title);
    const safeLocation = escapeHTML(ev.location);
    const safeTime = escapeHTML(ev.time);
    const safeEndTime = escapeHTML(ev.endTime);
    const safeImageUrl = escapeHTML(ev.imageUrl);

    const timeDisplay = safeTime ? (safeEndTime ? `${safeTime} – ${safeEndTime}` : safeTime) : '';
    const metaLine = [timeDisplay, safeLocation].filter(Boolean).join(' · ');
    const detailsLabel = lang === 'de' ? 'Details' : 'Szczegóły';

    // Left visual: poster thumbnail (with image) OR a date badge (without).
    let left, whenText;
    if (ev.imageUrl) {
      left = `<span class="ev-thumb"><img src="${safeImageUrl}" alt="" loading="lazy"></span>`;
      whenText = `${escapeHTML(weekday)} · ${day} ${escapeHTML(month)}`;
    } else {
      left = `<span class="ev-date-badge"><span class="d">${day}</span><span class="m">${escapeHTML(String(month).slice(0, 3))}</span></span>`;
      whenText = escapeHTML(weekday);
    }

    return `
      <a href="${eventUrl}" class="event-card-new${isPast ? ' is-past' : ''} reveal">
        ${left}
        <span class="ev-main">
          <span class="ev-when"><span class="dot"></span>${whenText}</span>
          <span class="ev-title">${safeTitle}</span>
          ${metaLine ? `<span class="ev-meta">${metaLine}</span>` : ''}
        </span>
        <span class="ev-cta"><span class="txt">${detailsLabel}</span> <span class="arrow">→</span></span>
      </a>
    `;
  }

  // ============================================
  // Event Schema.org Structured Data (SEO)
  // ============================================
  function injectEventSchema(events) {
    const schemaEvents = events.map(ev => {
      const startDate = ev.time ? `${ev.date}T${ev.time}:00+02:00` : ev.date;
      const endDate = ev.endTime ? `${ev.date}T${ev.endTime}:00+02:00` : undefined;

      return {
        "@type": "Event",
        "name": ev.title,
        "description": ev.fullDesc || ev.shortDesc || '',
        "startDate": startDate,
        ...(endDate && { "endDate": endDate }),
        "eventAttendanceMode": "https://schema.org/OfflineEventAttendanceMode",
        "eventStatus": "https://schema.org/EventScheduled",
        "location": {
          "@type": "Place",
          "name": ev.location || "Johannes-Basilika",
          "address": {
            "@type": "PostalAddress",
            "streetAddress": ev.address || "Lilienthalstraße 5",
            "addressLocality": "Berlin",
            "addressCountry": "DE"
          }
        },
        "organizer": {
          "@type": "Organization",
          "name": "Polska Misja Katolicka Berlin",
          "url": "https://pmk-berlin.de"
        },
        ...(ev.imageUrl && { "image": ev.imageUrl }),
        "inLanguage": "pl"
      };
    });

    const script = document.createElement('script');
    script.type = 'application/ld+json';
    script.textContent = JSON.stringify({
      "@context": "https://schema.org",
      "@type": "ItemList",
      "name": "Nadchodzące wydarzenia - PMK Berlin",
      "numberOfItems": schemaEvents.length,
      "itemListElement": schemaEvents.map((ev, i) => ({
        "@type": "ListItem",
        "position": i + 1,
        "item": ev
      }))
    });
    document.head.appendChild(script);
  }

  function formatGCalDate(date, time, addHours = 0) {
    const d = new Date(date);
    if (time) {
      const [hours, minutes] = time.split(':');
      d.setHours(parseInt(hours) + addHours, parseInt(minutes), 0);
    }
    return d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  }

  // ============================================
  // Toast Notifications
  // ============================================
  function showToast(message, type) {
    type = type || 'error';
    var existing = document.querySelector('.toast-notification');
    if (existing) existing.remove();

    var toast = document.createElement('div');
    toast.className = 'toast-notification toast-' + type;
    toast.textContent = message;
    document.body.appendChild(toast);

    requestAnimationFrame(function() {
      toast.classList.add('toast-visible');
    });

    setTimeout(function() {
      toast.classList.remove('toast-visible');
      setTimeout(function() { toast.remove(); }, 300);
    }, 4000);
  }
  window.showToast = showToast;

  // ============================================
  // Smooth Scroll
  // ============================================
  function initSmoothScroll() {
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
      anchor.addEventListener('click', function(e) {
        const href = this.getAttribute('href');
        if (href === '#') return;

        const target = document.querySelector(href);
        if (!target) return;

        e.preventDefault();

        // Close mobile menu if open
        const navLinks = document.getElementById('navLinks');
        const hamburger = document.getElementById('hamburger');
        if (navLinks && navLinks.classList.contains('open')) {
          navLinks.classList.remove('open');
          hamburger.classList.remove('active');
          document.body.style.overflow = '';
        }

        // Calculate offset for fixed header
        const headerHeight = document.querySelector('.nav-header')?.offsetHeight || 0;
        const targetPosition = target.getBoundingClientRect().top + window.pageYOffset - headerHeight - 20;

        window.scrollTo({
          top: targetPosition,
          behavior: 'smooth'
        });
      });
    });
  }

  // ============================================
  // Utility Functions
  // ============================================

  // Debounce helper
  function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  }

  // Throttle helper
  function throttle(func, limit) {
    let inThrottle;
    return function(...args) {
      if (!inThrottle) {
        func.apply(this, args);
        inThrottle = true;
        setTimeout(() => inThrottle = false, limit);
      }
    };
  }

})();

// ============================================
// Newsletter-Footer-Formular
// ============================================
window.PmkNewsletter = {
  submit: function(e, form) {
    e.preventDefault();
    const btn = form.querySelector('.footer-newsletter-btn');
    const msg = form.querySelector('.footer-newsletter-msg');
    const data = {
      email: form.email.value.trim(),
      website: form.website.value,
      lang: (document.documentElement.lang || 'pl').slice(0, 2),
      source: location.pathname
    };
    btn.disabled = true;
    msg.hidden = true;
    fetch('/.netlify/functions/newsletter-subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    })
      .then(r => r.json())
      .then(res => {
        if (res && res.success) {
          if (res.message === 'already_subscribed') {
            msg.textContent = (data.lang === 'de') ? 'Du bist bereits angemeldet.' : 'Już jesteś zapisany/a.';
          } else {
            msg.textContent = (data.lang === 'de')
              ? 'Fast geschafft! Bitte bestätige die Anmeldung über den Link in deiner E-Mail.'
              : 'Prawie gotowe! Potwierdź subskrypcję klikając w link w e-mailu.';
          }
          msg.className = 'footer-newsletter-msg footer-newsletter-msg-ok';
          form.reset();
        } else {
          msg.textContent = (data.lang === 'de') ? 'E-Mail ungültig oder Fehler.' : 'Nieprawidłowy e-mail lub błąd.';
          msg.className = 'footer-newsletter-msg footer-newsletter-msg-err';
        }
        msg.hidden = false;
      })
      .catch(() => {
        msg.textContent = (data.lang === 'de') ? 'Verbindung fehlgeschlagen.' : 'Błąd połączenia.';
        msg.className = 'footer-newsletter-msg footer-newsletter-msg-err';
        msg.hidden = false;
      })
      .finally(() => { btn.disabled = false; });
    return false;
  }
};
