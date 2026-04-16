const SHEET_ID = process.env.GOOGLE_SHEET_ID || '';
const SHEET_NAME = process.env.GOOGLE_SHEET_NAME || 'Tabellenblatt1';

exports.handler = async () => {
  if (!SHEET_ID) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Sheet not configured' }) };
  }

  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json&sheet=${encodeURIComponent(SHEET_NAME)}&headers=1`;

  try {
    const res = await fetch(url);
    const text = await res.text();

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'public, no-cache'
      },
      body: text
    };
  } catch (err) {
    return {
      statusCode: 502,
      body: JSON.stringify({ error: 'Failed to fetch events' })
    };
  }
};
