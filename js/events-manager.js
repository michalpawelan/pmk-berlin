/**
 * PMK Berlin - Events Manager
 * Laedt Events aus Google Sheets (kostenlos, kein API-Key noetig)
 */

const EventsManager = (function() {
  'use strict';

  // ============================================
  // Konfiguration - HIER ANPASSEN
  // ============================================
  const CONFIG = {
    // Google Sheet ID (aus der URL: https://docs.google.com/spreadsheets/d/DIESE_ID_HIER/...)
    SHEET_ID: '1tPc4twR0CoefnHDoODo-a5opSK35ogDmZHyzB_uhb1w',

    // Sheet Name (Tab-Name unten in der Tabelle)
    SHEET_NAME: 'Tabellenblatt1',

    // Fallback auf lokale JSON wenn Google Sheets nicht erreichbar
    FALLBACK_JSON: 'events.json',

    // Cache-Dauer in Minuten
    CACHE_DURATION: 5
  };

  // SPALTEN (8 Spalten - alles auf Polnisch):
  // A: Tytul    B: Data    C: Godzina    D: Opis    E: Zdjecie (URL)    F: Miejsce    G: Adres    H: Opublikowane (TAK/NIE)

  let eventsCache = null;
  let cacheTimestamp = null;

  // ============================================
  // Google Sheets laden
  // ============================================
  async function fetchFromGoogleSheets() {
    const url = `https://docs.google.com/spreadsheets/d/${CONFIG.SHEET_ID}/gviz/tq?tqx=out:json&sheet=${encodeURIComponent(CONFIG.SHEET_NAME)}&headers=1`;

    try {
      const response = await fetch(url);
      const text = await response.text();

      const jsonString = text.match(/google\.visualization\.Query\.setResponse\(([\s\S]*)\);?/);
      if (!jsonString || !jsonString[1]) {
        throw new Error('Ungueltiges Google Sheets Format');
      }

      const data = JSON.parse(jsonString[1]);
      return parseGoogleSheetsData(data);
    } catch (error) {
      console.warn('[EventsManager] Google Sheets nicht erreichbar, lade Fallback:', error);
      return fetchFromFallback();
    }
  }

  function parseGoogleSheetsData(data) {
    const rows = data.table.rows;
    const events = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (!row.c || !row.c[0]) continue;

      const getValue = (index) => {
        const cell = row.c[index];
        return cell ? (cell.v || cell.f || '') : '';
      };

      // Spalte H: Nur veroeffentlichte Events
      const published = getValue(7);
      if (published && String(published).toUpperCase() === 'NIE') continue;

      // Datum parsen (Spalte B)
      let dateStr = '';
      const dateCell = row.c && row.c[1];
      if (dateCell) {
        const rawVal = dateCell.v;
        const fmtVal = dateCell.f;
        const dateMatch = String(rawVal || '').match(/Date\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*/);
        if (dateMatch) {
          dateStr = `${dateMatch[1]}-${String(parseInt(dateMatch[2])+1).padStart(2,'0')}-${String(dateMatch[3]).padStart(2,'0')}`;
        }
        if (!dateStr && fmtVal) {
          const iso = String(fmtVal).match(/(\d{4})-(\d{2})-(\d{2})/);
          if (iso) dateStr = fmtVal;
        }
        if (!dateStr && fmtVal) {
          const de = String(fmtVal).match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
          if (de) dateStr = `${de[3]}-${de[2].padStart(2,'0')}-${de[1].padStart(2,'0')}`;
        }
        if (!dateStr && rawVal) dateStr = String(rawVal);
      }

      // ID aus Titel generieren
      const title = getValue(0);
      const slug = title.toLowerCase()
        .replace(/[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/g, c => ({'ą':'a','ć':'c','ę':'e','ł':'l','ń':'n','ó':'o','ś':'s','ź':'z','ż':'z','Ą':'a','Ć':'c','Ę':'e','Ł':'l','Ń':'n','Ó':'o','Ś':'s','Ź':'z','Ż':'z'}[c] || c))
        .replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');

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

      const description = getValue(3);
      const location = getValue(5) || 'Johannes-Basilika';
      const address = getValue(6) || 'Lilienthalstraße 5, 10965 Berlin';

      events.push({
        id: slug || `event-${i}`,
        title: title,
        date: dateStr,
        time: timeStr,
        endTime: endTimeStr || undefined,
        shortDesc: description.length > 120 ? description.substring(0, 120) + '...' : description,
        fullDesc: description,
        imageUrl: convertGoogleDriveUrl(getValue(4)),
        location: location,
        address: address
      });
    }

    return events.filter(e => e.title && e.date);
  }

  async function fetchFromFallback() {
    try {
      const response = await fetch(CONFIG.FALLBACK_JSON);
      return await response.json();
    } catch (error) {
      console.error('[EventsManager] Fallback JSON auch nicht erreichbar:', error);
      return [];
    }
  }

  // Google Drive Links in direkte Bild-URLs umwandeln
  function convertGoogleDriveUrl(url) {
    if (!url) return '';
    const driveMatch = url.match(/\/d\/([a-zA-Z0-9_-]+)/) ||
                       url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
    if (driveMatch) {
      return `https://lh3.googleusercontent.com/d/${driveMatch[1]}=w800`;
    }
    return url;
  }

  // ============================================
  // Cache Management
  // ============================================
  async function getEvents(forceRefresh = false) {
    const now = Date.now();
    const cacheValid = cacheTimestamp &&
      (now - cacheTimestamp) < (CONFIG.CACHE_DURATION * 60 * 1000);

    if (!forceRefresh && cacheValid && eventsCache) {
      return eventsCache;
    }

    eventsCache = await fetchFromGoogleSheets();
    cacheTimestamp = now;
    return eventsCache;
  }

  // ============================================
  // Event Filtering & Sorting
  // ============================================
  async function getUpcomingEvents(limit = 10) {
    const events = await getEvents();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return events
      .filter(e => new Date(e.date) >= today)
      .sort((a, b) => new Date(a.date) - new Date(b.date))
      .slice(0, limit);
  }

  async function getFeaturedEvents() {
    const events = await getEvents();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return events
      .filter(e => e.featured && new Date(e.date) >= today)
      .sort((a, b) => new Date(a.date) - new Date(b.date));
  }

  async function getEventsByCategory(category) {
    const events = await getEvents();
    return events.filter(e =>
      (e.category || '').toLowerCase() === category.toLowerCase()
    );
  }

  async function getEventById(id) {
    const events = await getEvents();
    return events.find(e => e.id === id);
  }

  // ============================================
  // Kalender-Export
  // ============================================
  function generateICS(event) {
    const startDate = formatICSDate(event.date, event.time);
    const endDate = formatICSDate(event.date, event.time, 2);

    const ics = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//PMK Berlin//Events//PL',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'BEGIN:VEVENT',
      `DTSTART:${startDate}`,
      `DTEND:${endDate}`,
      `SUMMARY:${escapeICS(event.title)}`,
      `DESCRIPTION:${escapeICS(event.shortDesc || event.fullDesc)}`,
      `LOCATION:${escapeICS((event.location || '') + ', ' + (event.address || ''))}`,
      `UID:${event.id}@pmk-berlin.de`,
      'END:VEVENT',
      'END:VCALENDAR'
    ].join('\r\n');

    return ics;
  }

  function formatICSDate(date, time, addHours = 0) {
    const d = new Date(date);
    if (time) {
      const [hours, minutes] = time.split(':');
      d.setHours(parseInt(hours) + addHours, parseInt(minutes), 0);
    }
    return d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  }

  function escapeICS(text) {
    if (!text) return '';
    return text
      .replace(/\\/g, '\\\\')
      .replace(/;/g, '\\;')
      .replace(/,/g, '\\,')
      .replace(/\n/g, '\\n');
  }

  function downloadICS(event) {
    const ics = generateICS(event);
    const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.href = url;
    link.download = `${event.id}.ics`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  function getGoogleCalendarUrl(event) {
    const startDate = formatGoogleDate(event.date, event.time);
    const endDate = formatGoogleDate(event.date, event.time, 2);

    const params = new URLSearchParams({
      action: 'TEMPLATE',
      text: event.title,
      dates: `${startDate}/${endDate}`,
      details: event.shortDesc || event.fullDesc || '',
      location: `${event.location || ''}, ${event.address || ''}`,
      ctz: 'Europe/Berlin'
    });

    return `https://calendar.google.com/calendar/render?${params.toString()}`;
  }

  function formatGoogleDate(date, time, addHours = 0) {
    const d = new Date(date);
    if (time) {
      const [hours, minutes] = time.split(':');
      d.setHours(parseInt(hours) + addHours, parseInt(minutes), 0);
    }
    return d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  }

  // ============================================
  // Google Maps
  // ============================================
  function getGoogleMapsEmbedUrl(address) {
    return `https://www.google.com/maps/embed/v1/place?key=YOUR_MAPS_API_KEY&q=${encodeURIComponent(address)}`;
  }

  function getGoogleMapsUrl(address) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
  }

  // ============================================
  // Datum Formatierung
  // ============================================
  function formatDate(dateStr, options = {}) {
    const date = new Date(dateStr);
    const defaultOptions = {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    };
    return date.toLocaleDateString('pl-PL', { ...defaultOptions, ...options });
  }

  function formatDateShort(dateStr) {
    const date = new Date(dateStr);
    const day = String(date.getDate()).padStart(2, '0');
    const months = ['sty', 'lut', 'mar', 'kwi', 'maj', 'cze', 'lip', 'sie', 'wrz', 'paz', 'lis', 'gru'];
    return { day, month: months[date.getMonth()] };
  }

  function getWeekday(dateStr) {
    const weekdays = ['Niedziela', 'Poniedzialek', 'Wtorek', 'Sroda', 'Czwartek', 'Piatek', 'Sobota'];
    return weekdays[new Date(dateStr).getDay()];
  }

  // ============================================
  // Public API
  // ============================================
  return {
    setSheetId: (id) => CONFIG.SHEET_ID = id,
    setApiKey: (key) => CONFIG.API_KEY = key,

    getEvents,
    getUpcomingEvents,
    getFeaturedEvents,
    getEventsByCategory,
    getEventById,

    downloadICS,
    getGoogleCalendarUrl,

    getGoogleMapsUrl,
    getGoogleMapsEmbedUrl,

    formatDate,
    formatDateShort,
    getWeekday
  };
})();

window.EventsManager = EventsManager;
