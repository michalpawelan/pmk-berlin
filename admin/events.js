// admin/events.js — Logik fuer den Events-Tab.
// Datenquelle: Google Apps Script via Auth.url.

const Events = (function() {
  'use strict';

  const COMMUNITIES = [
    { slug: 'apostolstwo',         name: 'Apostolstwo',           color: '#c97a3f' },
    { slug: 'domowy-kosciol',      name: 'Domowy Kościół',        color: '#5a7691' },
    { slug: 'grono-dzieci-maryi',  name: 'Grono Dzieci Maryi',    color: '#a06593' },
    { slug: 'grupa-kobiet',        name: 'Grupa kobiet',          color: '#b86b8a' },
    { slug: 'grupa-meska',         name: 'Grupa męska',           color: '#4f7a5a' },
    { slug: 'ministranci',         name: 'Ministranci',           color: '#5a8a4a' },
    { slug: 'radio-maryja',        name: 'Radio Maryja',          color: '#7a5fbf' },
    { slug: 'ruch-swiatlo-zycie',  name: 'Ruch Światło-Życie',    color: '#bfa340' },
    { slug: 'ruch-szensztacki',    name: 'Ruch Szensztacki',      color: '#c98a7b' },
    { slug: 'schola',              name: 'Schola',                color: '#9a7fb8' },
    { slug: 'sne',                 name: 'SNE',                   color: '#b88a47' },
    { slug: 'zywy-rozaniec',       name: 'Żywy Różaniec',         color: '#8c4f6f' }
  ];

  // ============================================
  // State
  // ============================================
  let allEvents = [];
  let filteredEvents = [];
  let editingRow = null;
  let pendingConfirmCallback = null;
  let activeFilter = 'upcoming';

  // ============================================
  // API
  // ============================================
  // apiCall: returns the raw Apps Script response shape ({ success, error, ... }).
  // Auth.verify() returns the normalized { ok, error, events } — do not conflate them.
  async function apiCall(action, params = {}) {
    const url = new URL(Auth.url);
    url.searchParams.set('action', action);
    url.searchParams.set('pin', params.pin || Auth.getPin());

    Object.entries(params).forEach(([key, val]) => {
      if (key !== 'pin') url.searchParams.set(key, val);
    });

    const response = await fetch(url.toString(), { redirect: 'follow' });
    const text = await response.text();
    try { return JSON.parse(text); } catch (e) { return { success: false, error: 'Błąd serwera' }; }
  }

  async function refreshEvents() {
    try {
      const result = await apiCall('list');
      if (result.success) {
        allEvents = result.events || [];
        renderEvents();
        updateStats();
      } else {
        showRetryState();
      }
    } catch (err) {
      showRetryState();
    }
  }

  function showRetryState() {
    const container = document.getElementById('eventsTableContainer');
    container.innerHTML = `
      <div class="events-empty-state">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="width:48px;height:48px;color:var(--color-warm-300);margin:0 auto 1rem;">
          <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
        <p>Nie udało się załadować wydarzeń.</p>
        <button class="btn btn-primary" style="margin-top:1rem;" onclick="refreshEvents()">Spróbuj ponownie</button>
      </div>`;
  }

  // ============================================
  // Filter Tabs
  // ============================================
  function setFilter(filter) {
    activeFilter = filter;
    document.querySelectorAll('.filter-tab').forEach(tab => {
      tab.classList.toggle('active', tab.dataset.filter === filter);
    });
    renderEvents();
  }

  // ============================================
  // Render Events Table
  // ============================================
  function renderEvents() {
    const container = document.getElementById('eventsTableContainer');
    const search = (document.getElementById('searchInput').value || '').toLowerCase();
    const today = new Date().toISOString().split('T')[0];

    // Normalize dates first
    allEvents.forEach(ev => { ev.date = normalizeDate(ev.date); });

    // Update filter tab counts
    const upcomingCount = allEvents.filter(e => e.date >= today).length;
    const pastCount = allEvents.filter(e => e.date < today).length;
    document.getElementById('countAll').textContent = allEvents.length;
    document.getElementById('countUpcoming').textContent = upcomingCount;
    document.getElementById('countPast').textContent = pastCount;

    // Apply filter
    filteredEvents = allEvents.filter(ev => {
      if (activeFilter === 'upcoming' && ev.date < today) return false;
      if (activeFilter === 'past' && ev.date >= today) return false;
      if (search) {
        return (ev.title || '').toLowerCase().includes(search) ||
               (ev.description || '').toLowerCase().includes(search) ||
               (ev.location || '').toLowerCase().includes(search) ||
               (ev.date || '').includes(search);
      }
      return true;
    });

    document.getElementById('eventCount').textContent = filteredEvents.length;

    if (filteredEvents.length === 0) {
      const msgs = {
        all: 'Brak wydarzeń. Dodaj pierwsze!',
        upcoming: 'Brak nadchodzących wydarzeń.',
        past: 'Brak przeszłych wydarzeń.'
      };
      container.innerHTML = `
        <div class="events-empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <rect x="3" y="4" width="18" height="18" rx="2"/>
            <line x1="16" y1="2" x2="16" y2="6"/>
            <line x1="8" y1="2" x2="8" y2="6"/>
            <line x1="3" y1="10" x2="21" y2="10"/>
          </svg>
          <p>${search ? 'Brak wyników dla "' + search + '"' : msgs[activeFilter]}</p>
        </div>`;
      return;
    }

    let html = `
      <table class="events-table">
        <colgroup><col><col><col><col><col><col></colgroup>
        <thead>
          <tr>
            <th></th>
            <th>Wydarzenie</th>
            <th>Data</th>
            <th>Miejsce</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>`;

    filteredEvents.forEach(ev => {
      const isPast = ev.date < today;
      const isPub = ev.published === 'TAK';
      const shortDesc = ev.description.length > 50 ? ev.description.substring(0, 50) + '...' : ev.description;

      const dateFormatted = formatDatePL(ev.date);

      const imgHtml = ev.image
        ? `<img src="${convertDriveUrl(ev.image)}" class="event-row-image" alt="" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'" loading="lazy"><div class="event-row-image-placeholder" style="display:none"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg></div>`
        : `<div class="event-row-image-placeholder"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg></div>`;

      html += `
        <tr style="${isPast ? 'opacity: 0.5;' : ''}">
          <td>${imgHtml}</td>
          <td>
            <div class="event-row-title">${escapeHtml(ev.title)}</div>
            <div class="event-row-desc">${escapeHtml(shortDesc)}</div>
          </td>
          <td>
            <div class="event-row-date">${dateFormatted}</div>
            ${ev.time ? `<div class="event-row-time"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12" style="opacity:0.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> ${escapeHtml(formatTime(ev.time))}</div>` : ''}
          </td>
          <td>
            ${ev.location ? `<div class="event-row-location" title="${escapeHtml(ev.location + (ev.address ? ', ' + ev.address : ''))}">${escapeHtml(ev.location)}</div>` : ''}
          </td>
          <td>
            <span class="badge ${isPub ? 'badge-published' : 'badge-draft'}" data-action="toggle" data-row="${ev.row}" title="Kliknij aby zmienić">
              <span class="badge-dot"></span>
              ${isPub ? 'Opublikowane' : 'Szkic'}
            </span>
          </td>
          <td>
            <div class="event-actions">
              <button class="btn-icon btn-ghost" data-action="edit" data-row="${ev.row}" title="Edytuj">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              </button>
              <button class="btn-icon btn-danger" data-action="delete" data-row="${ev.row}" title="Usuń">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
              </button>
            </div>
          </td>
        </tr>`;
    });

    html += '</tbody></table>';
    container.innerHTML = html;

    // Event delegation fuer Tabellen-Aktionen
    container.querySelectorAll('[data-action]').forEach(el => {
      el.addEventListener('click', function() {
        const row = parseInt(this.dataset.row);
        const action = this.dataset.action;
        if (action === 'edit') editEvent(row);
        else if (action === 'delete') {
          const ev = allEvents.find(e => e.row === row);
          deleteEvent(row, ev ? ev.title : '');
        }
        else if (action === 'toggle') togglePublish(row);
      });
    });
  }

  function filterEvents() {
    renderEvents();
  }

  // ============================================
  // Stats
  // ============================================
  function updateStats() {
    const today = new Date().toISOString().split('T')[0];
    const total = allEvents.length;
    const published = allEvents.filter(e => e.published === 'TAK').length;
    const upcoming = allEvents.filter(e => e.date >= today).length;

    document.getElementById('statTotal').textContent = total;
    document.getElementById('statPublished').textContent = published;
    document.getElementById('statUpcoming').textContent = upcoming;
  }

  // ============================================
  // Modal: Open / Close / Populate
  // ============================================
  function openModal(row) {
    editingRow = row || null;
    const modal = document.getElementById('modalOverlay');
    const title = document.getElementById('modalTitle');
    const saveBtn = document.getElementById('saveBtn');

    if (editingRow) {
      title.textContent = 'Edytuj wydarzenie';
      saveBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><polyline points="20 6 9 17 4 12"/></svg> Zapisz zmiany';

      const ev = allEvents.find(e => e.row === row);
      if (ev) {
        document.getElementById('eventRow').value = ev.row;
        document.getElementById('eventTitle').value = ev.title;
        document.getElementById('eventDate').value = ev.date;
        loadTimeFromValue(ev.time);
        document.getElementById('eventDesc').value = ev.description;
        document.getElementById('eventImage').value = ev.image;
        document.getElementById('eventLocation').value = ev.location || 'Johannes-Basilika';
        document.getElementById('eventAddress').value = ev.address || 'Lilienthalstraße 5, 10965 Berlin';
        document.getElementById('eventPublished').checked = ev.published === 'TAK';
        showExistingImage(ev.image);
      }
    } else {
      title.textContent = 'Nowe wydarzenie';
      saveBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><polyline points="20 6 9 17 4 12"/></svg> Zapisz wydarzenie';

      document.getElementById('eventForm').reset();
      document.getElementById('eventRow').value = '';
      document.getElementById('eventLocation').value = 'Johannes-Basilika';
      document.getElementById('eventAddress').value = 'Lilienthalstraße 5, 10965 Berlin';
      document.getElementById('eventPublished').checked = true;
      document.getElementById('fileInput').value = '';
      showExistingImage('');
      loadTimeFromValue('');
    }

    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
    setTimeout(() => document.getElementById('eventTitle').focus(), 100);
  }

  function closeModal() {
    document.getElementById('modalOverlay').classList.remove('active');
    document.body.style.overflow = '';
    editingRow = null;
  }

  function closeModalOutside(e) {
    if (e.target === document.getElementById('modalOverlay')) closeModal();
  }

  // ============================================
  // Time Mode Toggle
  // ============================================
  let currentTimeMode = 'exact';

  function setTimeMode(mode) {
    // Zeit zwischen Modi übertragen
    if (mode === 'range' && currentTimeMode === 'exact') {
      const val = document.getElementById('eventTimeFrom').value;
      if (val) document.getElementById('eventTimeRangeFrom').value = val;
    } else if (mode === 'exact' && currentTimeMode === 'range') {
      const val = document.getElementById('eventTimeRangeFrom').value;
      if (val) document.getElementById('eventTimeFrom').value = val;
    }

    currentTimeMode = mode;
    document.getElementById('timeModeExact').classList.toggle('active', mode === 'exact');
    document.getElementById('timeModeRange').classList.toggle('active', mode === 'range');
    document.getElementById('timeModeExact').setAttribute('aria-pressed', mode === 'exact');
    document.getElementById('timeModeRange').setAttribute('aria-pressed', mode === 'range');
    document.getElementById('timeExact').style.display = mode === 'exact' ? '' : 'none';
    document.getElementById('timeRange').style.display = mode === 'range' ? '' : 'none';
  }

  function syncTimeToHidden() {
    if (currentTimeMode === 'exact') {
      document.getElementById('eventTime').value = document.getElementById('eventTimeFrom').value || '';
      return true;
    } else {
      const from = document.getElementById('eventTimeRangeFrom').value || '';
      const to = document.getElementById('eventTimeRangeTo').value || '';
      if (from && to && to < from) {
        showToast('Godzina zakończenia musi być późniejsza niż rozpoczęcia', 'error');
        return false;
      }
      document.getElementById('eventTime').value = (from && to) ? from + '-' + to : from || to || '';
      return true;
    }
  }

  function loadTimeFromValue(timeStr) {
    if (!timeStr) {
      setTimeMode('exact');
      document.getElementById('eventTimeFrom').value = '';
      document.getElementById('eventTimeRangeFrom').value = '10:00';
      document.getElementById('eventTimeRangeTo').value = '12:00';
      return;
    }
    if (timeStr.includes('-')) {
      const parts = timeStr.split('-');
      setTimeMode('range');
      document.getElementById('eventTimeRangeFrom').value = parts[0].trim();
      document.getElementById('eventTimeRangeTo').value = parts[1].trim();
    } else {
      setTimeMode('exact');
      document.getElementById('eventTimeFrom').value = timeStr.trim();
    }
  }

  // ============================================
  // Save Event (Create / Update)
  // ============================================
  async function handleSaveEvent(e) {
    e.preventDefault();
    const btn = document.getElementById('saveBtn');
    btn.classList.add('loading');
    btn.disabled = true;

    if (!syncTimeToHidden()) {
      btn.classList.remove('loading');
      btn.disabled = false;
      return false;
    }
    const params = {
      title: document.getElementById('eventTitle').value.trim(),
      date: document.getElementById('eventDate').value,
      time: document.getElementById('eventTime').value.trim(),
      description: document.getElementById('eventDesc').value.trim(),
      image: document.getElementById('eventImage').value.trim(),
      location: document.getElementById('eventLocation').value.trim(),
      address: document.getElementById('eventAddress').value.trim(),
      published: document.getElementById('eventPublished').checked ? 'TAK' : 'NIE'
    };

    if (!params.title.trim() || !params.date) {
      showToast('Tytuł i data są wymagane', 'error');
      btn.classList.remove('loading');
      btn.disabled = false;
      return false;
    }

    try {
      const row = document.getElementById('eventRow').value;
      let result;

      if (row) {
        params.row = row;
        result = await apiCall('update', params);
      } else {
        result = await apiCall('add', params);
      }

      if (result.success) {
        showToast(row ? 'Wydarzenie zaktualizowane' : 'Wydarzenie dodane', 'success');
        closeModal();
        await refreshEvents();
      } else {
        showToast(result.error || 'Wystąpił błąd', 'error');
      }
    } catch (err) {
      showToast('Błąd połączenia', 'error');
    }

    btn.classList.remove('loading');
    btn.disabled = false;
    return false;
  }

  // ============================================
  // Edit Event
  // ============================================
  function editEvent(row) {
    openModal(row);
  }

  // ============================================
  // Delete Event
  // ============================================
  function deleteEvent(row, title) {
    showConfirm(
      'Usunąć wydarzenie?',
      `„${title}" — tej operacji nie można cofnąć.`,
      async () => {
        // Optimistisch sofort aus der Liste entfernen
        allEvents = allEvents.filter(e => e.row !== row);
        renderEvents();
        updateStats();
        showToast('Wydarzenie usunięte', 'success');

        try {
          const result = await apiCall('delete', { row: String(row) });
          if (!result.success) {
            showToast(result.error || 'Nie udało się usunąć', 'error');
            await refreshEvents();
          }
        } catch (err) {
          showToast('Błąd połączenia', 'error');
          await refreshEvents();
        }
      }
    );
  }

  // ============================================
  // Toggle Publish
  // ============================================
  async function togglePublish(row) {
    // Optimistisch umschalten
    const ev = allEvents.find(e => e.row === row);
    if (ev) {
      ev.published = ev.published === 'TAK' ? 'NIE' : 'TAK';
      renderEvents();
      updateStats();
      showToast(ev.published === 'TAK' ? 'Opublikowane' : 'Ukryte', 'success');
    }

    try {
      await apiCall('toggle', { row: String(row) });
    } catch (err) {
      showToast('Błąd połączenia', 'error');
      await refreshEvents();
    }
  }

  // ============================================
  // Image Upload
  // ============================================
  async function handleFileSelect(files) {
    const file = files[0];
    if (!file || !file.type.startsWith('image/')) {
      showToast('Tylko pliki graficzne (JPG, PNG, WebP)', 'error');
      return;
    }

    // Show progress
    document.getElementById('uploadContent').style.display = 'none';
    document.getElementById('uploadPreview').style.display = 'none';
    document.getElementById('uploadProgress').style.display = 'flex';

    try {
      // Bild komprimieren (max 1200px breit, JPEG 80%)
      const compressed = await compressImage(file, 1200, 0.8);

      // Upload to Google Drive via Apps Script
      const base64Raw = compressed.base64;
      const base64 = 'data:image/jpeg;base64,' + base64Raw;
      const fileName = 'event-' + Date.now() + '.jpg';

      const result = await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', Auth.url + '?action=upload&pin=' + encodeURIComponent(Auth.getPin()));
        xhr.setRequestHeader('Content-Type', 'text/plain');
        xhr.onload = function() {
          try { resolve(JSON.parse(xhr.responseText)); }
          catch(e) { reject(new Error('Ungültige Antwort')); }
        };
        xhr.onerror = function() { reject(new Error('Netzwerkfehler')); };
        xhr.send(JSON.stringify({
          fileName: fileName,
          mimeType: 'image/jpeg',
          data: base64Raw
        }));
      });

      if (result.success) {
        document.getElementById('eventImage').value = result.imageUrl;

        // Show preview with local file (faster than loading from Drive)
        document.getElementById('uploadPreviewImg').src = base64;
        document.getElementById('uploadProgress').style.display = 'none';
        document.getElementById('uploadPreview').style.display = 'block';
        document.getElementById('uploadZone').classList.add('has-image');

        showToast('Zdjęcie przesłane', 'success');
      } else {
        throw new Error(result.error || 'Upload fehlgeschlagen');
      }
    } catch (err) {
      document.getElementById('uploadProgress').style.display = 'none';
      document.getElementById('uploadContent').style.display = 'flex';
      showToast('Błąd przesyłania: ' + err.message, 'error');
    }
  }

  function removeUpload(e) {
    e.stopPropagation();
    document.getElementById('eventImage').value = '';
    document.getElementById('uploadPreview').style.display = 'none';
    document.getElementById('uploadContent').style.display = 'flex';
    document.getElementById('fileInput').value = '';
    document.getElementById('uploadZone').classList.remove('has-image');
  }

  function compressImage(file, maxWidth, quality) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        let w = img.width;
        let h = img.height;

        // Skalieren wenn breiter als maxWidth
        if (w > maxWidth) {
          h = Math.round(h * maxWidth / w);
          w = maxWidth;
        }

        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);

        // Als JPEG exportieren
        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        const base64 = dataUrl.split(',')[1];

        URL.revokeObjectURL(img.src);
        resolve({ base64, dataUrl, width: w, height: h });
      };
      img.onerror = () => reject(new Error('Nie udało się załadować obrazu'));
      img.src = URL.createObjectURL(file);
    });
  }

  // Show existing image when editing
  function showExistingImage(url) {
    const uploadZone = document.getElementById('uploadZone');
    if (url) {
      document.getElementById('uploadPreviewImg').src = convertDriveUrl(url);
      document.getElementById('uploadContent').style.display = 'none';
      document.getElementById('uploadPreview').style.display = 'block';
      document.getElementById('uploadProgress').style.display = 'none';
      uploadZone.classList.add('has-image');
    } else {
      document.getElementById('uploadContent').style.display = 'flex';
      document.getElementById('uploadPreview').style.display = 'none';
      document.getElementById('uploadProgress').style.display = 'none';
      uploadZone.classList.remove('has-image');
    }
  }

  // ============================================
  // Confirm Dialog
  // ============================================
  function showConfirm(title, message, callback) {
    document.getElementById('confirmTitle').textContent = title;
    document.getElementById('confirmMessage').textContent = message;
    document.getElementById('confirmOverlay').classList.add('active');
    pendingConfirmCallback = callback;
  }

  function closeConfirm() {
    document.getElementById('confirmOverlay').classList.remove('active');
    pendingConfirmCallback = null;
  }

  function confirmCallback() {
    if (pendingConfirmCallback) pendingConfirmCallback();
    closeConfirm();
  }

  // ============================================
  // Toast Notifications
  // ============================================
  function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');

    const icons = {
      success: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
      error: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
      info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>'
    };

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `${icons[type] || icons.info} ${escapeHtml(message)}`;
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.animation = 'toastOut 0.3s var(--ease-out) forwards';
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  // ============================================
  // Helpers
  // ============================================
  function convertDriveUrl(url) {
    if (!url) return '';
    const match = url.match(/\/d\/([a-zA-Z0-9_-]+)/) || url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
    if (match) return `https://lh3.googleusercontent.com/d/${match[1]}=w800`;
    return url;
  }

  function normalizeDate(dateStr) {
    if (!dateStr) return '';
    // Already YYYY-MM-DD
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
    // Try parsing as Date string (e.g. "Wed Mar 25 2026 08:00:00 GMT...")
    const d = new Date(dateStr);
    if (!isNaN(d.getTime())) {
      return d.getFullYear() + '-' +
        String(d.getMonth() + 1).padStart(2, '0') + '-' +
        String(d.getDate()).padStart(2, '0');
    }
    return dateStr;
  }

  function formatDatePL(dateStr) {
    if (!dateStr) return '';
    const normalized = normalizeDate(dateStr);
    const weekdays = ['niedz.', 'pon.', 'wt.', 'śr.', 'czw.', 'pt.', 'sob.'];
    const months = ['sty', 'lut', 'mar', 'kwi', 'maj', 'cze', 'lip', 'sie', 'wrz', 'paź', 'lis', 'gru'];
    const parts = normalized.split('-');
    if (parts.length !== 3) return dateStr;
    const day = parseInt(parts[2]);
    const monthIdx = parseInt(parts[1]) - 1;
    const month = months[monthIdx] || '';
    const d = new Date(parseInt(parts[0]), monthIdx, day);
    const weekday = weekdays[d.getDay()] || '';
    return `${weekday} ${day} ${month} ${parts[0]}`;
  }

  function formatTime(timeStr) {
    if (!timeStr) return '';
    // "10:00-12:00" → "10:00 – 12:00"
    // "10:00" → "10:00"
    if (timeStr.includes('-')) {
      const parts = timeStr.split('-');
      return parts[0].trim() + ' – ' + parts[1].trim();
    }
    return timeStr.trim();
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ============================================
  // DOM Init (runs after defer load, DOM is ready)
  // ============================================
  function init() {
    // Drag & Drop fuer Upload-Zone
    const uploadZone = document.getElementById('uploadZone');
    if (uploadZone) {
      ['dragenter', 'dragover'].forEach(ev => {
        uploadZone.addEventListener(ev, (e) => { e.preventDefault(); uploadZone.classList.add('dragover'); });
      });
      ['dragleave', 'drop'].forEach(ev => {
        uploadZone.addEventListener(ev, (e) => { e.preventDefault(); uploadZone.classList.remove('dragover'); });
      });
      uploadZone.addEventListener('drop', (e) => {
        const files = e.dataTransfer.files;
        if (files.length > 0) handleFileSelect(files);
      });
    }

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (document.getElementById('confirmOverlay').classList.contains('active')) {
          closeConfirm();
        } else if (document.getElementById('modalOverlay').classList.contains('active')) {
          closeModal();
        }
      }
    });
  }

  // ============================================
  // setEvents: called by handleLogin to seed initial data
  // ============================================
  function setEvents(events) {
    allEvents = Array.isArray(events) ? events : [];
  }

  // ============================================
  // Public API
  // ============================================
  return {
    // Called by handleLogin
    setEvents,
    render: renderEvents,
    updateStats,
    // Called by filter tabs (also exposed on window below)
    setFilter,
    // Called by retry button (also exposed on window below)
    refresh: refreshEvents,
    // Exposed for window.* assignments below
    openModal,
    closeModal,
    closeModalOutside,
    filterEvents,
    handleSaveEvent,
    setTimeMode,
    handleFileSelect,
    removeUpload,
    closeConfirm,
    confirmCallback,
    init
  };
})();

window.Events = Events;

// ============================================
// Globale Aufrufe aus HTML onclick="..." Attributen
// ============================================
window.openModal         = Events.openModal;
window.closeModal        = Events.closeModal;
window.closeModalOutside = Events.closeModalOutside;
window.setFilter         = Events.setFilter;
window.filterEvents      = Events.filterEvents;
window.handleSaveEvent   = Events.handleSaveEvent;
window.setTimeMode       = Events.setTimeMode;
window.handleFileSelect  = Events.handleFileSelect;
window.removeUpload      = Events.removeUpload;
window.closeConfirm      = Events.closeConfirm;
window.confirmCallback   = Events.confirmCallback;
window.refreshEvents     = Events.refresh;

// Init after DOM ready (drag-and-drop + keyboard shortcuts)
window.addEventListener('DOMContentLoaded', Events.init);
