// netlify/functions/newsletter-list.js
// GET /.netlify/functions/newsletter-list?pin=XXX
// Proxiert list_subscribers vom Apps Script, damit der PIN nicht client-side im Apps-Script-URL landet.

const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL
  || 'https://script.google.com/macros/s/AKfycbwr6u5qQRUuQ37gIaczdCG0DmfQRlazDGYUbQOC2CaSCy_tJBywwwChXwtAS8Ivqe9HPw/exec';

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: JSON.stringify({ success: false, error: 'method_not_allowed' }) };
  }

  const pin = (event.queryStringParameters && event.queryStringParameters.pin) || '';
  if (!pin) {
    return { statusCode: 401, body: JSON.stringify({ success: false, error: 'missing_pin' }) };
  }

  const url = new URL(APPS_SCRIPT_URL);
  url.searchParams.set('action', 'list_subscribers');
  url.searchParams.set('pin', pin);

  try {
    const res = await fetch(url.toString());
    const text = await res.text();
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60' },
      body: text
    };
  } catch (err) {
    return {
      statusCode: 502,
      body: JSON.stringify({ success: false, error: 'upstream_failed' })
    };
  }
};
