// PMK Berlin — Newsletter-Anmeldung (Double-Opt-in)
// Die Bestätigungsmail geht über IONOS-SMTP raus, Absender = admin@pmk-berlin.de.
// Apps Script verwaltet nur Sheet + Token (action=subscribe, no_email=true) und
// mailt NIE selbst (User-Vorgabe 11.06.2026: nie von einer privaten Adresse senden).
// Schlägt SMTP fehl, bekommt der Nutzer einen Fehler und kann es erneut versuchen
// (erneutes Abonnieren frischt den Token auf).

const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL
  || 'https://script.google.com/macros/s/AKfycbzizmtkEWB6IUM-SvAODGCEm10q6opPNLXIY7a7_bGhhZXJDjgu5FAU9QUv_EN16mJERQ/exec';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SITE_BASE = process.env.SITE_BASE || 'https://www.pmk-berlin.de';
const PARISH_EMAIL = 'pmk@pmk-berlin.de';
const FROM_NAME = 'Polska Misja Katolicka Berlin';

function json(statusCode, obj) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(obj)
  };
}

function confirmMailText(lang, link) {
  if (lang === 'de') {
    return {
      subject: 'Bitte bestätige deine Newsletter-Anmeldung — PMK Berlin',
      body: 'Szczęść Boże!\n\n'
        + 'Du (oder jemand mit deiner Adresse) hat den Newsletter der Polnischen Katholischen Mission in Berlin abonniert. '
        + 'Bitte bestätige deine Anmeldung mit einem Klick auf den folgenden Link:\n\n'
        + link + '\n\n'
        + 'Erst nach dieser Bestätigung erhältst du unseren Newsletter. '
        + 'Wenn du dich nicht angemeldet hast, ignoriere diese E-Mail einfach – es wird nichts gespeichert und nichts versendet.\n\n'
        + 'Mit Gottes Segen\nPolska Misja Katolicka w Berlinie'
    };
  }
  return {
    subject: 'Potwierdź subskrypcję newslettera — PMK Berlin',
    body: 'Szczęść Boże!\n\n'
      + 'Twój adres e-mail został zapisany do newslettera Polskiej Misji Katolickiej w Berlinie. '
      + 'Prosimy o potwierdzenie subskrypcji, klikając w poniższy link:\n\n'
      + link + '\n\n'
      + 'Newsletter będziesz otrzymywać dopiero po tym potwierdzeniu. '
      + 'Jeśli to nie Ty, po prostu zignoruj tę wiadomość.\n\n'
      + 'Z Panem Bogiem\nPolska Misja Katolicka w Berlinie'
  };
}

// Bestätigungsmail über IONOS-SMTP. Wirft bei Transportfehlern.
async function sendConfirmViaIonos(email, lang, token) {
  const user = process.env.IONOS_SMTP_USER;
  const pass = process.env.IONOS_SMTP_PASS;
  if (!user || !pass) return { sent: false, reason: 'smtp_not_configured' };
  let nodemailer;
  try { nodemailer = require('nodemailer'); }
  catch (_) { return { sent: false, reason: 'nodemailer_missing' }; }

  const host = process.env.IONOS_SMTP_HOST || 'smtp.ionos.de';
  const port = parseInt(process.env.IONOS_SMTP_PORT || '465', 10);

  const link = SITE_BASE + '/.netlify/functions/newsletter-confirm?token=' + encodeURIComponent(token)
    + '&lang=' + (lang === 'de' ? 'de' : 'pl');
  const mail = confirmMailText(lang, link);

  const transporter = nodemailer.createTransport({ host, port, secure: port === 465, auth: { user, pass } });
  await transporter.sendMail({
    from: FROM_NAME + ' <' + user + '>',
    to: email,
    replyTo: PARISH_EMAIL,
    subject: mail.subject,
    text: mail.body
  });
  return { sent: true };
}

async function callAppsScript(fields) {
  const form = new URLSearchParams();
  Object.keys(fields).forEach((k) => form.set(k, fields[k]));
  const res = await fetch(APPS_SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
    redirect: 'follow'
  });
  return res.text();
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return json(405, { success: false, error: 'method_not_allowed' });
  }

  let payload = {};
  try {
    payload = JSON.parse(event.body || '{}');
  } catch (_) {
    return json(400, { success: false, error: 'bad_json' });
  }

  const email = String(payload.email || '').trim().toLowerCase();
  const lang = String(payload.lang || 'pl').toLowerCase().slice(0, 2);
  const source = String(payload.source || '').slice(0, 200);
  const firstName = String(payload.firstName || '').trim().slice(0, 60);
  const honeypot = String(payload.website || '').trim();

  if (honeypot) {
    return json(200, { success: true, message: 'subscribed' });
  }
  if (!email || email.length > 254 || !EMAIL_RE.test(email)) {
    return json(400, { success: false, error: 'invalid_email' });
  }

  const base = { action: 'subscribe', email, lang, source, first_name: firstName, no_email: 'true' };

  let text;
  try {
    text = await callAppsScript(base);
  } catch (_) {
    return json(502, { success: false, error: 'upstream_failed' });
  }

  let data;
  try { data = JSON.parse(text); } catch (_) { data = null; }
  if (!data) {
    // Unerwartete Antwort -> wie bisher unverändert durchreichen
    return { statusCode: 200, headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: text };
  }

  // Apps Script hat Sheet + Token angelegt, die Mail verschicken NUR wir (admin@)
  if (data.success && data.token) {
    let sent = false;
    try { sent = (await sendConfirmViaIonos(email, data.lang || lang, data.token)).sent; }
    catch (_) { sent = false; }
    if (!sent) {
      // Kein Fallback über Apps Script — Nutzer sieht den Fehler und kann es
      // erneut versuchen (Eintrag steht als "pending" im Sheet, Token wird erneuert)
      return json(502, { success: false, error: 'mail_failed' });
    }
  }

  // Token darf NIE an den Browser (sonst wäre Double-Opt-in selbst bestätigbar)
  delete data.token;
  return json(200, data);
};
