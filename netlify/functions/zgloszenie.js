// PMK Berlin — Zgłoszenie (eskaliertes Anliegen aus dem Voice-/Chat-Agenten)
// Ablauf: ElevenLabs-Agent (Tool) -> diese Function -> Google Apps Script:
//   1) Zeile im Tab "Zgloszenia" anlegen
//   2) E-Mail an die Pfarrei (pmk@pmk-berlin.de) — dringende Fälle [PILNE]
// Der Agent ruft NUR bei echter Eskalation an (Stufe 2): wenn er die Frage
// nicht beantworten kann oder der Anrufer einen Menschen will. Es werden nur
// Name + Rückrufnummer + Anliegen erfasst — niemals eine E-Mail vom Anrufer.
//
// Erwarteter JSON-Body (alle Felder optional, aber min. eins von name/phone/concern):
//   { "name": "...", "phone": "...", "concern": "...",
//     "urgent": true|false, "lang": "pl"|"de", "source": "voice"|"chat" }

const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL
  || 'https://script.google.com/macros/s/AKfycbzizmtkEWB6IUM-SvAODGCEm10q6opPNLXIY7a7_bGhhZXJDjgu5FAU9QUv_EN16mJERQ/exec';

function json(statusCode, obj) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS'
    },
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
  // Fallback: urlencoded
  const out = {};
  new URLSearchParams(raw).forEach((v, k) => { out[k] = v; });
  return out;
}

function truthy(v) {
  const s = String(v == null ? '' : v).trim().toLowerCase();
  return s === 'true' || s === '1' || s === 'tak' || s === 'ja' || s === 'yes';
}

// Rückrufnummer kanonisch als "+49 …" formatieren. Zwei Gründe:
// 1) Google Sheets parst reine Ziffernfolgen als Zahl — "0178…" verliert die
//    führende Null. Ein "+…"-String wird vom Apps Script als Text escaped.
// 2) Die eigenen Nummern (KI-Leitung, Pfarrbüro-Weiterleitung) sind nie die
//    Rückrufnummer des Anrufers — der Agent hat sie schon einmal fälschlich
//    eingetragen, weil der Anrufer "die Nummer, von der ich anrufe" sagte.
const OWN_NUMBERS = ['493075938358', '49307524080'];
function normalizePhone(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  const compact = s.replace(/[\s\/().-]/g, '');
  if (!/^\+?\d{4,20}$/.test(compact)) return s; // keine Ziffernfolge (z. B. Worte) -> unverändert lassen
  let d = compact.replace(/^\+/, '');
  if (d.startsWith('00')) d = d.slice(2);
  else if (d.startsWith('0')) d = '49' + d.slice(1);
  else if (!compact.startsWith('+') && !d.startsWith('49')) return s; // ohne Vorwahl-Hinweis nicht raten
  if (OWN_NUMBERS.indexOf(d) !== -1) return '';
  return '+' + d.slice(0, 2) + ' ' + d.slice(2);
}

// Für die Regression-Tests exportiert (scripts/test-normalize-phone.cjs).
// Kein Einfluss auf den Netlify-Handler, der weiterhin exports.handler nutzt.
exports.normalizePhone = normalizePhone;

// Reine Mail-Texterzeugung (für scripts/test-zgloszenie-mail.cjs exportiert).
// recovered=true => das Safety-Net hat dieses Anliegen aus dem Transkript
// rekonstruiert (Tool feuerte nicht). Pfarrei MUSS Name/Nummer gegen die
// Aufnahme prüfen, daher Warn-Präfix + Call-Link.
function buildMail(d) {
  const srcLabel = d.source === 'chat' ? 'czat na stronie' : 'asystent telefoniczny';
  const recPrefix = d.recovered ? '⚠️ AUTO-WIEDERHERGESTELLT — ' : '';
  const subject = recPrefix + (d.urgent ? '[PILNE] ' : '') + 'Nowe zgłoszenie (' + srcLabel + ')'
    + (d.name ? ' — ' + d.name : '');
  const recBanner = d.recovered
    ? '⚠️ AUTOMATYCZNIE ODZYSKANE ZGŁOSZENIE\n'
      + 'Asystent obiecał przekazać sprawę, ale narzędzie nie zostało wywołane. '
      + 'Dane wyodrębniono z transkrypcji — proszę sprawdzić imię i numer z nagraniem przed oddzwonieniem.\n'
      + (d.call_link ? 'Nagranie / transkrypcja: ' + d.call_link + '\n' : '')
      + '(Hinweis DE: automatisch wiederhergestellt — Name/Nummer gegen die Aufnahme prüfen.)\n\n'
    : '';
  const body =
    (d.urgent ? '⚠️ ZGŁOSZENIE PILNE (np. pogrzeb / namaszczenie chorych)\n\n' : '')
    + recBanner
    + 'Nowe zgłoszenie przekazane przez ' + srcLabel + ':\n\n'
    + 'Imię i nazwisko: ' + (d.name || '—') + '\n'
    + 'Telefon (oddzwonić): ' + (d.phone || '—') + '\n'
    + 'Język rozmowy: ' + (d.lang ? d.lang.toUpperCase() : '—') + '\n\n'
    + 'Sprawa:\n' + (d.concern || '—') + '\n\n'
    + '— Prosimy oddzwonić. Wiadomość wygenerowana automatycznie przez asystenta PMK.';
  return { subject, body };
}
exports.buildMail = buildMail;

// E-Mail an die Pfarrei über IONOS-SMTP, Absender = echte Pfarrei-Adresse (z.B. admin@pmk-berlin.de).
// env-gated: ohne IONOS_SMTP_USER/PASS passiert nichts (dann mailt weiterhin das Apps Script).
async function sendViaIonos(d) {
  const user = process.env.IONOS_SMTP_USER;
  const pass = process.env.IONOS_SMTP_PASS;
  if (!user || !pass) return { sent: false, reason: 'smtp_not_configured' };
  let nodemailer;
  try { nodemailer = require('nodemailer'); }
  catch (_) { return { sent: false, reason: 'nodemailer_missing' }; }

  const host = process.env.IONOS_SMTP_HOST || 'smtp.ionos.de';
  const port = parseInt(process.env.IONOS_SMTP_PORT || '465', 10);
  // Dringende Fälle dürfen optional an eine separate Adresse (damit ein
  // [PILNE]-Ticket nicht zwischen Vertriebsanfragen untergeht). Fällt auf
  // die Standard-Adresse zurück, wenn ZGLOSZENIE_URGENT_TO nicht gesetzt ist.
  const to = (d.urgent && process.env.ZGLOSZENIE_URGENT_TO) || process.env.ZGLOSZENIE_TO || 'pmk@pmk-berlin.de';
  const replyTo = process.env.ZGLOSZENIE_REPLYTO || 'pmk@pmk-berlin.de';
  const fromName = process.env.ZGLOSZENIE_FROM_NAME || 'PMK Telefon-Assistent';

  const { subject, body } = buildMail(d);

  const transporter = nodemailer.createTransport({ host, port, secure: port === 465, auth: { user, pass } });
  await transporter.sendMail({ from: fromName + ' <' + user + '>', to, replyTo, subject, text: body });
  return { sent: true };
}

exports.handler = async (event) => {
  // CORS-Preflight (falls der Agent/Browser OPTIONS schickt)
  if (event.httpMethod === 'OPTIONS') {
    return json(204, {});
  }
  if (event.httpMethod !== 'POST') {
    return json(405, { success: false, error: 'method_not_allowed' });
  }

  let p;
  try {
    p = parseBody(event) || {};
  } catch (_) {
    return json(400, { success: false, error: 'bad_request' });
  }

  // Honeypot (falls je ein Web-Formular dieselbe Function nutzt)
  if (String(p.website || '').trim()) {
    return json(200, { success: true });
  }

  const name = String(p.name || '').trim().slice(0, 200);
  const rawPhone = String(p.phone || p.telefon || '').trim().slice(0, 60);
  const phone = normalizePhone(rawPhone);
  const concern = String(p.concern || p.message || p.sprawa || '').trim().slice(0, 2000);

  // Hat der Anrufer eine Nummer geliefert, die aber NICHT als gültige
  // Rückrufnummer verwertbar ist (eigene PMK-Nummer, Wortform wie
  // "dwadzieścia trzy", unparsebar)? Dann gibt normalizePhone "" oder den
  // Rohtext zurück. Der Agent erfuhr das bisher NICHT (stiller Fehlschlag) und
  // sagte dem Anrufer "wir rufen zurück" ohne erreichbare Nummer. phone_usable
  // signalisiert dem Agenten, die Nummer erneut zu erfragen.
  const phoneProvided = rawPhone.length > 0;
  const phoneUsable = /^\+\d{1,3}\s\d{6,}$/.test(phone);

  // Mindestens ein verwertbares Feld
  if (!name && !phone && !concern) {
    return json(400, { success: false, error: 'empty_zgloszenie' });
  }

  const langRaw = String(p.lang || '').trim().toLowerCase().slice(0, 2);
  const lang = (langRaw === 'de' || langRaw === 'pl') ? langRaw : '';
  const sourceRaw = String(p.source || 'voice').trim().toLowerCase();
  const source = sourceRaw === 'chat' ? 'chat' : 'voice';

  const recovered = truthy(p.recovered);
  const callLink = String(p.call_link || '').trim().slice(0, 300);
  const conversationId = String(p.conversation_id || '').trim().slice(0, 100);

  // 1) E-Mail über IONOS (echte Pfarrei-Adresse) — wenn konfiguriert.
  let mail = { sent: false, reason: 'skipped' };
  try { mail = await sendViaIonos({ name, phone, concern, lang, source, urgent: truthy(p.urgent), recovered, call_link: callLink }); }
  catch (e) { mail = { sent: false, reason: 'smtp_error', detail: e.message }; }

  const form = new URLSearchParams();
  form.set('action', 'zgloszenie');
  form.set('name', name);
  form.set('phone', phone);
  form.set('concern', concern);
  form.set('urgent', truthy(p.urgent) ? 'true' : 'false');
  form.set('lang', lang);
  form.set('source', source);
  form.set('recovered', recovered ? 'true' : 'false');
  if (callLink) form.set('call_link', callLink);
  if (conversationId) form.set('conversation_id', conversationId);
  // Apps Script darf NIE selbst mailen (User-Vorgabe 11.06.2026: nie von einer
  // privaten Adresse senden). Schlägt IONOS fehl, steht das Zgłoszenie trotzdem
  // im Sheet + Admin-Tab und geht nicht verloren.
  form.set('no_email', 'true');

  try {
    const res = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
      redirect: 'follow'
    });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch (_) { data = { success: false, error: 'upstream_parse' }; }
    // Dem Agenten eine klare, knappe Antwort geben
    if (data && data.success) {
      const resp = {
        success: true,
        message: 'Zgłoszenie przyjęte. Oddzwonimy najszybciej, jak to możliwe.',
        mail,
        phone_provided: phoneProvided,
        phone_usable: phoneUsable
      };
      // Anrufer hat eine Nummer genannt, die nicht verwertbar ist -> Agent soll
      // sie erneut Ziffer für Ziffer erfragen (das Anliegen ist trotzdem erfasst).
      if (phoneProvided && !phoneUsable) {
        resp.phone_warning = 'Telefonnummer NICHT als gültige Rückrufnummer gespeichert. Bitte die Nummer erneut Ziffer für Ziffer erfragen und bestätigen, dann das Tool erneut aufrufen.';
      }
      return json(200, resp);
    }
    return json(502, { success: false, error: (data && data.error) || 'upstream_failed' });
  } catch (_) {
    return json(502, { success: false, error: 'upstream_failed' });
  }
};
