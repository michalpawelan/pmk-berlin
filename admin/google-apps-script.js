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
 * 6. Setze die Skript-Eigenschaft 'ADMIN_PIN' (Projekt-Einstellungen -> Skript-Eigenschaften) auf einen langen Zufallswert
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
// Basis-URL fuer Newsletter-Bestaetigungslinks (Double-Opt-in).
// NACH DEM DNS-CUTOVER auf 'https://www.pmk-berlin.de' aendern.
const SITE_BASE = 'https://pmk-berlinpl.netlify.app';
const OGLOSZENIA_SHEET_NAME = 'Ogloszenia';
const OGLOSZENIA_TTL_DAYS = 7;
// Tab "Zgloszenia": Anliegen, die der Voice-/Chat-Agent eskaliert (kein PIN beim Schreiben).
const ZGLOSZENIA_SHEET_NAME = 'Zgloszenia';
// Admin-PIN wird NICHT mehr im Code gespeichert (der Quelltext liegt oeffentlich im Repo).
// In Apps Script setzen: Projekt-Einstellungen -> Skript-Eigenschaften ->
// Eigenschaft 'ADMIN_PIN' = <neuer, langer Zufallswert>.
// Deny-by-default: ist die Eigenschaft NICHT gesetzt, wird JEDER Admin-Zugriff abgelehnt.
function getAdminPin_() {
  return PropertiesService.getScriptProperties().getProperty('ADMIN_PIN') || '';
}
function pinOk_(pin) {
  const configured = getAdminPin_();
  return configured !== '' && pin === configured;
}

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

function getZgloszeniaSheet() {
  return SpreadsheetApp.openById(SHEET_ID).getSheetByName(ZGLOSZENIA_SHEET_NAME);
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
  if (params.action === 'confirm') {
    return jsonResponse(confirmNewsletter(params));
  }
  return handleRequest(e);
}

function doPost(e) {
  const params = e.parameter || {};

  // Oeffentliche Newsletter-Anmeldung (kein PIN)
  if (params.action === 'subscribe') {
    return jsonResponse(subscribeNewsletter(params));
  }

  // Oeffentliche Sakrament-Anmeldung (kein PIN) — sendet E-Mails via MailApp
  if (params.action === 'sacrament') {
    return jsonResponse(registerSacrament(params));
  }

  // Oeffentliches Zgloszenie vom Voice-/Chat-Agenten (kein PIN) — schreibt ins
  // Sheet + benachrichtigt die Pfarrei per E-Mail. Wird von der Netlify-Function
  // /.netlify/functions/zgloszenie aufgerufen (die der ElevenLabs-Agent als Tool nutzt).
  if (params.action === 'zgloszenie') {
    return jsonResponse(receiveZgloszenie(params));
  }

  // PIN-Pruefung
  if (!pinOk_(params.pin)) {
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
  if (!pinOk_(pin)) {
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
      case 'listZgloszenia':
        result = listZgloszenia();
        break;
      case 'toggleZgloszenie':
        result = toggleZgloszenie(params);
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
  const firstName = String(params.first_name || '').trim().slice(0, 60);

  const sheet = getNewsletterSheet();
  if (!sheet) {
    return { success: false, error: 'sheet_missing' };
  }

  // Double-Opt-in. Spalten: A:Email B:Data C:Jezyk D:Zrodlo E:Status F:Token G:Imie
  const data = sheet.getDataRange().getValues();
  const token = Utilities.getUuid();
  let existingRow = 0;            // 1-basierte Zeilennummer, 0 = nicht vorhanden
  let existingStatus = '';
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0] || '').trim().toLowerCase() === rawEmail) {
      existingRow = i + 1;
      existingStatus = String(data[i][4] || '').toLowerCase();
      break;
    }
  }

  // Bereits bestaetigt (oder Alt-Eintrag ohne Status) -> nichts senden
  if (existingRow && (existingStatus === 'confirmed' || existingStatus === '')) {
    return { success: true, message: 'already_subscribed', duplicate: true };
  }

  if (existingRow) {
    // war "pending" -> Token auffrischen und Bestaetigung erneut senden
    sheet.getRange(existingRow, 5).setValue('pending');
    sheet.getRange(existingRow, 6).setValue(token);
    if (firstName) sheet.getRange(existingRow, 7).setValue(firstName); // G: Imie
  } else {
    sheet.appendRow([rawEmail, new Date(), lang, source, 'pending', token, firstName]);
  }
  SpreadsheetApp.flush();

  sendNewsletterConfirmation(rawEmail, lang, token);
  return { success: true, message: 'confirmation_sent' };
}

/**
 * Sendet die Double-Opt-in-Bestaetigungsmail mit Aktivierungslink.
 */
function sendNewsletterConfirmation(email, lang, token) {
  const link = SITE_BASE + '/.netlify/functions/newsletter-confirm?token=' + encodeURIComponent(token);
  let subject, body;
  if (lang === 'de') {
    subject = 'Bitte bestätige deine Newsletter-Anmeldung — PMK Berlin';
    body = 'Szczęść Boże!\n\n'
      + 'Du (oder jemand mit deiner Adresse) hat den Newsletter der Polnischen Katholischen Mission in Berlin abonniert. '
      + 'Bitte bestätige deine Anmeldung mit einem Klick auf den folgenden Link:\n\n'
      + link + '\n\n'
      + 'Erst nach dieser Bestätigung erhältst du unseren Newsletter. '
      + 'Wenn du dich nicht angemeldet hast, ignoriere diese E-Mail einfach – es wird nichts gespeichert versendet.\n\n'
      + 'Mit Gottes Segen\nPolska Misja Katolicka w Berlinie';
  } else {
    subject = 'Potwierdź subskrypcję newslettera — PMK Berlin';
    body = 'Szczęść Boże!\n\n'
      + 'Twój adres e-mail został zapisany do newslettera Polskiej Misji Katolickiej w Berlinie. '
      + 'Prosimy o potwierdzenie subskrypcji, klikając w poniższy link:\n\n'
      + link + '\n\n'
      + 'Newsletter będziesz otrzymywać dopiero po tym potwierdzeniu. '
      + 'Jeśli to nie Ty, po prostu zignoruj tę wiadomość.\n\n'
      + 'Z Panem Bogiem\nPolska Misja Katolicka w Berlinie';
  }
  MailApp.sendEmail({ to: email, subject: subject, body: body });
}

/**
 * Bestaetigt eine Newsletter-Anmeldung anhand des Tokens (Spalte F).
 * Setzt Status (Spalte E) auf "confirmed".
 */
function confirmNewsletter(params) {
  const token = String(params.token || '').trim();
  if (!token) return { success: false, error: 'no_token' };

  const sheet = getNewsletterSheet();
  if (!sheet) return { success: false, error: 'sheet_missing' };

  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][5] || '').trim() === token) {
      const row = i + 1;
      const status = String(data[i][4] || '').toLowerCase();
      if (status === 'confirmed') {
        return { success: true, message: 'already_confirmed' };
      }
      sheet.getRange(row, 5).setValue('confirmed');
      SpreadsheetApp.flush();
      return { success: true, message: 'confirmed' };
    }
  }
  return { success: false, error: 'invalid_token' };
}

/**
 * Oeffentliche Sakrament-Anmeldung (Erstkommunion / Firmung).
 * Sendet zwei E-Mails per MailApp:
 *   1) an die Pfarrei (pmk@pmk-berlin.de)
 *   2) Bestaetigung an den Absender (Eltern / Kandidat)
 * Kein PIN noetig. Daten werden NICHT im Sheet gespeichert (nur per E-Mail).
 */
function registerSacrament(params) {
  const PARISH_EMAIL = 'pmk@pmk-berlin.de';
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  const sakrament = String(params.sakrament || '').toLowerCase();
  if (sakrament !== 'komunia' && sakrament !== 'bierzmowanie') {
    return { success: false, error: 'bad_sacrament' };
  }
  const isKomunia = sakrament === 'komunia';
  const sakramentName = isKomunia ? 'Pierwszej Komunii Świętej' : 'Sakramentu Bierzmowania';

  const email = String(params.email || '').trim();
  const childName = (String(params.imiona || '') + ' ' + String(params.nazwisko || '')).trim();

  // e.parameter garantiert KEINE Key-Reihenfolge — die E-Mail muss daher eine
  // feste, druckfreundliche Reihenfolge erzwingen (Vorgabe Pfarrbuero, 10.06.2026).
  const FIELD_ORDER = [
    ['data_urodzenia', 'Data urodzenia'],
    ['miejsce_urodzenia', 'Miejsce urodzenia'],
    ['telefon', 'Telefon'],
    ['email', 'E-mail'],
    ['adres', 'Adres zamieszkania'],
    ['imie_matki', 'Imię i nazwisko matki'],
    ['imie_ojca', 'Imię i nazwisko ojca'],
    ['data_chrztu', 'Data chrztu'],
    ['miejsce_chrztu', 'Miejsce chrztu'],
    ['adres_parafii_chrztu', 'Adres parafii chrztu'],
    ['chrzest_pmk', 'Chrzest w PMK (rok/data)'],
    ['katecheza', 'Katecheza (miejsce i godzina)'],
    ['uwagi', 'Uwagi']
  ];
  const SKIP = { action: 1, pin: 1, website: 1, datenschutz: 1, sakrament: 1, metryka_data: 1, metryka_name: 1, metryka_type: 1 };

  const lines = [];
  if (childName) lines.push('Imię i nazwisko: ' + childName);
  const used = { nazwisko: 1, imiona: 1 };
  FIELD_ORDER.forEach(function (f) {
    used[f[0]] = 1;
    const v = String(params[f[0]] || '').trim();
    if (v) lines.push(f[1] + ': ' + v);
  });
  // Restfelder (unbekannte Keys) hinten anhaengen, damit nichts verloren geht
  Object.keys(params).forEach(function (k) {
    if (SKIP[k] || used[k] || k.charAt(0) === '_') return;
    const v = String(params[k] || '').trim();
    if (!v) return;
    lines.push(k + ': ' + v);
  });
  const summary = lines.join('\n');

  // Optionaler Datei-Anhang: Metryka chrztu (base64 -> Blob)
  const attachments = [];
  const fileData = String(params.metryka_data || '');
  if (fileData) {
    try {
      let fileName = String(params.metryka_name || 'metryka-chrztu').replace(/[^\w.\- ]+/g, '_').slice(0, 120);
      if (!fileName) fileName = 'metryka-chrztu';
      const fileType = String(params.metryka_type || 'application/octet-stream');
      attachments.push(Utilities.newBlob(Utilities.base64Decode(fileData), fileType, fileName));
    } catch (e) { /* ungueltige Datei -> ohne Anhang weiter */ }
  }

  const teamSubject = isKomunia
    ? 'Nowe zgłoszenie: I Komunia Święta'
    : 'Nowe zgłoszenie: Bierzmowanie';
  const teamBody =
    'Nowe zgłoszenie do ' + sakramentName + ' (formularz na stronie pmk-berlin.de):\n\n' +
    summary +
    (attachments.length ? '\n\nW załączeniu: metryka chrztu.' : '\n\n(Bez załącznika — metryka chrztu zostanie dostarczona osobno.)') +
    '\n\n— Wiadomość wygenerowana automatycznie przez formularz na pmk-berlin.de';

  const parentBody =
    'Szczęść Boże,\n\n' +
    'dziękujemy za zgłoszenie ' + (childName ? ('„' + childName + '” ') : '') +
    'do ' + sakramentName + ' w Polskiej Misji Katolickiej w Berlinie. ' +
    'Zgłoszenie zostało przekazane do biura parafialnego.\n\n' +
    'Podsumowanie zgłoszenia:\n' + summary + '\n\n' +
    'W razie pytań prosimy o kontakt: ' + PARISH_EMAIL + '.\n\n' +
    'Z Panem Bogiem!\nPolska Misja Katolicka w Berlinie';

  try {
    // 1) Benachrichtigung an die Pfarrei
    MailApp.sendEmail({
      to: PARISH_EMAIL,
      subject: teamSubject,
      body: teamBody,
      replyTo: (email && EMAIL_RE.test(email)) ? email : PARISH_EMAIL,
      attachments: attachments
    });
    // 2) Bestaetigung an den Absender
    if (email && EMAIL_RE.test(email)) {
      MailApp.sendEmail({
        to: email,
        subject: 'Potwierdzenie zgłoszenia — ' + sakramentName + ' (PMK Berlin)',
        body: parentBody
      });
    }
  } catch (err) {
    return { success: false, error: String(err) };
  }

  return { success: true, message: 'sent' };
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
    const status = String(row[4] || '').toLowerCase();
    if (status === 'pending') continue; // Double-Opt-in: nicht bestaetigte ausblenden
    out.push({
      email: String(row[0]),
      first_name: String(row[6] || ''),
      lang: String(row[2] || ''),
      source: String(row[3] || ''),
      status: status || 'confirmed',
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

/* =====================================================
 * ZGLOSZENIA (Anliegen aus dem Voice-/Chat-Agenten)
 * Tab "Zgloszenia". Spalten:
 *   A:id  B:created_at  C:name  D:phone  E:concern
 *   F:urgent (TAK/NIE)  G:lang  H:source (voice/chat)
 *   I:status (offen/erledigt)  J:resolved_at
 * Schreiben ist OEFFENTLICH (kein PIN) — der Agent ruft via Netlify-Function an.
 * Lesen + Status umschalten verlangen den Admin-PIN.
 * ===================================================== */

/**
 * Nimmt ein eskaliertes Anliegen entgegen, schreibt eine Zeile und
 * benachrichtigt die Pfarrei per E-Mail. Kein PIN.
 * Erwartete Parameter: name, phone, concern, urgent ('true'/'1'), lang, source.
 */
function receiveZgloszenie(params) {
  const name = String(params.name || '').trim().slice(0, 200);
  const phone = String(params.phone || '').trim().slice(0, 60);
  const concern = String(params.concern || params.message || '').trim().slice(0, 2000);
  const urgentRaw = String(params.urgent || '').trim().toLowerCase();
  const urgent = (urgentRaw === 'true' || urgentRaw === '1' || urgentRaw === 'tak' || urgentRaw === 'ja');
  const lang = String(params.lang || '').trim().toLowerCase().slice(0, 2);
  const source = String(params.source || 'voice').trim().toLowerCase().slice(0, 20);

  // Mindestens ein verwertbares Feld muss da sein.
  if (!concern && !phone && !name) {
    return { success: false, error: 'empty_zgloszenie' };
  }

  const sheet = getZgloszeniaSheet();
  if (!sheet) {
    return { success: false, error: 'sheet_missing' };
  }

  const id = Utilities.getUuid();
  sheet.appendRow([
    id,
    new Date(),
    /^[=+\-@]/.test(name) ? "'" + name : name,
    /^[=+\-@]/.test(phone) ? "'" + phone : phone,         // führendes +/=/-/@ sonst als Formel -> #ERROR!
    /^[=+\-@]/.test(concern) ? "'" + concern : concern,
    urgent ? 'TAK' : 'NIE',
    lang,
    source,
    'offen',
    ''
  ]);
  SpreadsheetApp.flush();

  // E-Mail nur, wenn der Aufrufer sie NICHT schon selbst verschickt hat.
  // Die Netlify-Funktion sendet via IONOS als admin@pmk-berlin.de und setzt dann no_email=true.
  var skipEmail = (String(params.no_email || params.noEmail || '').toLowerCase() === 'true');
  if (!skipEmail) {
    try {
      notifyZgloszenie(name, phone, concern, urgent, lang, source);
    } catch (e) {
      // E-Mail-Fehler darf das Speichern nicht scheitern lassen — Eintrag steht im Sheet.
    }
  }

  return { success: true, id: id };
}

/**
 * E-Mail an die Pfarrei bei neuem Anliegen. Dringende Faelle (Sterbefall/
 * Krankensalbung) werden im Betreff mit [PILNE] markiert.
 */
function notifyZgloszenie(name, phone, concern, urgent, lang, source) {
  const PARISH_EMAIL = 'pmk@pmk-berlin.de';
  const srcLabel = source === 'chat' ? 'czat na stronie' : 'asystent telefoniczny';
  const subject = (urgent ? '[PILNE] ' : '') + 'Nowe zgłoszenie (' + srcLabel + ')'
    + (name ? ' — ' + name : '');

  const body =
    (urgent ? '⚠️ ZGŁOSZENIE PILNE (np. pogrzeb / namaszczenie chorych)\n\n' : '')
    + 'Nowe zgłoszenie przekazane przez ' + srcLabel + ':\n\n'
    + 'Imię i nazwisko: ' + (name || '—') + '\n'
    + 'Telefon (oddzwonić): ' + (phone || '—') + '\n'
    + 'Język rozmowy: ' + (lang ? lang.toUpperCase() : '—') + '\n\n'
    + 'Sprawa:\n' + (concern || '—') + '\n\n'
    + '— Prosimy oddzwonić. Wiadomość wygenerowana automatycznie przez asystenta PMK.\n'
    + 'Panel: ' + SITE_BASE + '/admin/#zgloszenia';

  MailApp.sendEmail({ to: PARISH_EMAIL, subject: subject, body: body });
}

/**
 * Alle Zgloszenia auflisten (PIN). Offene zuerst, dann neueste zuerst.
 */
function listZgloszenia() {
  const sheet = getZgloszeniaSheet();
  if (!sheet) return { success: true, zgloszenia: [] };
  const data = sheet.getDataRange().getValues();
  const out = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row[0]) continue; // keine id -> leere Zeile
    out.push({
      id: String(row[0] || ''),
      created_at: row[1] instanceof Date ? row[1].toISOString() : String(row[1] || ''),
      name: String(row[2] || ''),
      phone: String(row[3] || ''),
      concern: String(row[4] || ''),
      urgent: String(row[5] || 'NIE').toUpperCase() === 'TAK',
      lang: String(row[6] || ''),
      source: String(row[7] || ''),
      status: String(row[8] || 'offen').toLowerCase(),
      resolved_at: row[9] instanceof Date ? row[9].toISOString() : String(row[9] || '')
    });
  }
  // Offene zuerst, dann neueste zuerst.
  out.sort(function (a, b) {
    if (a.status !== b.status) return a.status === 'offen' ? -1 : 1;
    return (b.created_at || '').localeCompare(a.created_at || '');
  });
  return { success: true, zgloszenia: out };
}

/**
 * Status eines Zgloszenia umschalten offen <-> erledigt (PIN, Suche per id).
 * Setzt resolved_at beim Erledigen, leert es beim Wiederoeffnen.
 */
function toggleZgloszenie(params) {
  const sheet = getZgloszeniaSheet();
  if (!sheet) return { success: false, error: 'sheet_missing' };
  const id = String(params.id || '');
  if (!id) return { success: false, error: 'Brak id' };

  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0] || '') === id) {
      const row = i + 1;
      const current = String(sheet.getRange(row, 9).getValue() || 'offen').toLowerCase();
      const next = current === 'offen' ? 'erledigt' : 'offen';
      sheet.getRange(row, 9).setValue(next);
      sheet.getRange(row, 10).setValue(next === 'erledigt' ? new Date() : '');
      SpreadsheetApp.flush();
      return { success: true, status: next };
    }
  }
  return { success: false, error: 'Nie znaleziono zgłoszenia o id: ' + id };
}
