// netlify/functions/ki-transcript.js
// GET /.netlify/functions/ki-transcript?id=conv_XXX&pin=YYY
// Returns chronological transcript for a single ElevenLabs conversation.

const { checkAuth, unauthorized, NO_STORE } = require('./_admin-auth');

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: JSON.stringify({ success: false, error: 'method_not_allowed' }) };
  }

  const auth = await checkAuth(event);
  if (!auth.ok) return unauthorized(auth);

  const q = event.queryStringParameters || {};
  const id = q.id || '';

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
      headers: { 'Content-Type': 'application/json', ...NO_STORE },
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
