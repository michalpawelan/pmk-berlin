/**
 * PMK Berlin - Premium Church Website
 * Main JavaScript Module
 */

(function() {
  'use strict';

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
    initContactForm();
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
  window.toggleMenu = function() {
    const navLinks = document.getElementById('navLinks');
    const hamburger = document.getElementById('hamburger');

    navLinks.classList.toggle('open');
    hamburger.classList.toggle('active');

    // Prevent body scroll when menu is open
    document.body.style.overflow = navLinks.classList.contains('open') ? 'hidden' : '';
  };

  // Language switch
  window.setLang = function(lang) {
    document.querySelectorAll('.lang-btn').forEach(btn => {
      btn.classList.toggle('active', btn.textContent === lang.toUpperCase());
    });
    // Language switching logic would go here
    console.log('Language set to:', lang);
  };

  // ============================================
  // Scroll Reveal Animation
  // ============================================
  function initScrollReveal() {
    const reveals = document.querySelectorAll('.reveal');

    if (!reveals.length) return;

    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry, index) => {
        if (entry.isIntersecting) {
          // Stagger animation for multiple elements
          const delay = index * CONFIG.animationDelay;
          setTimeout(() => {
            entry.target.classList.add('visible');
          }, delay);
          observer.unobserve(entry.target);
        }
      });
    }, {
      threshold: CONFIG.revealThreshold,
      rootMargin: CONFIG.revealMargin
    });

    reveals.forEach(el => observer.observe(el));
  }

  // ============================================
  // Events Loading
  // ============================================
  // Google Sheet Config - HIER ANPASSEN
  const SHEET_ID = '1tPc4twR0CoefnHDoODo-a5opSK35ogDmZHyzB_uhb1w';
  const SHEET_NAME = 'Tabellenblatt1';

  async function loadEvents() {
    const container = document.getElementById('events-container');
    if (!container) return;

    let events = [];

    // 1. Versuch: Google Sheets
    try {
      events = await fetchFromGoogleSheets();
      console.log('Events loaded from Google Sheets:', events.length);
    } catch (e) {
      console.warn('Google Sheets failed:', e);
    }

    // 2. Versuch: Lokale JSON (nur wenn online/Server)
    if (events.length === 0) {
      try {
        const response = await fetch('events.json');
        if (response.ok) {
          events = await response.json();
          console.log('Events loaded from events.json:', events.length);
        }
      } catch (e) {
        console.warn('events.json failed:', e);
      }
    }

    // 3. Fallback: Hardcoded Events
    if (events.length === 0) {
      events = getHardcodedEvents();
      console.log('Using hardcoded events');
    }

    // Filter & Render
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const upcoming = events
      .filter(e => new Date(e.date) >= today)
      .sort((a, b) => new Date(a.date) - new Date(b.date))
      .slice(0, 6);

    if (upcoming.length === 0) {
      container.innerHTML = '<p class="no-events">Brak nadchodzacych wydarzen.</p>';
      return;
    }

    container.innerHTML = upcoming.map(ev => renderEventCard(ev)).join('');

    // Event cards are now direct links to detail page

    initScrollReveal();
  }

  // ============================================
  // Google Sheets Parser
  // ============================================
  // NEUE SPALTEN (vereinfacht, 7 Spalten):
  // A: Tytul  B: Data  C: Godzina  D: Opis  E: Zdjecie (URL)  F: Miejsce  G: Opublikowane (TAK/NIE)
  async function fetchFromGoogleSheets() {
    const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json&sheet=${encodeURIComponent(SHEET_NAME)}&headers=1`;
    const response = await fetch(url);
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
    return [
      { id: 'niedziela-palmowa', title: 'Niedziela Palmowa', date: '2026-03-29', time: '10:15', shortDesc: 'Poswiecenie palm i procesja.', fullDesc: 'Poswiecenie palm i procesja. Msze o 10:15, 12:00 i 18:00. Prosimy o przyniesienie palm do poswiecenia.', location: 'Johannes-Basilika', address: 'Lilienthalstraße 5, 10965 Berlin' },
      { id: 'wielki-czwartek', title: 'Wielki Czwartek', date: '2026-04-02', time: '18:00', shortDesc: 'Msza Wieczerzy Panskiej.', fullDesc: 'Msza Wieczerzy Panskiej z obrzedem umycia nog. Po Mszy adoracja w Ciemnicy do polnocy.', location: 'Johannes-Basilika', address: 'Lilienthalstraße 5, 10965 Berlin' },
      { id: 'wielki-piatek', title: 'Wielki Piatek', date: '2026-04-03', time: '15:00', shortDesc: 'Liturgia Meki Panskiej. Droga Krzyzowa.', fullDesc: '15:00 - Liturgia Meki Panskiej. 17:00 - Droga Krzyzowa. 20:00 - Adoracja przy Grobie Panskim.', location: 'Johannes-Basilika', address: 'Lilienthalstraße 5, 10965 Berlin' },
      { id: 'wielka-sobota', title: 'Wielka Sobota', date: '2026-04-04', time: '09:00', shortDesc: 'Swiecenie pokarmow. Wigilia Paschalna.', fullDesc: '09:00-12:00 i 14:00-16:00 - Swiecenie pokarmow. 20:00 - Wigilia Paschalna.', location: 'Johannes-Basilika', address: 'Lilienthalstraße 5, 10965 Berlin' },
      { id: 'niedziela-zmartwychwstania', title: 'Niedziela Zmartwychwstania', date: '2026-04-05', time: '07:00', shortDesc: 'Rezurekcja o 7:00. Msze o 10:15, 12:00, 18:00.', fullDesc: '07:00 - Uroczysta Rezurekcja z procesja. Msze: 10:15, 12:00, 18:00. ALLELUJA!', location: 'Johannes-Basilika', address: 'Lilienthalstraße 5, 10965 Berlin' },
      { id: 'pierwsza-komunia-swieta', title: 'Pierwsza Komunia Swieta', date: '2026-05-03', time: '10:15', shortDesc: 'Uroczystosc I Komunii Swietej.', fullDesc: 'Uroczysta Msza Swieta z Pierwsza Komunia. Po Mszy blogoslawienstwo rodzin.', location: 'Johannes-Basilika', address: 'Lilienthalstraße 5, 10965 Berlin' },
      { id: 'boze-cialo', title: 'Boze Cialo', date: '2026-06-04', time: '10:15', shortDesc: 'Procesja z Najswietszym Sakramentem.', fullDesc: '10:15 - Uroczysta Msza Swieta. Po Mszy procesja z Najswietszym Sakramentem.', location: 'Johannes-Basilika', address: 'Lilienthalstraße 5, 10965 Berlin' }
    ];
  }

  function renderEventCard(ev) {
    const d = new Date(ev.date);
    const day = String(d.getDate()).padStart(2, '0');
    const months = ['sty', 'lut', 'mar', 'kwi', 'maj', 'cze', 'lip', 'sie', 'wrz', 'paz', 'lis', 'gru'];
    const month = months[d.getMonth()];
    const weekdays = ['Niedziela', 'Poniedzialek', 'Wtorek', 'Sroda', 'Czwartek', 'Piatek', 'Sobota'];
    const weekday = weekdays[d.getDay()];

    const mapsUrl = ev.address
      ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(ev.address)}`
      : '';

    const calStart = formatGCalDate(ev.date, ev.time);
    const calEnd = formatGCalDate(ev.date, ev.time, 2);
    const calUrl = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(ev.title)}&dates=${calStart}/${calEnd}&details=${encodeURIComponent(ev.shortDesc || '')}&location=${encodeURIComponent((ev.location || '') + ', ' + (ev.address || ''))}&ctz=Europe/Berlin`;

    const fullDescHtml = ev.fullDesc
      ? ev.fullDesc.replace(/\n/g, '<br>')
      : (ev.shortDesc || '');

    const eventUrl = `event.html?id=${ev.id}`;

    // Status dot: green = upcoming, gray = past
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const eventDate = new Date(ev.date);
    eventDate.setHours(0, 0, 0, 0);
    const diffDays = Math.round((eventDate - now) / (1000 * 60 * 60 * 24));

    let statusClass = 'status-upcoming';
    let statusText = 'Nadchodzi';
    if (diffDays === 0) {
      statusClass = 'status-today';
      statusText = 'Dzisiaj';
    } else if (diffDays <= 3) {
      statusClass = 'status-soon';
      statusText = 'Wkrotce';
    } else if (diffDays < 0) {
      statusClass = 'status-past';
      statusText = 'Minione';
    }

    const statusDot = `<span class="event-status ${statusClass}"><span class="status-dot"></span>${statusText}</span>`;

    const timeDisplay = ev.time ? (ev.endTime ? `${ev.time} - ${ev.endTime}` : ev.time) : '';

    if (ev.imageUrl) {
      // Luma style: image left, text right
      return `
        <a href="${eventUrl}" class="event-card has-image reveal">
          <div class="event-card-image"><img src="${ev.imageUrl}" alt="${ev.title}" loading="lazy"></div>
          <div class="event-card-info">
            ${statusDot}
            <h3 class="event-title">${ev.title}</h3>
            <p class="event-meta">${weekday}${timeDisplay ? ', ' + timeDisplay : ''}${ev.location ? ' · ' + ev.location : ''}</p>
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
          <h3 class="event-title">${ev.title}</h3>
          <p class="event-meta">${weekday}${timeDisplay ? ' · ' + timeDisplay : ''}${ev.location ? ' · ' + ev.location : ''}</p>
        </div>
        <span class="event-expand-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 5l7 7-7 7"/></svg>
        </span>
      </a>
    `;
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
  // Contact Form
  // ============================================
  function initContactForm() {
    const form = document.getElementById('contactForm');
    if (!form) return;

    form.addEventListener('submit', function(e) {
      e.preventDefault();

      const name = document.getElementById('name').value.trim();
      const email = document.getElementById('email').value.trim();
      const subject = document.getElementById('subject').value.trim();
      const message = document.getElementById('message').value.trim();

      // Basic validation
      if (!name || !email || !subject || !message) {
        alert('Prosimy wypelnic wszystkie pola.');
        return;
      }

      const body = `Imie: ${name}\nE-mail: ${email}\n\n${message}`;
      const mailtoLink = `mailto:pmk@pmk-berlin.de?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

      window.location.href = mailtoLink;
    });
  }

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
