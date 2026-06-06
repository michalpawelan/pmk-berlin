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
  const phone = String(p.phone || p.telefon || '').trim().slice(0, 60);
  const concern = String(p.concern || p.message || p.sprawa || '').trim().slice(0, 2000);

  // Mindestens ein verwertbares Feld
  if (!name && !phone && !concern) {
    return json(400, { success: false, error: 'empty_zgloszenie' });
  }

  const langRaw = String(p.lang || '').trim().toLowerCase().slice(0, 2);
  const lang = (langRaw === 'de' || langRaw === 'pl') ? langRaw : '';
  const sourceRaw = String(p.source || 'voice').trim().toLowerCase();
  const source = sourceRaw === 'chat' ? 'chat' : 'voice';

  const form = new URLSearchParams();
  form.set('action', 'zgloszenie');
  form.set('name', name);
  form.set('phone', phone);
  form.set('concern', concern);
  form.set('urgent', truthy(p.urgent) ? 'true' : 'false');
  form.set('lang', lang);
  form.set('source', source);

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
      return json(200, { success: true, message: 'Zgłoszenie przyjęte. Oddzwonimy najszybciej, jak to możliwe.' });
    }
    return json(502, { success: false, error: (data && data.error) || 'upstream_failed' });
  } catch (_) {
    return json(502, { success: false, error: 'upstream_failed' });
  }
};
