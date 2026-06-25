// netlify/functions/_admin-auth.js
// Geteilte Admin-Authentifizierung fuer alle PIN-geschuetzten Netlify-Functions.
//
// Verbesserungen gegenueber dem alten `pin === ADMIN_PIN` pro Datei:
//  1) PIN wird bevorzugt aus dem Header `X-Admin-Pin` gelesen (nicht mehr in der
//     URL-Query -> landet nicht in Netlify-/Proxy-Logs und Browser-History).
//     Query `?pin=` bleibt als Fallback (Rueckwaerts-Kompatibilitaet) erhalten.
//  2) Konstant-Zeit-Vergleich (crypto.timingSafeEqual) gegen Timing-Seitenkanal.
//  3) Rate-Limiting / Lockout pro Client-IP via Netlify Blobs (Brute-Force-Schutz).
//  4) Kurzlebige, signierte Tokens fuer <audio>-URLs, damit der PIN nicht im DOM
//     bzw. in der Audio-URL steht (mintToken/verifyToken).

const crypto = require('crypto');
const { getStore } = require('@netlify/blobs');

const ADMIN_PIN = process.env.ADMIN_PIN || '';
const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL
  || 'https://script.google.com/macros/s/AKfycbzizmtkEWB6IUM-SvAODGCEm10q6opPNLXIY7a7_bGhhZXJDjgu5FAU9QUv_EN16mJERQ/exec';
// HMAC-Schluessel fuer Audio-Tokens. Default = ADMIN_PIN (rotiert der PIN, werden
// alte Tokens ungueltig — egal, TTL ist ohnehin kurz). Optional eigenes Secret.
const TOKEN_SECRET = process.env.TOKEN_SECRET || ADMIN_PIN;

// Rate-Limit: nach MAX_FAILS Fehlversuchen pro IP im Fenster -> Lockout.
const MAX_FAILS = 8;
const WINDOW_MS = 10 * 60 * 1000;  // 10 min
const LOCK_MS   = 15 * 60 * 1000;  // 15 min

const NO_STORE = { 'Cache-Control': 'private, no-store' };

function safeEqual(a, b) {
  const ba = Buffer.from(String(a == null ? '' : a));
  const bb = Buffer.from(String(b == null ? '' : b));
  if (ba.length !== bb.length) {
    // Laengen-Unterschied: trotzdem einen Vergleich fahren, dann hart ablehnen.
    try { crypto.timingSafeEqual(ba, ba); } catch (_) {}
    return false;
  }
  return crypto.timingSafeEqual(ba, bb);
}

// PIN aus Header (bevorzugt) oder Query (Fallback). Header-Namen kommen bei
// Netlify lowercased an, wir pruefen defensiv mehrere Schreibweisen.
function readPin(event) {
  const h = event.headers || {};
  const hv = h['x-admin-pin'] || h['X-Admin-Pin'] || h['X-ADMIN-PIN'];
  if (hv) return String(hv);
  const q = event.queryStringParameters || {};
  return q.pin ? String(q.pin) : '';
}

function clientIp(event) {
  const h = event.headers || {};
  const xff = (h['x-forwarded-for'] || '').split(',')[0];
  return String(h['x-nf-client-connection-ip'] || h['client-ip'] || xff || 'unknown').trim() || 'unknown';
}

function authStore() {
  try {
    const siteID = process.env.NETLIFY_SITE_ID;
    const token = process.env.NETLIFY_API_TOKEN;
    if (siteID && token) return getStore({ name: 'admin-auth', siteID, token, consistency: 'strong' });
    return getStore('admin-auth');
  } catch (_) {
    return null;  // Blobs nicht verfuegbar -> Rate-Limit degradiert sanft (no-op)
  }
}

// Eigentliche PIN-Pruefung (env-Vergleich, sonst Apps-Script-Fallback).
async function verifyPin(pin) {
  if (!pin) return false;
  if (ADMIN_PIN) return safeEqual(pin, ADMIN_PIN);
  if (!APPS_SCRIPT_URL) return false;
  try {
    const u = new URL(APPS_SCRIPT_URL);
    u.searchParams.set('action', 'list');
    u.searchParams.set('pin', pin);
    const r = await fetch(u.toString());
    const d = await r.json();
    return !!(d && d.success !== false && Array.isArray(d.events));
  } catch (_) { return false; }
}

// Haupt-Eintritt: liefert { ok:true } oder { ok:false, statusCode, error }.
// explicitPin: fuer POST-Bodies, die den PIN im Body schicken (upload, ki-flag).
async function checkAuth(event, explicitPin) {
  const pin = readPin(event) || (explicitPin ? String(explicitPin) : '');
  if (!pin) return { ok: false, statusCode: 401, error: 'unauthorized' };

  const ip = clientIp(event);
  const store = authStore();
  const now = Date.now();

  let rec = null;
  if (store) { try { rec = await store.get('fail:' + ip, { type: 'json' }); } catch (_) {} }
  if (rec && rec.lockedUntil && now < rec.lockedUntil) {
    return { ok: false, statusCode: 429, error: 'too_many_attempts' };
  }

  if (await verifyPin(pin)) {
    if (store && rec) { try { await store.delete('fail:' + ip); } catch (_) {} }
    return { ok: true };
  }

  if (store) {
    try {
      const inWindow = rec && rec.windowStart && (now - rec.windowStart) < WINDOW_MS;
      const count = inWindow ? rec.count + 1 : 1;
      const windowStart = inWindow ? rec.windowStart : now;
      const next = { count, windowStart };
      if (count >= MAX_FAILS) next.lockedUntil = now + LOCK_MS;
      await store.setJSON('fail:' + ip, next);
    } catch (_) {}
  }
  return { ok: false, statusCode: 401, error: 'unauthorized' };
}

function unauthorized(res) {
  return {
    statusCode: res.statusCode || 401,
    headers: { 'Content-Type': 'application/json', ...NO_STORE },
    body: JSON.stringify({ success: false, error: res.error || 'unauthorized' })
  };
}

// --- Kurzlebige, signierte Tokens fuer <audio>-URLs (PIN bleibt aus der URL) ---
function mintToken(id, ttlMs = 10 * 60 * 1000) {
  if (!TOKEN_SECRET) return '';
  const exp = Date.now() + ttlMs;
  const sig = crypto.createHmac('sha256', TOKEN_SECRET).update(id + '.' + exp).digest('base64url');
  return exp + '.' + sig;
}
function verifyToken(id, token) {
  if (!token || !TOKEN_SECRET) return false;
  const s = String(token);
  const dot = s.indexOf('.');
  if (dot < 0) return false;
  const exp = parseInt(s.slice(0, dot), 10);
  const sig = s.slice(dot + 1);
  if (!exp || Date.now() > exp) return false;
  const expect = crypto.createHmac('sha256', TOKEN_SECRET).update(id + '.' + exp).digest('base64url');
  return safeEqual(sig, expect);
}

module.exports = { checkAuth, unauthorized, readPin, safeEqual, mintToken, verifyToken, NO_STORE };
