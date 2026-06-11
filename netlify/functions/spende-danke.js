// PMK Berlin — Spenden-Danke-Formular (wesprzyj.html / de/spenden.html)
// Spender melden sich nach der Überweisung: die Pfarrei erfährt, WER gespendet
// hat (Banküberweisung läuft off-site) und kann persönlich danken bzw. eine
// Spendenquittung ausstellen. Versand wie sacrament-register direkt über
// IONOS-SMTP (admin@pmk-berlin.de), kein Apps-Script-Fallback:
//   1) Benachrichtigung an die Pfarrei (pmk@pmk-berlin.de)
//   2) Danke-Mail an den Spender (PL oder DE, je nach Seite)

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const PARISH_EMAIL = process.env.SACRAMENT_TO || 'pmk@pmk-berlin.de';
const FROM_NAME = 'Polska Misja Katolicka Berlin';

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
  const out = {};
  new URLSearchParams(raw).forEach((v, k) => { out[k] = v; });
  return out;
}

function field(p, key) {
  return String(p[key] || '').trim().slice(0, 500);
}

async function sendViaIonos(p, lang) {
  const user = process.env.IONOS_SMTP_USER;
  const pass = process.env.IONOS_SMTP_PASS;
  if (!user || !pass) return { sent: false, reason: 'smtp_not_configured' };
  let nodemailer;
  try { nodemailer = require('nodemailer'); }
  catch (_) { return { sent: false, reason: 'nodemailer_missing' }; }

  const host = process.env.IONOS_SMTP_HOST || 'smtp.ionos.de';
  const port = parseInt(process.env.IONOS_SMTP_PORT || '465', 10);

  const imie = field(p, 'imie');
  const nazwisko = field(p, 'nazwisko');
  const email = field(p, 'email');
  const telefon = field(p, 'telefon');
  const adres = field(p, 'adres');
  const fullName = (imie + ' ' + nazwisko).trim();

  // 1) Benachrichtigung an die Pfarrei — polnisch (Bürosprache)
  const teamLines = [
    'Darczyńca zgłosił się przez formularz na stronie (wesprzyj / Spenden):',
    '',
    'Imię i nazwisko: ' + fullName,
    'E-mail: ' + email,
  ];
  if (telefon) teamLines.push('Telefon: ' + telefon);
  if (adres) {
    teamLines.push('Adres: ' + adres);
    teamLines.push('');
    teamLines.push('Adres został podany — darczyńca prawdopodobnie prosi o zaświadczenie o darowiźnie (Spendenquittung).');
  }
  teamLines.push('');
  teamLines.push('Język strony: ' + (lang === 'de' ? 'niemiecki' : 'polski'));
  teamLines.push('');
  teamLines.push('— Wiadomość wygenerowana automatycznie przez formularz na pmk-berlin.de');

  // 2) Danke-Mail an den Spender — in der Sprache der Seite
  const donorSubject = lang === 'de'
    ? 'Vergelt’s Gott für Ihre Spende — Polnische Katholische Mission Berlin'
    : 'Bóg zapłać za Twoją darowiznę — Polska Misja Katolicka w Berlinie';
  const donorBody = lang === 'de'
    ? ('Liebe/r ' + (fullName || 'Spenderin, lieber Spender') + ',\n\n' +
       'herzlichen Dank für Ihre Spende an die Polnische Katholische Mission Berlin. ' +
       'Ihre Unterstützung hilft uns, das Gemeindeleben, die Seelsorge und unsere Mission zu tragen.\n\n' +
       (adres ? 'Da Sie Ihre Adresse angegeben haben, stellt Ihnen das Pfarrbüro gern eine Spendenquittung aus und meldet sich dazu bei Ihnen.\n\n' : '') +
       'Bei Fragen erreichen Sie uns unter ' + PARISH_EMAIL + '.\n\n' +
       'Vergelt’s Gott!\nPolnische Katholische Mission Berlin')
    : ('Szczęść Boże' + (imie ? (', ' + imie) : '') + ',\n\n' +
       'z całego serca dziękujemy za darowiznę na rzecz Polskiej Misji Katolickiej w Berlinie. ' +
       'Twoje wsparcie pomaga nam prowadzić życie parafialne, duszpasterstwo i naszą Misję.\n\n' +
       (adres ? 'Ponieważ podałeś/aś adres, biuro parafialne chętnie wystawi zaświadczenie o darowiźnie (Spendenquittung) i odezwie się w tej sprawie.\n\n' : '') +
       'W razie pytań prosimy o kontakt: ' + PARISH_EMAIL + '.\n\n' +
       'Bóg zapłać!\nPolska Misja Katolicka w Berlinie');

  const transporter = nodemailer.createTransport({ host, port, secure: port === 465, auth: { user, pass } });
  const from = FROM_NAME + ' <' + user + '>';

  // Pfarrei-Mail muss gelingen, sonst echter Fehler ans Formular
  await transporter.sendMail({
    from,
    to: PARISH_EMAIL,
    replyTo: email || PARISH_EMAIL,
    subject: 'Darowizna — darczyńca zgłosił się przez stronę' + (fullName ? (': ' + fullName) : ''),
    text: teamLines.join('\n')
  });

  // Danke an den Spender — best effort
  try {
    await transporter.sendMail({
      from,
      to: email,
      replyTo: PARISH_EMAIL,
      subject: donorSubject,
      text: donorBody
    });
  } catch (_) { /* Meldung ist schon bei der Pfarrei */ }

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

  const email = String(p.email || '').trim();
  if (!email || email.length > 254 || !EMAIL_RE.test(email)) {
    return json(400, { success: false, error: 'invalid_email' });
  }
  if (!String(p.imie || '').trim() || !String(p.nazwisko || '').trim()) {
    return json(400, { success: false, error: 'missing_fields' });
  }

  const lang = String(p.lang || 'pl').toLowerCase() === 'de' ? 'de' : 'pl';

  try {
    const mail = await sendViaIonos(p, lang);
    if (mail.sent) {
      return json(200, { success: true, message: 'sent' });
    }
    return json(502, { success: false, error: mail.reason || 'smtp_not_configured' });
  } catch (_) {
    return json(502, { success: false, error: 'mail_failed' });
  }
};
