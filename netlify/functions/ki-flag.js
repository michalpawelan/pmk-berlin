// netlify/functions/ki-flag.js
// POST /.netlify/functions/ki-flag
// Body: { pin, conversation_id, status, note? }
// Schreibt/aktualisiert Flag fuer eine Conversation in Netlify Blobs ('ki-flags').

const { getStore } = require('@netlify/blobs');

const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL
  || 'https://script.google.com/macros/s/AKfycbwr6u5qQRUuQ37gIaczdCG0DmfQRlazDGYUbQOC2CaSCy_tJBywwwChXwtAS8Ivqe9HPw/exec';
const ADMIN_PIN = process.env.ADMIN_PIN || '';
const VALID_STATUS = new Set(['unhandled', 'done', 'followup', 'bad_answer', 'spam']);

async function verifyPin(pin) {
  if (ADMIN_PIN) return pin === ADMIN_PIN;
  if (!APPS_SCRIPT_URL) return false;
  const u = new URL(APPS_SCRIPT_URL);
  u.searchParams.set('action', 'list');
  u.searchParams.set('pin', pin);
  try {
    const r = await fetch(u.toString());
    const d = await r.json();
    return d && d.success !== false && Array.isArray(d.events);
  } catch (_) { return false; }
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ success: false, error: 'method_not_allowed' }) };
  }

  let body = {};
  try { body = JSON.parse(event.body || '{}'); }
  catch (_) { return { statusCode: 400, body: JSON.stringify({ success: false, error: 'bad_json' }) }; }

  const { pin, conversation_id, status, note } = body;
  if (!pin || !(await verifyPin(pin))) {
    return { statusCode: 401, body: JSON.stringify({ success: false, error: 'unauthorized' }) };
  }
  if (!conversation_id || typeof conversation_id !== 'string') {
    return { statusCode: 400, body: JSON.stringify({ success: false, error: 'missing_conversation_id' }) };
  }
  if (!VALID_STATUS.has(status)) {
    return { statusCode: 400, body: JSON.stringify({ success: false, error: 'invalid_status' }) };
  }

  const store = getStore('ki-flags');
  const entry = {
    status,
    note: String(note || '').slice(0, 1000),
    flagged_by: 'pin',
    flagged_at: new Date().toISOString()
  };
  await store.setJSON(conversation_id, entry);

  return {
    statusCode: 200,
    body: JSON.stringify({ success: true, flag: entry })
  };
};
