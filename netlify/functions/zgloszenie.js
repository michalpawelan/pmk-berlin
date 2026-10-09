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

// Zeitbudget für einen Mailversand. Ein haengender SMTP-Server darf die Antwort
// an den Agenten nicht blockieren — das Werkzeug hat bei ElevenLabs ein Limit
// von 20 s, danach erzaehlt der Agent dem Anrufer, es habe nicht geklappt.
const SMTP_BUDGET_MS = parseInt(process.env.ZGLOSZENIE_SMTP_BUDGET_MS || '6000', 10);

// Wie lange der Agent hoechstens auf die Sheet-Zeile (Apps Script) wartet,
// gemessen ab Eingang. Audit 08.10.2026: Apps Script brauchte bis zu 20 s und
// lieferte 5x eine Google-Fehlerseite statt JSON — der Agent bekam "Fehler",
// obwohl die Mail an die Pfarrei laengst raus war. Ist die Pfarrei per Mail
// benachrichtigt, reicht ein kurzes Warten; sonst ist das Sheet der einzige
// Weg und wir warten laenger, aber immer unter dem 20-s-Tool-Timeout von
// ElevenLabs, damit der Agent eine echte Antwort statt "timed out" bekommt.
const SHEET_BUDGET_MS = parseInt(process.env.ZGLOSZENIE_SHEET_BUDGET_MS || '6000', 10);
const SHEET_HARD_MS = parseInt(process.env.ZGLOSZENIE_SHEET_HARD_MS || '17000', 10);

// Zeitbudget fuer jeden Zugriff auf den Zustandsspeicher (Netlify Blobs). Ein
// haengender Speicher darf weder die Antwort noch die Eskalation blockieren.
const BLOB_BUDGET_MS = parseInt(process.env.ZGLOSZENIE_BLOB_BUDGET_MS || '1500', 10);
// Der Zustand wird nur geschrieben, solange die Antwort sicher unter dem 20-s-Limit bleibt.
const STATE_DEADLINE_MS = SHEET_HARD_MS + 1000;
// Zustand gilt nur fuer das laufende Gespraech.
const STATE_MAX_AGE_MS = 2 * 24 * 3600 * 1000;

// Wartet hoechstens ms auf p. Liefert bei Zeitueberschreitung UND bei einem
// Fehler den fallback — fuer Wege, die nie werfen duerfen (Sheet, Speicher).
function budget(p, ms, fallback) {
  let t;
  return Promise.race([
    Promise.resolve(p).then(v => { clearTimeout(t); return v; }, () => { clearTimeout(t); return fallback; }),
    new Promise(res => { t = setTimeout(() => res(fallback), ms); })
  ]);
}

// Wartet hoechstens ms auf p und liefert sonst fallback. Verwirft das Ergebnis
// von p danach still — der Versand laeuft ggf. zu Ende, nur ohne uns.
function withTimeout(p, ms, fallback) {
  let t;
  return Promise.race([
    Promise.resolve(p).then(v => { clearTimeout(t); return v; },
                            e => { clearTimeout(t); return Object.assign({ sent: false, reason: 'smtp_error' }, { detail: e && e.message }); }),
    new Promise(res => { t = setTimeout(() => res(fallback), ms); })
  ]);
}
exports.withTimeout = withTimeout;

// Mail-Entdopplung je Gespraech. Der Agent ruft das Tool bewusst mehrfach:
// erst sofort ohne Nummer (fire-first), dann noch einmal mit der diktierten
// Nummer. Jeder Aufruf schrieb bisher eine Zeile UND schickte eine Mail — in
// echt sieben Mails fuer eine QR-Beschwerde (04.08.) und vier fuer einen
// Anrufer am 21.08. Die Sheet-Zeile bleibt bei jedem Aufruf (die neueste ist
// die vollstaendigste), aber gemailt wird nur, was die Pfarrei wirklich neu
// erfaehrt: die erste Meldung, und spaeter das Auftauchen einer Rueckrufnummer.
// Code-Review 09.10.2026: Eine Folgemeldung kann mehr tragen als eine neue
// Nummer — sie kann PILNE werden oder eine andere Nummer bringen. Und "gemailt"
// zaehlt nur, wenn die Mail wirklich zugestellt wurde (prev.mailed === false
// heisst: bisher ist keine Mail angekommen, also jetzt senden).
function shouldSendMail(prev, phoneUsable, cur = {}) {
  if (!prev) return { send: true, reason: 'first' };
  if (prev.mailed === false) return { send: true, reason: 'retry_unsent' };
  if (phoneUsable && !prev.phoneUsable) return { send: true, reason: 'phone_added' };
  if (cur.urgent && !prev.urgent) return { send: true, reason: 'urgent_added' };
  // Nur eine DIKTIERTE andere Nummer ist neu — der Rueckfall auf die Caller-ID nicht.
  if (phoneUsable && cur.phoneSource === 'dictated' && cur.phoneKey && prev.phoneKey && cur.phoneKey !== prev.phoneKey) {
    return { send: true, reason: 'phone_changed' };
  }
  // Chat: eine E-Mail-Adresse im Anliegen ist ein neuer Kontaktweg (Re-Review 09.10.2026).
  if (cur.emailKey && cur.emailKey !== prev.emailKey) return { send: true, reason: 'contact_added' };
  return { send: false, reason: 'duplicate' };
}
exports.shouldSendMail = shouldSendMail;

// Zustandsspeicher fuer die Mail-Entdopplung (gleiches Muster wie der Watchdog:
// bei CLI-Deploys fehlt der Blob-Kontext, dann ueber Site-ID + Token).
function openMailStore() {
  const { getStore } = require('@netlify/blobs');
  try {
    return getStore('zgloszenie-mail');
  } catch (e) {
    const siteID = process.env.NETLIFY_SITE_ID || process.env.SITE_ID;
    const token = process.env.NETLIFY_API_TOKEN || process.env.NETLIFY_BLOBS_TOKEN;
    if (siteID && token) return getStore({ name: 'zgloszenie-mail', siteID, token });
    throw new Error('blobs_unconfigured');
  }
}

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
function buildToolResponse({ phoneProvided, phoneUsable, phoneSource, lang, emailGiven } = {}) {
  const de = String(lang || '').toLowerCase() === 'de';

  // Chat: eine E-Mail-Adresse reicht als Rueckweg — nicht erneut nach einer Nummer fragen.
  if (!phoneUsable && emailGiven) {
    return {
      message: de
        ? 'Anliegen aufgenommen und mit Ihrer E-Mail-Adresse an das Pfarrbüro weitergeleitet.'
        : 'Zgłoszenie przyjęte i przekazane do biura parafialnego razem z adresem e-mail.'
    };
  }

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
      : 'Zgłoszenie przyjęte i przekazane do biura, ale brakuje numeru kontaktowego. Pod jakim numerem można się skontaktować?',
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
  // update: dasselbe Anliegen, aber mit neuer Information (Nummer, PILNE, Details).
  // Die Pfarrei soll auf den ersten Blick sehen, dass das kein zweites Anliegen ist.
  const updateKind = d.updateKind || (d.update ? 'phone' : '');
  const updateLabel = updateKind === 'phone' ? '[AKTUALIZACJA — numer] '
    : updateKind === 'urgent' ? '[AKTUALIZACJA — pilne] '
    : updateKind === 'contact' ? '[AKTUALIZACJA — kontakt] '
    : updateKind ? '[AKTUALIZACJA] ' : '';
  const subject = recPrefix + (d.urgent ? '[PILNE] ' : '') + updateLabel
    + 'Nowe zgłoszenie (' + srcLabel + ')'
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
  const t0 = Date.now(); // Zeitbudgets gelten ab Eingang
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
  // Das geteilte Werkzeug schickt kein source-Feld. Am Telefon ist system__caller_id
  // immer gesetzt (notfalls die maskierte Bueronummer), im Chat ist sie leer.
  const sourceRaw = String(p.source || (rawCallerId ? 'voice' : 'chat')).trim().toLowerCase();
  const source = sourceRaw === 'chat' ? 'chat' : 'voice';

  const recovered = truthy(p.recovered);
  const callLink = String(p.call_link || '').trim().slice(0, 300);
  const conversationId = String(p.conversation_id || '').trim().slice(0, 100);

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

  // Mail und Sheet-Eintrag laufen PARALLEL. Vorher liefen sie nacheinander,
  // und die Summe hat Netlifys Function-Timeout gerissen: der Agent bekam einen
  // 504 und sagte dem Anrufer "hat leider nicht geklappt" — obwohl Ticket und
  // Mail längst draußen waren (echte Fälle 21.08. Priesterbesuch, 13.08.
  // obdachloser Anrufer, 27.08.). Beide Wege sind voneinander unabhängig, also
  // ist das gefahrlos und halbiert im schlechtesten Fall die Wartezeit.
  // Zweitmeldung im selben Gespraech? Zeile ja, Mail nur wenn sie etwas Neues
  // traegt. Faellt der Zustandsspeicher aus, wird gemailt — eine Mail zu viel
  // ist harmlos, eine verschluckte Eskalation nicht.
  let mailStore = null, mailPrev = null;
  if (conversationId) {
    try {
      mailStore = openMailStore();
      mailPrev = JSON.parse((await budget(mailStore.get('c:' + conversationId), BLOB_BUDGET_MS, null)) || 'null');
    } catch (_) { mailStore = null; mailPrev = null; }
  }
  // Zustand gilt nur fuer das laufende Gespraech; aeltere Eintraege ignorieren.
  if (mailPrev && mailPrev.ts && (Date.now() - mailPrev.ts) > STATE_MAX_AGE_MS) mailPrev = null;
  const urgentNow = truthy(p.urgent);
  // Fingerabdruecke statt Klartext: keine Telefonnummern oder Adressen im Blob-Speicher
  // (HMAC mit dem Werkzeug-Secret, damit sich die Werte nicht zurueckrechnen lassen).
  const fingerprint = (v) => crypto.createHmac('sha256', ZGLOSZENIE_SECRET || 'pmk-zgloszenie').update(v).digest('hex').slice(0, 16);
  const phoneKey = phoneUsable ? fingerprint(phone) : null;
  const emailMatch = concern.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  const emailKey = emailMatch ? fingerprint(emailMatch[0].toLowerCase()) : null;
  const mailDecision = shouldSendMail(mailPrev, phoneUsable, { urgent: urgentNow, phoneKey, emailKey, phoneSource: picked.phone_source });

  const mailPayload = { name, phone, phone_source: picked.phone_source, concern, lang, source,
                        urgent: urgentNow, recovered, call_link: callLink,
                        updateKind: ({ phone_added: 'phone', phone_changed: 'phone', urgent_added: 'urgent', contact_added: 'contact' })[mailDecision.reason] || '' };
  const sendMail = (payload) => withTimeout(
    sendViaIonos(payload).catch(e => ({ sent: false, reason: 'smtp_error', detail: e && e.message })),
    SMTP_BUDGET_MS,
    { sent: false, reason: 'smtp_timeout' });
  const mailPromise = mailDecision.send
    ? sendMail(mailPayload)
    : Promise.resolve({ sent: false, reason: 'duplicate_suppressed' });

  // Sheet-Zeile: wirft nie, liefert immer ein Objekt. Bei einer Google-Fehlerseite
  // wird der Anfang protokolliert — damit die naechste Analyse den Grund sieht.
  const sheetPromise = fetch(APPS_SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
    redirect: 'follow'
  }).then(async (res) => {
    const text = await res.text();
    try { return JSON.parse(text); }
    catch (_) { return { success: false, error: 'upstream_parse', status: res.status, snippet: text.slice(0, 200) }; }
  }).catch(e => ({ success: false, error: 'upstream_failed', detail: e && e.message }));

  try {
    // Benachrichtigt ist die Pfarrei nur durch eine ZUGESTELLTE Mail oder eine
    // BESTAETIGTE Sheet-Zeile (Code-Review 09.10.2026). Eine als Duplikat
    // unterdrueckte Mail zaehlt nicht: faellt das Sheet aus, geht sie als
    // Aktualisierung doch noch raus (6 s Sheet + 6 s SMTP bleiben unter 20 s).
    const mail = await mailPromise;
    const mailSent = mail.sent === true;
    const suppressed = mail.reason === 'duplicate_suppressed';
    const sheetWait = Math.max(0, ((mailSent || suppressed) ? SHEET_BUDGET_MS : SHEET_HARD_MS) - (Date.now() - t0));
    let data = await budget(sheetPromise, sheetWait, { success: false, error: 'sheet_timeout' });
    let sheetOk = !!(data && data.success);
    let mailFinal = mail;
    if (!sheetOk && suppressed) {
      mailFinal = await sendMail(Object.assign({}, mailPayload, { updateKind: mailPayload.updateKind || 'details' }));
      if (mailFinal.sent !== true) {
        // Auch die Ersatz-Mail kam nicht durch: dem Sheet die restliche Zeit geben,
        // statt "gescheitert" zu melden, obwohl die Zeile gleich kommt.
        const more = await budget(sheetPromise, Math.max(0, SHEET_HARD_MS - (Date.now() - t0)), data);
        if (more && more.success) { data = more; sheetOk = true; }
      }
    }
    const delivered = mailFinal.sent === true;
    if (!sheetOk) {
      console.warn('zgloszenie: Sheet-Zeile nicht bestaetigt', JSON.stringify({
        error: data && data.error, status: data && data.status, snippet: data && data.snippet,
        ms: Date.now() - t0, mail: mailFinal.reason || (delivered ? 'sent' : ''), conversationId
      }));
    }
    if (sheetOk || delivered) {
      const setBudget = Math.min(BLOB_BUDGET_MS, STATE_DEADLINE_MS - (Date.now() - t0));
      if (mailStore && conversationId && setBudget > 0) {
        // Neue Informationen (PILNE, Nummer, E-Mail) gelten erst als bekannt, wenn sie
        // per Mail zugestellt wurden — oder keine Mail noetig war. Sonst holt die
        // naechste Meldung die Mail nach (Re-Review 09.10.2026).
        const adopt = delivered || !mailDecision.send;
        await budget(mailStore.set('c:' + conversationId, JSON.stringify({
          mailed: !!(mailPrev && mailPrev.mailed) || delivered,
          phoneUsable: (adopt && phoneUsable) || !!(mailPrev && mailPrev.phoneUsable),
          urgent: (adopt && urgentNow) || !!(mailPrev && mailPrev.urgent),
          phoneKey: (adopt && phoneKey) || (mailPrev && mailPrev.phoneKey) || null,
          emailKey: (adopt && emailKey) || (mailPrev && mailPrev.emailKey) || null,
          ts: Date.now()
        })), setBudget, null);
      }
      // buildToolResponse entscheidet, ob eine Rückruf-Zusage überhaupt zulässig
      // ist. Ohne verwertbare Nummer kommt stattdessen die Rückfrage zurück.
      const resp = Object.assign(
        { success: true },
        buildToolResponse({ phoneProvided, phoneUsable, phoneSource: picked.phone_source, lang, emailGiven: !!emailMatch }),
        {
          mail: mailFinal,
          sheet: sheetOk ? 'ok' : ((data && data.error) || 'unconfirmed'),
          phone_provided: phoneProvided,
          phone_usable: phoneUsable,
          phone_source: picked.phone_source
        }
      );
      return json(200, resp);
    }
    return json(502, { success: false, error: (data && data.error) || 'upstream_failed', mail: mailFinal });
  } catch (_) {
    return json(502, { success: false, error: 'upstream_failed' });
  }
};
