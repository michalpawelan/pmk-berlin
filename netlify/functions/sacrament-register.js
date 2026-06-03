// PMK Berlin — Sakrament-Anmeldung (Erstkommunion / Firmung)
// Ablauf: Formular -> diese Function -> Google Apps Script (MailApp):
//   1) E-Mail an die Pfarrei (pmk@pmk-berlin.de)
//   2) Bestaetigungs-E-Mail an den Absender (Eltern / Kandidat)
// Ersetzt die alte formsubmit.co-Anbindung (US-Drittanbieter, DSGVO + CSP-Problem).

const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL
  || 'https://script.google.com/macros/s/AKfycbzizmtkEWB6IUM-SvAODGCEm10q6opPNLXIY7a7_bGhhZXJDjgu5FAU9QUv_EN16mJERQ/exec';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ALLOWED = new Set(['komunia', 'bierzmowanie']);

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

  // Honeypot: Bots fuellen das versteckte Feld -> "ok" zurueckgeben, aber nichts senden
  if (String(p.website || '').trim()) {
    return json(200, { success: true });
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

  // Optionaler Datei-Anhang (Metryka chrztu, base64) — Groesse begrenzen (Netlify-Body-Limit ~6 MB)
  if (String(p.metryka_data || '').length > 6000000) {
    return json(413, { success: false, error: 'file_too_large' });
  }

  // Alle Felder an Apps Script weiterreichen (Honeypot ausgenommen, Werte gekappt; Datei NICHT kappen)
  const form = new URLSearchParams();
  form.set('action', 'sacrament');
  Object.keys(p).forEach((k) => {
    if (k === 'website') return;
    const v = p[k];
    if (v == null) return;
    if (k === 'metryka_data') { form.set(k, String(v)); return; }
    form.set(k, String(v).slice(0, 2000));
  });

  try {
    const res = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
      redirect: 'follow'
    });
    const text = await res.text();
    // Apps Script liefert bereits { success: ... } JSON zurueck
    return { statusCode: 200, headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: text };
  } catch (_) {
    return json(502, { success: false, error: 'upstream_failed' });
  }
};
