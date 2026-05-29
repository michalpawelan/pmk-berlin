// netlify/functions/ki-audio.js
// GET /.netlify/functions/ki-audio?id=conv_XXX&pin=YYY
// Streams ElevenLabs conversation audio (MP3). Returns 413 if >5 MB.

const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL
  || 'https://script.google.com/macros/s/AKfycbzizmtkEWB6IUM-SvAODGCEm10q6opPNLXIY7a7_bGhhZXJDjgu5FAU9QUv_EN16mJERQ/exec';
const ADMIN_PIN = process.env.ADMIN_PIN || '';
const MAX_AUDIO_BYTES = 5 * 1024 * 1024;   // 5 MB

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

  const url = `https://api.elevenlabs.io/v1/convai/conversations/${encodeURIComponent(id)}/audio`;

  try {
    const res = await fetch(url, { headers: { 'xi-api-key': apiKey } });
    if (!res.ok) {
      return { statusCode: 502, body: JSON.stringify({ success: false, error: 'elevenlabs_error', status: res.status }) };
    }

    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_AUDIO_BYTES) {
      return {
        statusCode: 413,
        body: JSON.stringify({ success: false, error: 'audio_too_large', size: buf.length, max: MAX_AUDIO_BYTES })
      };
    }

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'audio/mpeg',
        'Cache-Control': 'private, max-age=3600',
        'Accept-Ranges': 'none'
      },
      body: buf.toString('base64'),
      isBase64Encoded: true
    };
  } catch (err) {
    return { statusCode: 502, body: JSON.stringify({ success: false, error: 'elevenlabs_unreachable' }) };
  }
};
