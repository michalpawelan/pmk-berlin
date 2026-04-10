const WEBHOOK_URL = process.env.N8N_WEBHOOK_URL;

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  if (!WEBHOOK_URL) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Webhook not configured' }) };
  }

  try {
    const res = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: event.body
    });

    const data = await res.json();
    console.log('n8n response:', JSON.stringify(data));

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    };
  } catch (err) {
    return {
      statusCode: 502,
      body: JSON.stringify({ error: 'Webhook request failed' })
    };
  }
};
