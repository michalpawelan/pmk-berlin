// netlify/functions/newsletter-list.js
// GET /.netlify/functions/newsletter-list?pin=XXX
// Proxiert list_subscribers vom Apps Script, damit der PIN nicht client-side im Apps-Script-URL landet.

const { checkAuth, unauthorized, readPin, NO_STORE } = require('./_admin-auth');

const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL
  || 'https://script.google.com/macros/s/AKfycbzizmtkEWB6IUM-SvAODGCEm10q6opPNLXIY7a7_bGhhZXJDjgu5FAU9QUv_EN16mJERQ/exec';

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: JSON.stringify({ success: false, error: 'method_not_allowed' }) };
  }

  // Lokaler Auth-Check (Rate-Limit + Konstant-Zeit) BEVOR die Subscriber-Liste
  // (PII) vom Apps Script geholt wird. Vorher pruefte nur das Apps Script.
  const auth = await checkAuth(event);
  if (!auth.ok) return unauthorized(auth);
  const pin = readPin(event);

  const url = new URL(APPS_SCRIPT_URL);
  url.searchParams.set('action', 'list_subscribers');
  url.searchParams.set('pin', pin);

  try {
    const res = await fetch(url.toString());
    const text = await res.text();
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', ...NO_STORE },
      body: text
    };
  } catch (err) {
    return {
      statusCode: 502,
      body: JSON.stringify({ success: false, error: 'upstream_failed' })
    };
  }
};
