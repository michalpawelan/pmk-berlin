// netlify/functions/ki-flag.js
// POST /.netlify/functions/ki-flag
// Body: { pin, conversation_id, status, note? }
// Schreibt/aktualisiert Flag fuer eine Conversation in Netlify Blobs ('ki-flags').

const { getStore } = require('@netlify/blobs');

const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL
  || 'https://script.google.com/macros/s/AKfycbzizmtkEWB6IUM-SvAODGCEm10q6opPNLXIY7a7_bGhhZXJDjgu5FAU9QUv_EN16mJERQ/exec';
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

function getKiStore() {
  const siteID = process.env.NETLIFY_SITE_ID;
  const token = process.env.NETLIFY_API_TOKEN;
  if (siteID && token) {
    // Explicit auth — works for file-based deploys
    return getStore({ name: 'ki-flags', siteID, token, consistency: 'strong' });
  }
  // Fallback — works for build-from-source deploys where context is auto-injected
  return getStore('ki-flags');
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

  let store;
  try {
    store = getKiStore();
  } catch (err) {
    return {
      statusCode: 503,
      body: JSON.stringify({ success: false, error: 'blobs_not_configured', detail: err.message })
    };
  }
  const entry = {
    status,
    note: String(note || '').slice(0, 1000),
    flagged_by: 'pin',
    flagged_at: new Date().toISOString()
  };
  try {
    await store.setJSON(conversation_id, entry);
  } catch (err) {
    return {
      statusCode: 502,
      body: JSON.stringify({ success: false, error: 'blobs_write_failed', detail: err.message })
    };
  }
  return {
    statusCode: 200,
    body: JSON.stringify({ success: true, flag: entry })
  };
};
