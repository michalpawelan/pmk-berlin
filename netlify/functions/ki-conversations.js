// netlify/functions/ki-conversations.js
// GET /.netlify/functions/ki-conversations?pin=XXX&days=7
// Listet Conversations vom ElevenLabs-Agenten und merged Flag-Daten aus Netlify Blobs.

const { getStore } = require('@netlify/blobs');

const ELEVENLABS_API = 'https://api.elevenlabs.io/v1/convai/conversations';
const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL
  || 'https://script.google.com/macros/s/AKfycbwr6u5qQRUuQ37gIaczdCG0DmfQRlazDGYUbQOC2CaSCy_tJBywwwChXwtAS8Ivqe9HPw/exec';
const ADMIN_PIN = process.env.ADMIN_PIN || '';

async function verifyPin(pin) {
  // Falls ADMIN_PIN env gesetzt: vergleichen
  if (ADMIN_PIN) return pin === ADMIN_PIN;
  // Fallback: kleinen list-Call gegen Apps Script versuchen
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

function inferChannel(c) {
  const src = String(c.conversation_initiation_source || '').toLowerCase();
  if (src.startsWith('phone') || src.includes('twilio') || src.includes('call')) return 'phone';
  return 'chat';
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
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: JSON.stringify({ success: false, error: 'method_not_allowed' }) };
  }

  const q = event.queryStringParameters || {};
  const pin = q.pin || '';
  if (!pin || !(await verifyPin(pin))) {
    return { statusCode: 401, body: JSON.stringify({ success: false, error: 'unauthorized' }) };
  }

  const days = Math.max(1, Math.min(90, parseInt(q.days || '7', 10) || 7));
  const since = new Date(Date.now() - days * 86400000).toISOString();

  const apiKey = process.env.ELEVENLABS_API_KEY;
  const agentId = process.env.ELEVENLABS_PMK_AGENT_ID;
  if (!apiKey || !agentId) {
    return { statusCode: 500, body: JSON.stringify({ success: false, error: 'elevenlabs_not_configured' }) };
  }

  const url = new URL(ELEVENLABS_API);
  url.searchParams.set('agent_id', agentId);
  url.searchParams.set('page_size', '100');

  let conversations = [];
  try {
    const res = await fetch(url.toString(), { headers: { 'xi-api-key': apiKey } });
    const data = await res.json();
    conversations = Array.isArray(data.conversations) ? data.conversations : [];
  } catch (err) {
    return { statusCode: 502, body: JSON.stringify({ success: false, error: 'elevenlabs_unreachable' }) };
  }

  // Filter nach Datum + auf relevante Felder reduzieren
  conversations = conversations
    .filter(c => !c.start_time_unix_secs || (c.start_time_unix_secs * 1000) >= new Date(since).getTime())
    .map(c => ({
      conversation_id: c.conversation_id,
      started_at: c.start_time_unix_secs ? new Date(c.start_time_unix_secs * 1000).toISOString() : null,
      channel: inferChannel(c),
      language: c.main_language || '',
      first_user_message: c.call_summary_title || c.transcript_summary || '',
      duration_secs: c.call_duration_secs || 0,
      message_count: c.message_count || 0,
      status: c.status || ''
    }));

  // Try to merge flags from Blobs. If Blobs isn't configured (file-based deploys),
  // gracefully degrade to all conversations as unflagged.
  let store;
  try {
    store = getKiStore();
  } catch (err) {
    console.warn('Blobs unavailable, returning conversations without flags:', err.message);
    store = null;
  }
  if (store) {
    await Promise.all(conversations.map(async (c) => {
      try {
        const flag = await store.get(c.conversation_id, { type: 'json' });
        c.flag = flag || { status: 'unhandled' };
      } catch (_) { c.flag = { status: 'unhandled' }; }
    }));
  } else {
    conversations.forEach(c => { c.flag = { status: 'unhandled' }; });
  }

  conversations.sort((a, b) => (b.started_at || '').localeCompare(a.started_at || ''));

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, max-age=30' },
    body: JSON.stringify({ success: true, conversations })
  };
};
