const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL
  || 'https://script.google.com/macros/s/AKfycbwr6u5qQRUuQ37gIaczdCG0DmfQRlazDGYUbQOC2CaSCy_tJBywwwChXwtAS8Ivqe9HPw/exec';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ success: false, error: 'method_not_allowed' }) };
  }

  let payload = {};
  try {
    payload = JSON.parse(event.body || '{}');
  } catch (_) {
    return { statusCode: 400, body: JSON.stringify({ success: false, error: 'bad_json' }) };
  }

  const email = String(payload.email || '').trim().toLowerCase();
  const lang = String(payload.lang || 'pl').toLowerCase().slice(0, 2);
  const source = String(payload.source || '').slice(0, 200);
  const honeypot = String(payload.website || '').trim();

  if (honeypot) {
    return { statusCode: 200, body: JSON.stringify({ success: true, message: 'subscribed' }) };
  }
  if (!email || email.length > 254 || !EMAIL_RE.test(email)) {
    return { statusCode: 400, body: JSON.stringify({ success: false, error: 'invalid_email' }) };
  }

  const form = new URLSearchParams();
  form.set('action', 'subscribe');
  form.set('email', email);
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
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: text
    };
  } catch (err) {
    return { statusCode: 502, body: JSON.stringify({ success: false, error: 'upstream_failed' }) };
  }
};
