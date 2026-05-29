/**
 * =====================================================
 * PMK Berlin - Google Apps Script Backend
 * =====================================================
 *
 * ANLEITUNG ZUR EINRICHTUNG:
 *
 * 1. Oeffne dein Google Sheet:
 *    https://docs.google.com/spreadsheets/d/1tPc4twR0CoefnHDoODo-a5opSK35ogDmZHyzB_uhb1w/
 *
 * 2. Gehe zu: Erweiterungen > Apps Script
 *
 * 3. Loesche den vorhandenen Code und fuege DIESEN gesamten Code ein
 *
 * 4. Klicke auf "Bereitstellen" > "Neue Bereitstellung"
 *    - Typ: "Web-App"
 *    - Ausfuehren als: "Ich" (dein Google-Account)
 *    - Zugriff: "Jeder" (damit die Admin-Seite darauf zugreifen kann)
 *
 * 5. Kopiere die Web-App-URL und trage sie in admin/auth.js ein
 *    (Konstante APPS_SCRIPT_URL ganz oben in der Datei)
 *
 * 6. Aendere den ADMIN_PIN unten, wenn gewuenscht
 *
 * 7. NEUER TAB "Ogloszenia" (Ogloszenia duszpasterskie):
 *    - Lege im gleichen Google Sheet einen neuen Tab namens "Ogloszenia" an
 *    - Header in Zeile 1 (Spalten A-G):
 *      id | title | body | image_url | published_at | expires_at | published
 *    - id = UUID (Utilities.getUuid()), wird automatisch beim Einfuegen gesetzt
 *    - published_at / expires_at = ISO 8601 Strings (UTC), expires_at = published_at + 7 Tage
 *    - published = "TAK" / "NIE" (wie bei Wydarzenia)
 *
 * =====================================================
 */

const SHEET_ID = '1tPc4twR0CoefnHDoODo-a5opSK35ogDmZHyzB_uhb1w';
const SHEET_NAME = 'Tabellenblatt1';
const NEWSLETTER_SHEET_NAME = 'Newsletter';
const OGLOSZENIA_SHEET_NAME = 'Ogloszenia';
const OGLOSZENIA_TTL_DAYS = 7;
const ADMIN_PIN = 'pmk2026';

// Google Drive Ordner fuer Bilder (wird automatisch erstellt)
const DRIVE_FOLDER_NAME = 'PMK_Events_Bilder';

// Spalten: A:Tytul  B:Data  C:Godzina  D:Opis  E:Zdjecie  F:Miejsce  G:Adres  H:Opublikowane  I:Wspolnota
// Newsletter-Tab Spalten: A:Email  B:Data  C:Jezyk  D:Zrodlo
// Ogloszenia-Tab Spalten: A:id  B:title  C:body  D:image_url  E:published_at  F:expires_at  G:published

function getSheet() {
  return SpreadsheetApp.openById(SHEET_ID).getSheetByName(SHEET_NAME);
}

function getNewsletterSheet() {
  return SpreadsheetApp.openById(SHEET_ID).getSheetByName(NEWSLETTER_SHEET_NAME);
}

function getOgloszeniaSheet() {
  return SpreadsheetApp.openById(SHEET_ID).getSheetByName(OGLOSZENIA_SHEET_NAME);
}

function jsonResponse(obj) {
  const output = ContentService.createTextOutput();
  output.setMimeType(ContentService.MimeType.JSON);
  output.setContent(JSON.stringify(obj));
  return output;
}

function doGet(e) {
  const params = (e && e.parameter) || {};
  if (params.action === 'subscribe') {
    return jsonResponse(subscribeNewsletter(params));
  }
  return handleRequest(e);
}

function doPost(e) {
  const params = e.parameter || {};

  // Oeffentliche Newsletter-Anmeldung (kein PIN)
  if (params.action === 'subscribe') {
    return jsonResponse(subscribeNewsletter(params));
  }

  // PIN-Pruefung
  if (params.pin !== ADMIN_PIN) {
    const output = ContentService.createTextOutput();
    output.setMimeType(ContentService.MimeType.JSON);
    output.setContent(JSON.stringify({ success: false, error: 'Nieprawidlowy PIN' }));
    return output;
  }

  // Upload-Aktion: Bilddaten kommen im Body
  if (params.action === 'upload') {
    const output = ContentService.createTextOutput();
    output.setMimeType(ContentService.MimeType.JSON);
    try {
      const postData = e.postData ? JSON.parse(e.postData.contents) : {};
      const result = uploadImage(postData);
      output.setContent(JSON.stringify(result));
    } catch (err) {
      output.setContent(JSON.stringify({ success: false, error: err.toString() }));
    }
    return output;
  }

  return handleRequest(e);
}

function handleRequest(e) {
  const params = e.parameter || {};
  const action = params.action;
  const pin = params.pin;

  // CORS headers
  const output = ContentService.createTextOutput();
  output.setMimeType(ContentService.MimeType.JSON);

  // PIN-Pruefung
  if (pin !== ADMIN_PIN) {
    output.setContent(JSON.stringify({ success: false, error: 'Nieprawidlowy PIN' }));
    return output;
  }

  try {
    let result;

    switch (action) {
      case 'list':
        result = listEvents();
        break;
      case 'list_subscribers':
        result = listSubscribers();
        break;
      case 'add':
        result = addEvent(params);
        break;
      case 'update':
        result = updateEvent(params);
        break;
      case 'delete':
        result = deleteEvent(params);
        break;
      case 'toggle':
        result = togglePublish(params);
        break;
      case 'upload':
        result = uploadImage(params);
        break;
      case 'listOgloszenia':
        result = listOgloszenia();
        break;
      case 'addOgloszenie':
        result = addOgloszenie(params);
        break;
      case 'updateOgloszenie':
        result = updateOgloszenie(params);
        break;
      case 'deleteOgloszenie':
        result = deleteOgloszenie(params);
        break;
      case 'toggleOgloszeniePublish':
        result = toggleOgloszeniePublish(params);
        break;
      default:
        result = { success: false, error: 'Nieznana akcja: ' + action };
    }

    output.setContent(JSON.stringify(result));
  } catch (err) {
    output.setContent(JSON.stringify({ success: false, error: err.toString() }));
  }

  return output;
}

/**
 * Alle Events auflisten
 */
function listEvents() {
  const sheet = getSheet();
  const data = sheet.getDataRange().getValues();
  const events = [];

  // Erste Zeile = Header, ab Zeile 2
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row[0]) continue; // Leere Zeile ueberspringen

    let dateStr = '';
    if (row[1] instanceof Date) {
      const d = row[1];
      dateStr = d.getFullYear() + '-' +
        String(d.getMonth() + 1).padStart(2, '0') + '-' +
        String(d.getDate()).padStart(2, '0');
    } else {
      dateStr = String(row[1] || '');
    }

    events.push({
      row: i + 1, // Zeilennummer im Sheet (1-basiert)
      title: String(row[0] || ''),
      date: dateStr,
      time: String(row[2] || ''),
      description: String(row[3] || ''),
      image: String(row[4] || ''),
      location: String(row[5] || ''),
      address: String(row[6] || ''),
      published: String(row[7] || 'TAK').toUpperCase(),
      community: String(row[8] || '')   // NEW
    });
  }

  // Nach Datum sortieren (neueste zuerst)
  events.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  return { success: true, events: events };
}

/**
 * Neues Event hinzufuegen
 */
function addEvent(params) {
  const sheet = getSheet();

  const newRow = [
    params.title || '',
    params.date || '',
    params.time || '',
    params.description || '',
    params.image || '',
    params.location || '',
    params.address || '',
    params.published || 'TAK',
    params.community || ''   // NEW
  ];

  sheet.appendRow(newRow);
  SpreadsheetApp.flush();

  return { success: true, message: 'Wydarzenie dodane' };
}

/**
 * Event aktualisieren
 */
function updateEvent(params) {
  const sheet = getSheet();
  const row = parseInt(params.row);

  if (!row || row < 2) {
    return { success: false, error: 'Nieprawidlowy wiersz' };
  }

  const range = sheet.getRange(row, 1, 1, 9);
  range.setValues([[
    params.title || '',
    params.date || '',
    params.time || '',
    params.description || '',
    params.image || '',
    params.location || '',
    params.address || '',
    params.published || 'TAK',
    params.community || ''   // NEW
  ]]);
  SpreadsheetApp.flush();

  return { success: true, message: 'Wydarzenie zaktualizowane' };
}

/**
 * Event loeschen
 */
function deleteEvent(params) {
  const sheet = getSheet();
  const row = parseInt(params.row);

  if (!row || row < 2) {
    return { success: false, error: 'Nieprawidlowy wiersz' };
  }

  // Zeile leeren statt loeschen (sicherer, listEvents ueberspringt leere Zeilen)
  sheet.getRange(row, 1, 1, 9).clearContent();
  SpreadsheetApp.flush();

  return { success: true, message: 'Wydarzenie usuniete' };
}

/**
 * Veroeffentlichungsstatus umschalten
 */
function togglePublish(params) {
  const sheet = getSheet();
  const row = parseInt(params.row);

  if (!row || row < 2) {
    return { success: false, error: 'Nieprawidlowy wiersz' };
  }

  const currentValue = String(sheet.getRange(row, 8).getValue() || 'TAK').toUpperCase();
  const newValue = currentValue === 'TAK' ? 'NIE' : 'TAK';
  sheet.getRange(row, 8).setValue(newValue);
  SpreadsheetApp.flush();

  return { success: true, message: 'Status zmieniony na: ' + newValue, published: newValue };
}

/**
 * Oeffentliche Newsletter-Anmeldung
 * Schreibt in Tab "Newsletter" (A:Email, B:Data, C:Jezyk, D:Zrodlo)
 * Kein PIN noetig. Duplikate werden ignoriert.
 */
function subscribeNewsletter(params) {
  const rawEmail = String(params.email || '').trim().toLowerCase();
  if (!rawEmail || rawEmail.length > 254) {
    return { success: false, error: 'invalid_email' };
  }
  // Einfache E-Mail-Validierung
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail)) {
    return { success: false, error: 'invalid_email' };
  }

  const lang = String(params.lang || 'pl').toLowerCase().slice(0, 2);
  const source = String(params.source || '').slice(0, 200);

  const sheet = getNewsletterSheet();
  if (!sheet) {
    return { success: false, error: 'sheet_missing' };
  }

  // Duplikat-Check (Spalte A)
  const values = sheet.getRange('A:A').getValues();
  for (let i = 0; i < values.length; i++) {
    if (String(values[i][0] || '').trim().toLowerCase() === rawEmail) {
      return { success: true, message: 'already_subscribed', duplicate: true };
    }
  }

  sheet.appendRow([rawEmail, new Date(), lang, source]);
  SpreadsheetApp.flush();

  return { success: true, message: 'subscribed' };
}

/**
 * Alle Newsletter-Abonnenten auflisten.
 * Output: { success: true, subscribers: [{email, lang, source, created_at}, ...] }
 *
 * Spaltenreihenfolge im Sheet (wie subscribeNewsletter schreibt):
 *   A (0): Email  |  B (1): Data (created_at)  |  C (2): Jezyk (lang)  |  D (3): Zrodlo (source)
 */
function listSubscribers() {
  const sheet = getNewsletterSheet();
  if (!sheet) return { success: true, subscribers: [] };
  const data = sheet.getDataRange().getValues();
  const out = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row[0]) continue;
    out.push({
      email: String(row[0]),
      lang: String(row[2] || ''),
      source: String(row[3] || ''),
      created_at: row[1] instanceof Date ? row[1].toISOString() : String(row[1] || '')
    });
  }
  // Neueste zuerst
  out.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
  return { success: true, subscribers: out };
}

/**
 * Bild in Google Drive hochladen
 * Akzeptiert params aus URL-Parametern oder POST-Body
 */
function uploadImage(params) {
  const fileName = params.fileName || ('event-' + Date.now() + '.jpg');
  const mimeType = params.mimeType || 'image/jpeg';
  const base64Data = params.data;

  if (!base64Data) {
    return { success: false, error: 'Brak danych obrazu' };
  }

  // Ordner finden oder erstellen
  let folder;
  const folders = DriveApp.getFoldersByName(DRIVE_FOLDER_NAME);
  if (folders.hasNext()) {
    folder = folders.next();
  } else {
    folder = DriveApp.createFolder(DRIVE_FOLDER_NAME);
  }

  // Bild erstellen
  const blob = Utilities.newBlob(Utilities.base64Decode(base64Data), mimeType, fileName);
  const file = folder.createFile(blob);

  // Oeffentlich lesbar machen
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

  const fileId = file.getId();
  const imageUrl = 'https://drive.google.com/file/d/' + fileId + '/view';

  return {
    success: true,
    message: 'Obraz przesłany',
    fileId: fileId,
    imageUrl: imageUrl
  };
}

/* =====================================================
 * OGLOSZENIA DUSZPASTERSKIE (wochentliche Bulletins)
 * Spalten: A:id B:title C:body D:image_url E:published_at F:expires_at G:published
 * TTL: 7 Tage (siehe OGLOSZENIA_TTL_DAYS). expires_at wird beim Insert berechnet
 * und beim Update NICHT zurueckgesetzt.
 * ===================================================== */

/**
 * Alle aktiven Ogloszenia auflisten.
 * Filter: published === "TAK" UND expires_at > now.
 * Sortierung: published_at DESC (neueste zuerst).
 */
function listOgloszenia() {
  const sheet = getOgloszeniaSheet();
  if (!sheet) return { success: true, ogloszenia: [] };
  const data = sheet.getDataRange().getValues();
  const now = new Date().toISOString();
  const out = [];

  // Erste Zeile = Header, ab Zeile 2
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row[0]) continue; // Leere Zeile (keine id) ueberspringen

    const publishedAt = row[4] instanceof Date ? row[4].toISOString() : String(row[4] || '');
    const expiresAt = row[5] instanceof Date ? row[5].toISOString() : String(row[5] || '');
    const published = String(row[6] || 'TAK').toUpperCase();

    if (published !== 'TAK') continue;
    if (expiresAt && expiresAt <= now) continue;

    out.push({
      row: i + 1, // 1-basierte Zeilennummer (intern, fuer Debug)
      id: String(row[0] || ''),
      title: String(row[1] || ''),
      body: String(row[2] || ''),
      image_url: String(row[3] || ''),
      published_at: publishedAt,
      expires_at: expiresAt,
      published: published
    });
  }

  // Neueste zuerst
  out.sort((a, b) => (b.published_at || '').localeCompare(a.published_at || ''));

  return { success: true, ogloszenia: out };
}

/**
 * Neue Ogloszenie hinzufuegen.
 * Erwartet: params.title, params.body, params.image_url (optional),
 *           params.draft === 'true' => published = 'NIE', sonst 'TAK'.
 * Setzt automatisch: id (UUID), published_at (now), expires_at (now + 7d).
 */
function addOgloszenie(params) {
  const sheet = getOgloszeniaSheet();
  if (!sheet) return { success: false, error: 'Brak arkusza Ogloszenia' };

  const id = Utilities.getUuid();
  const now = new Date();
  const publishedAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + OGLOSZENIA_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const published = (String(params.draft || '').toLowerCase() === 'true') ? 'NIE' : 'TAK';

  const newRow = [
    id,
    params.title || '',
    params.body || '',
    params.image_url || '',
    publishedAt,
    expiresAt,
    published
  ];

  sheet.appendRow(newRow);
  SpreadsheetApp.flush();

  return {
    success: true,
    message: 'Ogloszenie dodane',
    id: id,
    published_at: publishedAt,
    expires_at: expiresAt,
    published: published
  };
}

/**
 * Ogloszenie aktualisieren (Suche per id).
 * Aktualisiert title, body, image_url, published.
 * published_at und expires_at bleiben UNVERAENDERT (wer Sichtbarkeit verlaengern
 * will, soll loeschen und neu anlegen).
 */
function updateOgloszenie(params) {
  const sheet = getOgloszeniaSheet();
  if (!sheet) return { success: false, error: 'Brak arkusza Ogloszenia' };

  const id = String(params.id || '');
  if (!id) return { success: false, error: 'Brak id' };

  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0] || '') === id) {
      const row = i + 1; // 1-basiert
      // Nur Spalten B,C,D,G aktualisieren; E,F unangetastet lassen
      sheet.getRange(row, 2).setValue(params.title || '');
      sheet.getRange(row, 3).setValue(params.body || '');
      sheet.getRange(row, 4).setValue(params.image_url || '');
      if (typeof params.published !== 'undefined') {
        sheet.getRange(row, 7).setValue(params.published || 'TAK');
      }
      SpreadsheetApp.flush();
      return { success: true, message: 'Ogloszenie zaktualizowane' };
    }
  }

  return { success: false, error: 'Nie znaleziono ogloszenia o id: ' + id };
}

/**
 * Ogloszenie loeschen (Suche per id).
 * Inhalt der Zeile wird geleert (listOgloszenia ueberspringt leere id-Zellen).
 */
function deleteOgloszenie(params) {
  const sheet = getOgloszeniaSheet();
  if (!sheet) return { success: false, error: 'Brak arkusza Ogloszenia' };

  const id = String(params.id || '');
  if (!id) return { success: false, error: 'Brak id' };

  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0] || '') === id) {
      const row = i + 1;
      sheet.getRange(row, 1, 1, 7).clearContent();
      SpreadsheetApp.flush();
      return { success: true, message: 'Ogloszenie usuniete' };
    }
  }

  return { success: false, error: 'Nie znaleziono ogloszenia o id: ' + id };
}

/**
 * Veroeffentlichungsstatus eines Ogloszenia umschalten (Suche per id).
 * Spiegelt togglePublish fuer Events.
 */
function toggleOgloszeniePublish(params) {
  const sheet = getOgloszeniaSheet();
  if (!sheet) return { success: false, error: 'Brak arkusza Ogloszenia' };

  const id = String(params.id || '');
  if (!id) return { success: false, error: 'Brak id' };

  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0] || '') === id) {
      const row = i + 1;
      const currentValue = String(sheet.getRange(row, 7).getValue() || 'TAK').toUpperCase();
      const newValue = currentValue === 'TAK' ? 'NIE' : 'TAK';
      sheet.getRange(row, 7).setValue(newValue);
      SpreadsheetApp.flush();
      return { success: true, message: 'Status zmieniony na: ' + newValue, published: newValue };
    }
  }

  return { success: false, error: 'Nie znaleziono ogloszenia o id: ' + id };
}
