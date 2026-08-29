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
//     "urgent": true|false, "lang": "pl"|"de", "source": "voice"|"chat",
//     "caller_id": "+49157..." }  // system__caller_id aus ElevenLabs; seit dem
//                                 // AWS-Fix (17.07.2026, *21* im Telekom-Netz)
//                                 // ist das die ECHTE Anrufernummer

const crypto = require('crypto');

const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL
  || 'https://script.google.com/macros/s/AKfycbzizmtkEWB6IUM-SvAODGCEm10q6opPNLXIY7a7_bGhhZXJDjgu5FAU9QUv_EN16mJERQ/exec';

// Shared Secret. Aufrufer sind ausschliesslich Server: das ElevenLabs-Tool
// create_zgloszenie (beide Agenten) und zgloszenie-watchdog.js — der Browser
// ruft diese Function NIE auf, ein Secret ist hier also nicht exponiert.
//
// Bewusst env-gated: solange ZGLOSZENIE_SECRET nicht gesetzt ist, bleibt der
// Endpoint offen. So kann das Ausrollen die Eskalation nicht abwuergen, und ein
// Loeschen der Variable schaltet die Pruefung sofort wieder ab. Hier haengen
// Beerdigungen und Krankensalbungen dran — ein stiller Fehlschlag waere teuer.
const ZGLOSZENIE_SECRET = process.env.ZGLOSZENIE_SECRET || '';

function safeEqual(a, b) {
  const ba = Buffer.from(String(a == null ? '' : a));
  const bb = Buffer.from(String(b == null ? '' : b));
  if (ba.length !== bb.length) {
    try { crypto.timingSafeEqual(ba, ba); } catch (_) {}
    return false;
  }
  return crypto.timingSafeEqual(ba, bb);
}

// Akzeptiert den Header `X-Zgloszenie-Secret` oder `Authorization: Bearer …`.
function secretOk(event) {
  if (!ZGLOSZENIE_SECRET) return true;   // nicht konfiguriert -> offen wie bisher
  const h = (event && event.headers) || {};
  const direct = String(h['x-zgloszenie-secret'] || h['X-Zgloszenie-Secret'] || '').trim();
  if (direct) return safeEqual(direct, ZGLOSZENIE_SECRET);
  const auth = String(h.authorization || h.Authorization || '').trim();
  const bearer = /^bearer\s+/i.test(auth) ? auth.replace(/^bearer\s+/i, '') : '';
  return safeEqual(bearer, ZGLOSZENIE_SECRET);
}
exports.secretOk = secretOk;

function json(statusCode, obj) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, X-Zgloszenie-Secret, Authorization',
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
  else if (d.length === 9) d = '48' + d; // poln. National-Nr (9-stellig, ohne 0/+48) -> +48 statt verwerfen
  // Deutsche Handynummer ohne fuehrende Null: "eins fuenf zwei ..." Seit die KI
  // bei jedem Anruf aktiv nach der Rueckrufnummer fragt (28.08.2026), ist das
  // die haeufigste diktierte Form — und sie fiel bisher komplett durch. Echter
  // Fall vom 21.08.: vier Anlaeufe fuer eine Priesterbitte, keine Nummer
  // gespeichert. Eindeutig, weil poln. Nummern 9-stellig sind und deutsche
  // Mobilvorwahlen (15x/16x/17x) auf 10 oder 11 Stellen kommen.
  else if (/^1[5-7]\d{8,9}$/.test(d)) d = '49' + d;
  else if (!compact.startsWith('+') && !d.startsWith('49')) return s; // ohne Vorwahl-Hinweis nicht raten
  if (OWN_NUMBERS.indexOf(d) !== -1) return '';
  return '+' + d.slice(0, 2) + ' ' + d.slice(2);
}

// Für die Regression-Tests exportiert (scripts/test-normalize-phone.cjs).
// Kein Einfluss auf den Netlify-Handler, der weiterhin exports.handler nutzt.
exports.normalizePhone = normalizePhone;

const USABLE_RE = /^\+\d{1,3}\s\d{6,}$/;

// Antwort an den Agenten. Der Agent liest `message` praktisch wörtlich vor —
// also darf dort ohne verwertbare Rückrufnummer NIE eine Zusage stehen.
//
// Warum das scharf sein muss (Audit 20.08.2026): Seit dem 03.08. liefert die
// Telefonie bei jedem Anruf die eigene Bueronummer als Caller-ID. Die steht auf
// OWN_NUMBERS, faellt raus, und der Fall ist dann phone_provided=false +
// phone_usable=false. Genau dort schickte die Function bis jetzt trotzdem
// "Oddzwonimy najszybciej, jak to możliwe." zurueck. Ergebnis: 7 Tickets ohne
// jede Nummer, und die Anrufer warteten auf einen Rueckruf, der nicht kommen
// konnte. Das Anliegen selbst ist in allen Faellen erfasst — es fehlt nur der
// Rueckweg, und den muss der Agent im Gespraech nachholen.
function buildToolResponse({ phoneProvided, phoneUsable, phoneSource, lang } = {}) {
  const de = String(lang || '').toLowerCase() === 'de';

  if (phoneUsable) {
    return {
      message: de
        ? 'Anliegen aufgenommen. Ich leite es an das Pfarrbüro weiter.'
        : 'Zgłoszenie przyjęte. Przekazuję sprawę do biura parafialnego.'
    };
  }

  return {
    message: de
      ? 'Anliegen aufgenommen und weitergeleitet, aber uns fehlt Ihre Rufnummer. Unter welcher Nummer sind Sie erreichbar?'
      : 'Zgłoszenie przyjęte i przekazane do biura, ale brakuje numeru kontaktowego. Pod jakim numerem można się z Panem lub Panią skontaktować?',
    phone_warning: phoneProvided
      ? 'Podany numer NIE został zapisany jako prawidłowy numer kontaktowy. Poproś o niego ponownie, cyfra po cyfrze.'
      : 'BRAK numeru: identyfikacja połączenia nie zawiera numeru rozmówcy (przekierowanie centrali), a rozmówca żadnego nie podał.',
    next_action: 'NIE obiecuj kontaktu zwrotnego. Poproś rozmówcę o numer telefonu, powtórz go na głos cyfra po cyfrze, potem wywołaj create_zgloszenie jeszcze raz z polem phone. Jeśli rozmówca odmówi, powiedz, że można zadzwonić do biura w godzinach otwarcia.'
  };
}
exports.buildToolResponse = buildToolResponse;

// Rückrufnummer wählen: diktierte Nummer hat Vorrang (der Anrufer hat sie
// bewusst bestätigt), sonst die Caller-ID. "anonymous"/Wortformen normalisieren
// nicht zu "+…" und fallen damit automatisch raus, ebenso die eigenen Nummern.
function pickPhone(dictatedRaw, callerIdRaw) {
  const dictated = normalizePhone(dictatedRaw);
  if (USABLE_RE.test(dictated)) return { phone: dictated, phone_source: 'dictated' };
  const cid = normalizePhone(callerIdRaw);
  if (USABLE_RE.test(cid)) return { phone: cid, phone_source: 'caller_id' };
  return { phone: dictated, phone_source: '' };
}
exports.pickPhone = pickPhone;

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
    + 'Telefon (oddzwonić): ' + (d.phone || '—')
    + (d.phone && d.phone_source === 'caller_id' ? ' (numer z identyfikacji połączenia)' : '') + '\n'
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

  if (!secretOk(event)) {
    return json(401, { success: false, error: 'unauthorized' });
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
  const rawCallerId = String(p.caller_id || '').trim().slice(0, 60);
  const picked = pickPhone(rawPhone, rawCallerId);
  const phone = picked.phone;
  const concern = String(p.concern || p.message || p.sprawa || '').trim().slice(0, 2000);

  // Diktierte Nummer hat Vorrang; ohne verwertbare diktierte Nummer springt die
  // Caller-ID ein (seit 17.07.2026 kommt dank Netz-AWS die echte Anrufernummer
  // an). phone_usable=false heißt jetzt: WEDER diktiert NOCH Caller-ID
  // verwertbar (z. B. unterdrückte Nummer + Wortform) -> Agent fragt nach.
  const phoneProvided = rawPhone.length > 0;
  const phoneUsable = USABLE_RE.test(phone);

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
  try { mail = await sendViaIonos({ name, phone, phone_source: picked.phone_source, concern, lang, source, urgent: truthy(p.urgent), recovered, call_link: callLink }); }
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
      // buildToolResponse entscheidet, ob eine Rückruf-Zusage überhaupt zulässig
      // ist. Ohne verwertbare Nummer kommt stattdessen die Rückfrage zurück.
      const resp = Object.assign(
        { success: true },
        buildToolResponse({ phoneProvided, phoneUsable, phoneSource: picked.phone_source, lang }),
        {
          mail,
          phone_provided: phoneProvided,
          phone_usable: phoneUsable,
          phone_source: picked.phone_source
        }
      );
      return json(200, resp);
    }
    return json(502, { success: false, error: (data && data.error) || 'upstream_failed' });
  } catch (_) {
    return json(502, { success: false, error: 'upstream_failed' });
  }
};
