// netlify/functions/img.js
// GET /.netlify/functions/img?id=<drive-id>&w=800
// Liefert Google-Drive-Bilder (Veranstaltungen / Ogloszenia) ueber die eigene
// Domain aus. Grund: das direkte Einbinden von lh3.googleusercontent.com
// uebertraegt die IP jedes Besuchers ohne Einwilligung an Google (DSGVO).
//
// SSRF-Schutz: Es wird NIE eine vom Client gelieferte URL geholt. Die Ziel-URL
// wird ausschliesslich serverseitig aus der streng validierten Drive-ID und
// einer Breite aus der Whitelist zusammengesetzt.

const ID_PATTERN = /^[A-Za-z0-9_-]{10,80}$/;
const ALLOWED_WIDTHS = [400, 800, 1200];
const DEFAULT_WIDTH = 800;
const FETCH_TIMEOUT_MS = 8000;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;   // 5 MB (Netlify-Function-Limit ~6 MB)

// Bilder sind pro ID+Breite unveraenderlich -> lange cachen, damit der Proxy
// nicht bei jedem Seitenaufruf erneut bei Google laedt.
const CACHE_HEADER = 'public, max-age=86400';
const CDN_CACHE_HEADER = 'public, max-age=86400, stale-while-revalidate=604800';

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET' && event.httpMethod !== 'HEAD') {
    return { statusCode: 405, body: JSON.stringify({ error: 'method_not_allowed' }) };
  }

  const q = event.queryStringParameters || {};
  const id = (q.id || '').trim();
  if (!ID_PATTERN.test(id)) {
    return { statusCode: 400, body: JSON.stringify({ error: 'invalid_id' }) };
  }

  const w = ALLOWED_WIDTHS.includes(parseInt(q.w, 10)) ? parseInt(q.w, 10) : DEFAULT_WIDTH;

  // Ziel-URL rein serverseitig gebaut — kein Client-Input in Host oder Pfad.
  const url = `https://lh3.googleusercontent.com/d/${id}=w${w}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(url, { signal: controller.signal, redirect: 'follow' });
    if (!res.ok) {
      // Fehlerstatus -> das onerror-Placeholder-Verhalten der Seite greift.
      return { statusCode: 502, body: JSON.stringify({ error: 'upstream_error', status: res.status }) };
    }

    // Content-Type nur durchreichen, wenn es wirklich ein Bild ist.
    const contentType = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!contentType.startsWith('image/')) {
      return { statusCode: 415, body: JSON.stringify({ error: 'not_an_image' }) };
    }

    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_IMAGE_BYTES) {
      return { statusCode: 502, body: JSON.stringify({ error: 'image_too_large', size: buf.length }) };
    }

    return {
      statusCode: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': CACHE_HEADER,
        'Netlify-CDN-Cache-Control': CDN_CACHE_HEADER,
        'X-Content-Type-Options': 'nosniff'
      },
      body: buf.toString('base64'),
      isBase64Encoded: true
    };
  } catch (err) {
    // Timeout/Netzfehler -> 502, damit die Seite ihren Platzhalter zeigt.
    return { statusCode: 502, body: JSON.stringify({ error: 'upstream_unreachable' }) };
  } finally {
    clearTimeout(timer);
  }
};
