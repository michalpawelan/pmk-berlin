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
    revealThreshold: 0.1,
    revealMargin: '0px 0px -50px 0px',
    animationDelay: 100
  };

  // ============================================
  // DOM Ready
  // ============================================
  document.addEventListener('DOMContentLoaded', function() {
    initNavigation();
    initScrollReveal();
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

    // Prevent body scroll when menu is open
    document.body.style.overflow = navLinks.classList.contains('open') ? 'hidden' : '';
  }

  // ============================================
  // Scroll Reveal Animation
  // ============================================
  function initScrollReveal() {
    const reveals = document.querySelectorAll('.reveal');

    if (!reveals.length) return;

    // Elements already in viewport on page load: show instantly (no animation)
    const viewportHeight = window.innerHeight;
    reveals.forEach(el => {
      const rect = el.getBoundingClientRect();
      if (rect.top < viewportHeight && rect.bottom > 0) {
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
  }

  // ============================================
  // Events Loading
  // ============================================
  // Events API (proxied through Netlify Function)
  const EVENTS_API = '/.netlify/functions/events-proxy';

  async function loadEvents() {
    const container = document.getElementById('events-container');
    if (!container) return;

    let events = [];

    // 1. Versuch: Google Sheets
    try {
      events = await fetchFromGoogleSheets();
      // Events loaded from Google Sheets
    } catch (e) {
      // Google Sheets fetch failed
    }

    // 2. Versuch: Lokale JSON (nur wenn online/Server)
    if (events.length === 0) {
      try {
        const response = await fetch('events.json');
        if (response.ok) {
          events = await response.json();
          // Events loaded from events.json
        }
      } catch (e) {
        // events.json fetch failed
      }
    }

    // 3. Fallback: Hardcoded Events
    if (events.length === 0) {
      events = getHardcodedEvents();
      // Using hardcoded events
    }

    // Filter & Render
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const upcoming = events
      .filter(e => new Date(e.date) >= today)
      .sort((a, b) => new Date(a.date) - new Date(b.date))
      .slice(0, 6);

    if (upcoming.length === 0) {
      const noEventsMsg = getLang() === 'de' ? 'Keine kommenden Veranstaltungen.' : 'Brak nadchodzących wydarzeń.';
      container.innerHTML = '<p class="no-events">' + noEventsMsg + '</p>';
      return;
    }

    container.innerHTML = upcoming.map(ev => renderEventCard(ev)).join('');

    // Add count class for centering when few events
    container.classList.remove('events-count-1', 'events-count-2');
    if (upcoming.length <= 2) {
      container.classList.add(`events-count-${upcoming.length}`);
    }

    // Inject Event structured data for SEO
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

    const mapsUrl = ev.address
      ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(ev.address)}`
      : '';

    const calStart = formatGCalDate(ev.date, ev.time);
    const calEnd = formatGCalDate(ev.date, ev.time, 2);
    const calUrl = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(ev.title)}&dates=${calStart}/${calEnd}&details=${encodeURIComponent(ev.shortDesc || '')}&location=${encodeURIComponent((ev.location || '') + ', ' + (ev.address || ''))}&ctz=Europe/Berlin`;

    const fullDescHtml = ev.fullDesc
      ? escapeHTML(ev.fullDesc).replace(/\n/g, '<br>')
      : escapeHTML(ev.shortDesc || '');

    const eventUrl = `event.html?id=${ev.id}`;

    // Status dot: green = upcoming, gray = past
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const eventDate = new Date(ev.date);
    eventDate.setHours(0, 0, 0, 0);
    const diffDays = Math.round((eventDate - now) / (1000 * 60 * 60 * 24));

    const statusLabels = i18nLabels.status[lang];
    let statusClass = 'status-upcoming';
    let statusText = statusLabels.upcoming;
    if (diffDays === 0) {
      statusClass = 'status-today';
      statusText = statusLabels.today;
    } else if (diffDays <= 3) {
      statusClass = 'status-soon';
      statusText = statusLabels.soon;
    } else if (diffDays < 0) {
      statusClass = 'status-past';
      statusText = statusLabels.past;
    }

    const safeTitle = escapeHTML(ev.title);
    const safeLocation = escapeHTML(ev.location);
    const safeTime = escapeHTML(ev.time);
    const safeEndTime = escapeHTML(ev.endTime);
    const safeImageUrl = escapeHTML(ev.imageUrl);

    const statusDot = `<span class="event-status ${statusClass}"><span class="status-dot"></span>${escapeHTML(statusText)}</span>`;

    const timeDisplay = safeTime ? (safeEndTime ? `${safeTime} - ${safeEndTime}` : safeTime) : '';

    if (ev.imageUrl) {
      // Luma style: image left, text right
      return `
        <a href="${eventUrl}" class="event-card has-image reveal">
          <div class="event-card-image"><img src="${safeImageUrl}" alt="${safeTitle}" loading="lazy"></div>
          <div class="event-card-info">
            ${statusDot}
            <h3 class="event-title">${safeTitle}</h3>
            <p class="event-meta">${weekday}${timeDisplay ? ', ' + timeDisplay : ''}${safeLocation ? ' · ' + safeLocation : ''}</p>
          </div>
        </a>
      `;
    }

    // No image: date box left, text right
    return `
      <a href="${eventUrl}" class="event-card reveal">
        <time class="event-date">
          <span class="day">${day}</span>
          <span class="month">${month}</span>
        </time>
        <div class="event-card-info">
          ${statusDot}
          <h3 class="event-title">${safeTitle}</h3>
          <p class="event-meta">${weekday}${timeDisplay ? ' · ' + timeDisplay : ''}${safeLocation ? ' · ' + safeLocation : ''}</p>
        </div>
        <span class="event-expand-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 5l7 7-7 7"/></svg>
        </span>
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
