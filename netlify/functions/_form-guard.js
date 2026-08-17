// netlify/functions/_form-guard.js
// Geteilter Spam-Schutz fuer die oeffentlichen Formular-Endpoints
// (spende-danke, sacrament-register, newsletter-subscribe).
//
// Anlass (17.08.2026): Ein Bot hat rund 100 Fake-Spendermeldungen durch
// /.netlify/functions/spende-danke geschickt (Faker-Namen wie "Alda Kilback",
// erfundene US-Nummern). Der vorhandene Honeypot greift dabei nicht: der Bot
// postet direkt auf die Function-URL und sieht das versteckte Feld nie.
//
// Das eigentliche Risiko war nicht das volle Postfach, sondern die automatische
// Bestaetigungsmail: sie ging von admin@pmk-berlin.de an eine vom Bot frei
// gewaehlte Fremdadresse. Genug davon und IONOS sperrt bzw. Blacklists die
// Absenderadresse — dann faellt auch die Sakrament-Anmeldung und der Newsletter
// aus. Deshalb zusaetzlich zum Rate-Limit eine harte Tagesobergrenze fuer genau
// diese Mails an selbst eingetippte Adressen (dailyQuota).
//
// Vier Schichten, absichtlich in dieser Reihenfolge (billigste zuerst):
//   1) originOk    — Origin/Referer muss zur eigenen Seite gehoeren (kein Blob-Zugriff)
//   2) verifyToken — signiertes, kurzlebiges Token aus /form-token; erzwingt
//                    zugleich eine Mindest-Ausfuellzeit ("Zeitschloss")
//   3) rateLimit   — pro Client-IP, Stunden- und Tagesfenster (Netlify Blobs)
//   4) consumeToken— Token nur einmal gueltig (Replay-Schutz, Netlify Blobs)
// Der Honeypot in den einzelnen Functions bleibt zusaetzlich bestehen.
//
// Sanfter Ausfall ist Absicht: fehlt FORM_TOKEN_SECRET oder sind Blobs nicht
// erreichbar, laesst der Guard durch statt echte Anmeldungen zu verlieren.

const crypto = require('crypto');
const { getStore } = require('@netlify/blobs');

const SECRET = process.env.FORM_TOKEN_SECRET || '';

const TOKEN_VERSION = 'v1';
const MIN_AGE_MS = 2000;                   // schneller fuellt kein Mensch ein Formular aus
const MAX_AGE_MS = 2 * 60 * 60 * 1000;     // Seite darf 2 h offen liegen
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

// Eigene Hosts. Ueber ALLOWED_ORIGIN_HOSTS erweiterbar, ohne Deploy.
const ALLOWED_HOSTS = String(
  process.env.ALLOWED_ORIGIN_HOSTS
  || 'pmk-berlin.de,www.pmk-berlin.de,pmk-berlinpl.netlify.app,localhost,127.0.0.1'
).split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

// Netlify-Draft-/Preview-Deploys: <deploy-id>--pmk-berlinpl.netlify.app
const NETLIFY_PREVIEW_RE = /^[a-z0-9-]+--pmk-berlinpl\.netlify\.app$/;

function safeEqual(a, b) {
  const ba = Buffer.from(String(a == null ? '' : a));
  const bb = Buffer.from(String(b == null ? '' : b));
  if (ba.length !== bb.length) {
    try { crypto.timingSafeEqual(ba, ba); } catch (_) {}
    return false;
  }
  return crypto.timingSafeEqual(ba, bb);
}

function clientIp(event) {
  const h = (event && event.headers) || {};
  const xff = (h['x-forwarded-for'] || '').split(',')[0];
  return String(h['x-nf-client-connection-ip'] || h['client-ip'] || xff || 'unknown').trim() || 'unknown';
}

function hostAllowed(host) {
  const h = String(host || '').toLowerCase();
  if (!h) return false;
  if (ALLOWED_HOSTS.indexOf(h) !== -1) return true;
  return NETLIFY_PREVIEW_RE.test(h);
}

// Browser schicken bei POST immer einen Origin, bei same-origin GET nur einen
// Referer — deshalb beide pruefen. Fehlt beides, ist es kein Browser-Formular.
function originOk(event) {
  const h = (event && event.headers) || {};
  const raw = h.origin || h.Origin || h.referer || h.Referer || '';
  if (!raw) return false;
  let host;
  try { host = new URL(String(raw)).hostname; } catch (_) { return false; }
  return hostAllowed(host);
}

function b64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function _signWith(secret, payload) {
  return b64url(crypto.createHmac('sha256', String(secret)).update(String(payload)).digest());
}

// Token = v1.<ausgestellt-ms>.<nonce>.<HMAC>. Traegt seinen Zeitstempel selbst,
// deshalb braucht der Server keinen Sitzungsspeicher fuer die Ausfuellzeit.
function issueToken(now) {
  const ts = Number(now || Date.now());
  const nonce = crypto.randomBytes(9).toString('hex');
  return [TOKEN_VERSION, ts, nonce, _signWith(SECRET, ts + '.' + nonce)].join('.');
}

function verifyToken(token, now, opts) {
  const secret = (opts && Object.prototype.hasOwnProperty.call(opts, 'secret')) ? opts.secret : SECRET;
  if (!secret) return { ok: true, degraded: true };

  const parts = String(token || '').split('.');
  if (parts.length !== 4 || parts[0] !== TOKEN_VERSION) return { ok: false, error: 'bad_token' };
  const ts = parts[1], nonce = parts[2], sig = parts[3];
  if (!/^\d{10,16}$/.test(ts) || !/^[a-f0-9]{6,64}$/.test(nonce)) return { ok: false, error: 'bad_token' };
  if (!safeEqual(sig, _signWith(secret, ts + '.' + nonce))) return { ok: false, error: 'bad_token' };

  const age = Number(now || Date.now()) - Number(ts);
  if (age < MIN_AGE_MS) return { ok: false, error: 'too_fast' };
  if (age > MAX_AGE_MS) return { ok: false, error: 'token_expired' };
  return { ok: true, nonce };
}

// Blob-Store fuer Zaehler. Bei CLI-Deploys fehlt der automatische Kontext,
// deshalb wie in _admin-auth.js explizit siteID/token mitgeben.
function guardStore() {
  try {
    const siteID = process.env.NETLIFY_SITE_ID;
    const token = process.env.NETLIFY_API_TOKEN;
    if (siteID && token) return getStore({ name: 'form-guard', siteID, token, consistency: 'strong' });
    return getStore('form-guard');
  } catch (_) {
    return null;   // ohne Blobs laufen die Zaehler als no-op weiter
  }
}

// Stunden- und Tagesfenster pro IP in einem Datensatz.
async function rateLimit(bucket, ip, limits) {
  const store = guardStore();
  if (!store) return { ok: true, degraded: true };

  const perHour = (limits && limits.perHour) || 5;
  const perDay = (limits && limits.perDay) || 20;
  const now = Date.now();
  const key = 'rl:' + bucket + ':' + ip;

  let rec;
  try { rec = (await store.get(key, { type: 'json' })) || {}; }
  catch (_) { return { ok: true, degraded: true }; }

  const inHour = rec.hourStart && (now - rec.hourStart) < HOUR_MS;
  const inDay = rec.dayStart && (now - rec.dayStart) < DAY_MS;
  const hourCount = (inHour ? rec.hourCount : 0) + 1;
  const dayCount = (inDay ? rec.dayCount : 0) + 1;

  if (hourCount > perHour || dayCount > perDay) {
    // Bewusst nicht hochzaehlen: sonst schiebt ein Dauerfeuer das Fenster ewig weiter.
    return { ok: false, error: 'rate_limited' };
  }

  try {
    await store.setJSON(key, {
      hourStart: inHour ? rec.hourStart : now, hourCount,
      dayStart: inDay ? rec.dayStart : now, dayCount
    });
  } catch (_) {}
  return { ok: true };
}

// Ein Token darf genau einmal eingeloest werden (sonst holt sich ein Bot eines
// und schickt damit hundert Anfragen).
async function consumeToken(nonce) {
  const store = guardStore();
  if (!store || !nonce) return { ok: true, degraded: true };
  const key = 'tok:' + nonce;
  try {
    if (await store.get(key)) return { ok: false, error: 'token_used' };
    await store.set(key, String(Date.now()));
  } catch (_) {
    return { ok: true, degraded: true };
  }
  return { ok: true };
}

// Harte Tagesobergrenze fuer Mails an selbst eingetippte Adressen. Schuetzt die
// Reputation von admin@pmk-berlin.de auch dann, wenn ein Botnetz die IP wechselt
// und das Rate-Limit pro IP deshalb nicht greift.
async function dailyQuota(name, max) {
  const store = guardStore();
  if (!store) return { ok: true, degraded: true };
  const now = Date.now();
  const key = 'quota:' + name;
  let rec;
  try { rec = (await store.get(key, { type: 'json' })) || {}; }
  catch (_) { return { ok: true, degraded: true }; }

  const inDay = rec.dayStart && (now - rec.dayStart) < DAY_MS;
  const count = (inDay ? rec.count : 0) + 1;
  if (count > max) return { ok: false, error: 'daily_quota' };

  try { await store.setJSON(key, { dayStart: inDay ? rec.dayStart : now, count }); } catch (_) {}
  return { ok: true };
}

// Sammelpruefung fuer die Formular-Handler.
// opts: { token, bucket, perHour, perDay, requireToken }
//
// requireToken:false ist fuer das Newsletter-Feld im Footer gedacht: es steht auf
// jeder Seite, aber nur die vier Seiten mit echten Formularen laden
// js/form-token.js. Dort bleiben Origin-Pruefung, Rate-Limit und Honeypot.
async function guard(event, opts) {
  const o = opts || {};
  const requireToken = o.requireToken !== false;

  if (!originOk(event)) return { ok: false, statusCode: 403, error: 'forbidden_origin' };

  let t = { ok: true };
  if (requireToken || o.token) {
    t = verifyToken(o.token, Date.now());
    if (!t.ok) return { ok: false, statusCode: 403, error: t.error };
  }

  const rl = await rateLimit(o.bucket || 'form', clientIp(event), { perHour: o.perHour, perDay: o.perDay });
  if (!rl.ok) return { ok: false, statusCode: 429, error: 'rate_limited' };

  if (t.nonce) {
    const used = await consumeToken(t.nonce);
    if (!used.ok) return { ok: false, statusCode: 403, error: used.error };
  }
  return { ok: true };
}

module.exports = {
  clientIp,
  originOk,
  issueToken,
  verifyToken,
  rateLimit,
  consumeToken,
  dailyQuota,
  guard,
  _signWith,
  MIN_AGE_MS,
  MAX_AGE_MS
};
