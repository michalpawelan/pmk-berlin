// PMK Berlin — Sakrament-Anmeldung (Erstkommunion / Firmung)
// Versand direkt über IONOS-SMTP, Absender = echte Pfarrei-Adresse (admin@pmk-berlin.de):
//   1) Benachrichtigung an die Pfarrei (pmk@pmk-berlin.de), optional mit Metryka-Anhang
//   2) Bestätigungs-E-Mail an den Absender (Eltern / Kandidat)
// KEIN Fallback über Apps Script (User-Vorgabe 11.06.2026: nie von einer privaten
// Adresse senden) — schlägt SMTP fehl, bekommt das Formular einen echten Fehler
// und zeigt den mailto-Hinweis auf pmk@pmk-berlin.de.

const { guard } = require('./_form-guard.js');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ALLOWED = new Set(['komunia', 'bierzmowanie']);

const PARISH_EMAIL = process.env.SACRAMENT_TO || 'pmk@pmk-berlin.de';
const FROM_NAME = 'Polska Misja Katolicka Berlin';

// Feste, druckfreundliche Feldreihenfolge (Vorgabe Pfarrbüro, 10.06.2026).
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
const SKIP = { action: 1, pin: 1, website: 1, formToken: 1, datenschutz: 1, sakrament: 1, metryka_data: 1, metryka_name: 1, metryka_type: 1 };

function json(statusCode, obj) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(obj)
  };
}

function parseBody(event) {
  const headers = event.headers || {};
  const ct = headers['content-type'] || headers['Content-Type'] || '';
  const raw = event.body || '';
  if (ct.indexOf('application/json') !== -1) {
    return JSON.parse(raw);
  }
  // Fallback: urlencoded (z. B. wenn JavaScript deaktiviert ist und das Formular nativ sendet)
  const out = {};
  new URLSearchParams(raw).forEach((v, k) => { out[k] = v; });
  return out;
}

function buildSummary(p) {
  const childName = (String(p.imiona || '') + ' ' + String(p.nazwisko || '')).trim();
  const lines = [];
  if (childName) lines.push('Imię i nazwisko: ' + childName);
  const used = { nazwisko: 1, imiona: 1 };
  FIELD_ORDER.forEach(function (f) {
    used[f[0]] = 1;
    const v = String(p[f[0]] || '').trim().slice(0, 2000);
    if (v) lines.push(f[1] + ': ' + v);
  });
  // Restfelder (unbekannte Keys) hinten anhängen, damit nichts verloren geht
  Object.keys(p).forEach(function (k) {
    if (SKIP[k] || used[k] || k.charAt(0) === '_') return;
    const v = String(p[k] || '').trim().slice(0, 2000);
    if (v) lines.push(k + ': ' + v);
  });
  return { summary: lines.join('\n'), childName };
}

// Beide E-Mails über IONOS-SMTP verschicken.
// Wirft bei Transportfehlern; { sent: false } nur, wenn SMTP gar nicht konfiguriert ist.
async function sendViaIonos(p, sakrament, email) {
  const user = process.env.IONOS_SMTP_USER;
  const pass = process.env.IONOS_SMTP_PASS;
  if (!user || !pass) return { sent: false, reason: 'smtp_not_configured' };
  let nodemailer;
  try { nodemailer = require('nodemailer'); }
  catch (_) { return { sent: false, reason: 'nodemailer_missing' }; }

  const host = process.env.IONOS_SMTP_HOST || 'smtp.ionos.de';
  const port = parseInt(process.env.IONOS_SMTP_PORT || '465', 10);

  const isKomunia = sakrament === 'komunia';
  const sakramentName = isKomunia ? 'Pierwszej Komunii Świętej' : 'Sakramentu Bierzmowania';
  const built = buildSummary(p);

  // Optionaler Datei-Anhang: Metryka chrztu (base64, nur an die Pfarrei-Mail)
  const attachments = [];
  const fileData = String(p.metryka_data || '');
  if (fileData) {
    let fileName = String(p.metryka_name || 'metryka-chrztu').replace(/[^\w.\- ]+/g, '_').slice(0, 120);
    if (!fileName) fileName = 'metryka-chrztu';
    attachments.push({
      filename: fileName,
      content: fileData,
      encoding: 'base64',
      contentType: String(p.metryka_type || 'application/octet-stream')
    });
  }

  const teamSubject = isKomunia
    ? 'Nowe zgłoszenie: I Komunia Święta'
    : 'Nowe zgłoszenie: Bierzmowanie';
  const teamBody =
    'Nowe zgłoszenie do ' + sakramentName + ' (formularz na stronie pmk-berlin.de):\n\n' +
    built.summary +
    (attachments.length ? '\n\nW załączeniu: metryka chrztu.' : '\n\n(Bez załącznika — metryka chrztu zostanie dostarczona osobno.)') +
    '\n\n— Wiadomość wygenerowana automatycznie przez formularz na pmk-berlin.de';

  const parentBody =
    'Szczęść Boże,\n\n' +
    'dziękujemy za zgłoszenie ' + (built.childName ? ('„' + built.childName + '” ') : '') +
    'do ' + sakramentName + ' w Polskiej Misji Katolickiej w Berlinie. ' +
    'Zgłoszenie zostało przekazane do biura parafialnego.\n\n' +
    'Podsumowanie zgłoszenia:\n' + built.summary + '\n\n' +
    'W razie pytań prosimy o kontakt: ' + PARISH_EMAIL + '.\n\n' +
    'Z Panem Bogiem!\nPolska Misja Katolicka w Berlinie';

  const transporter = nodemailer.createTransport({ host, port, secure: port === 465, auth: { user, pass } });
  const from = FROM_NAME + ' <' + user + '>';

  // 1) Benachrichtigung an die Pfarrei — muss gelingen, sonst Fallback
  await transporter.sendMail({
    from,
    to: PARISH_EMAIL,
    replyTo: email || PARISH_EMAIL,
    subject: teamSubject,
    text: teamBody,
    attachments
  });

  // 2) Bestätigung an den Absender — best effort (Anmeldung ist schon bei der Pfarrei)
  try {
    await transporter.sendMail({
      from,
      to: email,
      replyTo: PARISH_EMAIL,
      subject: 'Potwierdzenie zgłoszenia — ' + sakramentName + ' (PMK Berlin)',
      text: parentBody
    });
  } catch (_) { /* Bestätigung fehlgeschlagen -> Anmeldung trotzdem erfolgreich */ }

  return { sent: true };
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return json(405, { success: false, error: 'method_not_allowed' });
  }

  let p;
  try {
    p = parseBody(event) || {};
  } catch (_) {
    return json(400, { success: false, error: 'bad_request' });
  }

  // Honeypot: Bots füllen das versteckte Feld -> "ok" zurückgeben, aber nichts senden
  if (String(p.website || '').trim()) {
    return json(200, { success: true });
  }

  // Origin + Formular-Token + Rate-Limit (siehe _form-guard.js). Auch hier geht
  // eine Bestätigung an eine frei eingetippte Adresse — gleicher Missbrauchsweg
  // wie bei spende-danke (17.08.2026). Etwas großzügiger: Eltern melden
  // nacheinander mehrere Kinder an, oft aus demselben WLAN.
  const g = await guard(event, { token: p.formToken, bucket: 'sacrament', perHour: 8, perDay: 20 });
  if (!g.ok) {
    return json(g.statusCode, { success: false, error: g.error });
  }

  const sakrament = String(p.sakrament || '').toLowerCase();
  if (!ALLOWED.has(sakrament)) {
    return json(400, { success: false, error: 'bad_sacrament' });
  }

  const email = String(p.email || '').trim();
  if (!email || email.length > 254 || !EMAIL_RE.test(email)) {
    return json(400, { success: false, error: 'invalid_email' });
  }
  if (!String(p.nazwisko || '').trim() || !String(p.imiona || '').trim()) {
    return json(400, { success: false, error: 'missing_fields' });
  }

  // Optionaler Datei-Anhang (Metryka chrztu, base64) — Größe begrenzen (Netlify-Body-Limit ~6 MB)
  if (String(p.metryka_data || '').length > 6000000) {
    return json(413, { success: false, error: 'file_too_large' });
  }

  // Versand ausschließlich über IONOS-SMTP (admin@pmk-berlin.de) — kein Fallback
  try {
    const mail = await sendViaIonos(p, sakrament, email);
    if (mail.sent) {
      return json(200, { success: true, message: 'sent' });
    }
    return json(502, { success: false, error: mail.reason || 'smtp_not_configured' });
  } catch (_) {
    return json(502, { success: false, error: 'mail_failed' });
  }
};
