// netlify/functions/ki-audio.js
// GET /.netlify/functions/ki-audio?id=conv_XXX&pin=YYY
// Streams ElevenLabs conversation audio (MP3). Returns 413 if >5 MB.

const { checkAuth, unauthorized, verifyToken } = require('./_admin-auth');
const MAX_AUDIO_BYTES = 5 * 1024 * 1024;   // 5 MB

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: JSON.stringify({ success: false, error: 'method_not_allowed' }) };
  }

  const q = event.queryStringParameters || {};
  const id = q.id || '';
  if (!id || !id.startsWith('conv_')) {
    return { statusCode: 400, body: JSON.stringify({ success: false, error: 'invalid_id' }) };
  }

  // Das <audio>-Element kann keine Header setzen -> kurzlebiges, an die conv-id
  // gebundenes Token (aus ki-conversations) akzeptieren. Sonst normaler PIN-Check.
  if (!verifyToken(id, q.token)) {
    const auth = await checkAuth(event);
    if (!auth.ok) return unauthorized(auth);
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
        'Cache-Control': 'private, no-store',
        'Accept-Ranges': 'none'
      },
      body: buf.toString('base64'),
      isBase64Encoded: true
    };
  } catch (err) {
    return { statusCode: 502, body: JSON.stringify({ success: false, error: 'elevenlabs_unreachable' }) };
  }
};
