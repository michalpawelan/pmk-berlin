// netlify/functions/ki-transcript.js
// GET /.netlify/functions/ki-transcript?id=conv_XXX&pin=YYY
// Returns chronological transcript for a single ElevenLabs conversation.

const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL
  || 'https://script.google.com/macros/s/AKfycbzizmtkEWB6IUM-SvAODGCEm10q6opPNLXIY7a7_bGhhZXJDjgu5FAU9QUv_EN16mJERQ/exec';
const ADMIN_PIN = process.env.ADMIN_PIN || '';

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
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: JSON.stringify({ success: false, error: 'method_not_allowed' }) };
  }

  const q = event.queryStringParameters || {};
  const pin = q.pin || '';
  const id = q.id || '';

  if (!pin || !(await verifyPin(pin))) {
    return { statusCode: 401, body: JSON.stringify({ success: false, error: 'unauthorized' }) };
  }
  if (!id || !id.startsWith('conv_')) {
    return { statusCode: 400, body: JSON.stringify({ success: false, error: 'invalid_id' }) };
  }

  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, body: JSON.stringify({ success: false, error: 'elevenlabs_not_configured' }) };
  }

  const url = `https://api.elevenlabs.io/v1/convai/conversations/${encodeURIComponent(id)}`;

  try {
    const res = await fetch(url, { headers: { 'xi-api-key': apiKey } });
    if (!res.ok) {
      return { statusCode: 502, body: JSON.stringify({ success: false, error: 'elevenlabs_error', status: res.status }) };
    }
    const data = await res.json();

    // Extract chronological transcript: each message has role ('user' | 'agent') and message text
    const transcript = Array.isArray(data.transcript) ? data.transcript.map(m => ({
      role: m.role || 'unknown',
      text: m.message || m.text || '',
      time_in_call_secs: m.time_in_call_secs || 0
    })) : [];

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, max-age=300' },
      body: JSON.stringify({
        success: true,
        conversation_id: id,
        transcript,
        message_count: transcript.length
      })
    };
  } catch (err) {
    return { statusCode: 502, body: JSON.stringify({ success: false, error: 'elevenlabs_unreachable' }) };
  }
};
