// netlify/functions/upload.js
// Bilder-Upload-Proxy: POST { fileName, mimeType, data (base64), pin }
// Laedt das Bild via OAuth-Refresh-Token direkt in Drive hoch (in den Drive
// des Users der den OAuth-Flow durchlaufen hat).
// Umgeht das Apps-Script-anonymous-POST-Problem (302-Redirect verwirft Body).
//
// Env vars (Netlify dashboard):
//   ADMIN_PIN              - selber PIN wie im Apps Script (pmk2026)
//   GOOGLE_CLIENT_ID       - OAuth Client ID (aus GCP)
//   GOOGLE_CLIENT_SECRET   - OAuth Client Secret (aus GCP)
//   GOOGLE_REFRESH_TOKEN   - Refresh Token (aus OAuth Playground, einmalig)
//   DRIVE_FOLDER_ID        - (optional) Ziel-Folder-ID. Leer = Drive-Root.

const crypto = require('crypto');

const ADMIN_PIN             = process.env.ADMIN_PIN || '';
const GOOGLE_CLIENT_ID      = process.env.GOOGLE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET  = process.env.GOOGLE_CLIENT_SECRET || '';
const GOOGLE_REFRESH_TOKEN  = process.env.GOOGLE_REFRESH_TOKEN || '';
const FOLDER_ID             = process.env.DRIVE_FOLDER_ID || '';

let cachedToken = null;
let tokenExpiry = 0;

async function getAccessToken() {
  if (cachedToken && Date.now() < tokenExpiry - 60_000) return cachedToken;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token: GOOGLE_REFRESH_TOKEN,
      grant_type: 'refresh_token'
    }).toString()
  });
  const data = await res.json();
  if (!data.access_token) {
    throw new Error('OAuth-Refresh fehlgeschlagen: ' + JSON.stringify(data));
  }
  cachedToken = data.access_token;
  tokenExpiry = Date.now() + (data.expires_in * 1000);
  return cachedToken;
}

async function uploadToDrive(token, fileName, mimeType, fileBuffer) {
  const boundary = 'pmk' + crypto.randomBytes(8).toString('hex');
  const metadata = {
    name: fileName,
    mimeType,
    ...(FOLDER_ID ? { parents: [FOLDER_ID] } : {})
  };
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`),
    fileBuffer,
    Buffer.from(`\r\n--${boundary}--`)
  ]);

  const res = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id&supportsAllDrives=true',
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': `multipart/related; boundary=${boundary}`
      },
      body
    }
  );
  const data = await res.json();
  if (!data.id) throw new Error('Drive-Upload fehlgeschlagen: ' + JSON.stringify(data));
  return data.id;
}

async function makePublic(token, fileId) {
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}/permissions?supportsAllDrives=true`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ role: 'reader', type: 'anyone' })
    }
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error('Berechtigung setzen fehlgeschlagen: ' + text);
  }
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: {
        'Access-Control-Allow-Methods': 'POST,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
      }
    };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ success: false, error: 'method_not_allowed' }) };
  }
  if (!ADMIN_PIN || !GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REFRESH_TOKEN) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        success: false,
        error: 'Server nicht konfiguriert: ADMIN_PIN / GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REFRESH_TOKEN fehlt in Netlify env vars'
      })
    };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch (_) {
    return { statusCode: 400, body: JSON.stringify({ success: false, error: 'Ungültiges JSON' }) };
  }

  const { fileName, mimeType, data, pin } = payload;
  if (pin !== ADMIN_PIN) {
    return { statusCode: 401, body: JSON.stringify({ success: false, error: 'Nieprawidlowy PIN' }) };
  }
  if (!data) {
    return { statusCode: 400, body: JSON.stringify({ success: false, error: 'Brak danych obrazu' }) };
  }

  const finalName = fileName || ('event-' + Date.now() + '.jpg');
  const finalMime = mimeType || 'image/jpeg';

  try {
    const token = await getAccessToken();
    const buffer = Buffer.from(data, 'base64');
    const fileId = await uploadToDrive(token, finalName, finalMime, buffer);
    await makePublic(token, fileId);
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        fileId,
        imageUrl: `https://drive.google.com/file/d/${fileId}/view`,
        message: 'Obraz przesłany'
      })
    };
  } catch (err) {
    console.error('upload.js error:', err);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, error: err.message || String(err) })
    };
  }
};
