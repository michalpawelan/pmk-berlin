// PMK Berlin — KI-Gesundheitswaechter (taeglich, geplant)
//
// Warum es das gibt (Audit 20.08.2026): Der Rueckruf-Ausfall vom 03.08. lief
// 17 Tage unbemerkt. Nicht, weil niemand hingesehen haette, sondern weil jedes
// vorhandene Signal gruen blieb: das Ticket wurde angelegt, die Mail ging raus,
// das Tool meldete success:true, die KI sagte den richtigen Satz, und
// ElevenLabs bewertete die Anrufe als erfolgreich. Das EL-Kriterium
// "rueckrufnummer" lief sogar in die falsche Richtung (29 % Fehler davor,
// 22 % danach), weil es das Transkript bewertet und nicht das Ticket.
//
// Deshalb misst dieser Waechter ausschliesslich ERGEBNISSE:
//   1. Kommt bei mehreren Anrufen hintereinander dieselbe Anrufer-ID an?
//      Das ist bei echten Anrufern praktisch unmoeglich und war die exakte
//      Signatur des Ausfalls — erkennbar in Stunden statt in Wochen.
//   2. Wie viele der angelegten Tickets haben ueberhaupt eine Rueckrufnummer?
//   3. Wie oft scheitert der Eskalations-Tool-Aufruf?
//   4. Reicht das ElevenLabs-Kontingent bis zum naechsten Reset?
//      (Das Konto ist geteilt; am 31.07. fielen PMK-Anrufe einem fremden
//      Projekt zum Opfer.)
//
// Schickt NUR eine Mail, wenn etwas auffaellt. Kein Befund, keine Post.

const VOICE_AGENT = process.env.ELEVENLABS_PMK_AGENT_ID || 'agent_4101kpbhjmptftzr7tscfxk639fq';
const CHAT_AGENT = 'agent_9501kteh8ecmek7asfq0k7zvraqw';

// ---------------------------------------------------------------- Schwellen
const STUCK_RUN = 5;            // so viele gleiche Anrufer-IDs hintereinander
const REACH_MIN_TICKETS = 3;    // darunter ist die Datenlage zu duenn
const REACH_MIN_RATE = 0.5;     // weniger als die Haelfte erreichbar -> Alarm
const TOOLERR_MIN_CALLS = 5;
const TOOLERR_MAX_RATE = 0.2;
const QUOTA_HARD_PCT = 0.95;    // so nah am Limit ist es immer ein Alarm

// 1) Anrufer-ID haengt fest. Nur die juengsten Anrufe zaehlen, damit ein alter
//    Gleichlauf nicht ewig nachhallt. Leere/unterdrueckte Nummern zaehlen nicht.
function detectStuckCallerId(records, minRun) {
  const need = minRun || STUCK_RUN;
  const sorted = (records || []).slice().sort((a, b) => (b.ts || 0) - (a.ts || 0));
  const first = sorted.length ? String(sorted[0].callerId || '').trim() : '';
  let run = 0;
  if (first) {
    for (const r of sorted) {
      if (String(r.callerId || '').trim() === first) run++;
      else break;
    }
  }
  const alert = !!first && run >= need;
  return {
    name: 'Anrufer-ID',
    alert,
    callerId: first,
    run,
    summary: alert
      ? `Die letzten ${run} Anrufe kamen alle mit derselben Anrufer-ID an (${first}). Das ist bei echten Anrufern nicht moeglich und heisst, dass die Rufumleitung die Nummer des Anrufers nicht durchreicht. Tickets bekommen dadurch keine Rueckrufnummer.`
      : `unauffaellig (laengster Gleichlauf: ${run})`
  };
}

// 2) Rueckrufbarkeit der tatsaechlich angelegten Tickets.
function checkReachability(records) {
  const esc = (records || []).flatMap(r => r.escalations || []).filter(e => e.ok);
  const tickets = esc.length;
  const withNumber = esc.filter(e => e.phoneUsable === true).length;
  const rate = tickets ? withNumber / tickets : 1;
  const alert = tickets >= REACH_MIN_TICKETS && rate < REACH_MIN_RATE;
  return {
    name: 'Rueckrufbarkeit',
    alert, tickets, withNumber, rate,
    summary: tickets
      ? `${withNumber} von ${tickets} Tickets haben eine Rueckrufnummer (${Math.round(rate * 100)} %).`
        + (alert ? ' Die Pfarrei kann die uebrigen nicht zurueckrufen.' : '')
      : 'keine Tickets im Zeitraum'
  };
}

// 3) Scheitert der Eskalations-Aufruf? (abgebrochen, 502, 504 …)
function checkToolErrors(records) {
  const all = (records || []).flatMap(r => r.escalations || []);
  const calls = all.length;
  const errors = all.filter(e => !e.ok).length;
  const rate = calls ? errors / calls : 0;
  const alert = calls >= TOOLERR_MIN_CALLS && rate > TOOLERR_MAX_RATE;
  return {
    name: 'Eskalations-Tool',
    alert, calls, errors, rate,
    summary: calls
      ? `${errors} von ${calls} Aufrufen gescheitert (${Math.round(rate * 100)} %).`
      : 'keine Aufrufe im Zeitraum'
  };
}

// 4) Reicht das Kontingent bis zum Reset? Das Konto ist mit anderen Projekten
//    geteilt, der Verbrauch kann also ohne PMK-Zutun explodieren.
function checkQuota({ used, limit, daysToReset, perDay }) {
  const pct = limit ? used / limit : 0;
  const remaining = Math.max(0, (limit || 0) - (used || 0));
  const daysLeft = perDay > 0 ? remaining / perDay : Infinity;
  const willRunOut = daysLeft < (daysToReset || 0);
  const alert = pct >= QUOTA_HARD_PCT || willRunOut;
  return {
    name: 'ElevenLabs-Kontingent',
    alert, pct, remaining, daysLeft: Number.isFinite(daysLeft) ? Math.round(daysLeft * 10) / 10 : -1,
    summary: `${Math.round(pct * 100)} % verbraucht, Rest ${remaining.toLocaleString('de-DE')} Zeichen.`
      + (Number.isFinite(daysLeft)
        ? ` Beim aktuellen Verbrauch reicht das noch ${Math.round(daysLeft * 10) / 10} Tage, bis zum Reset sind es ${daysToReset}.`
        : '')
      + (willRunOut ? ' Das Kontingent laeuft vor dem Reset leer — dann brechen Anrufe stumm ab.' : '')
  };
}

function buildReport(checks) {
  const hits = (checks || []).filter(c => c && c.alert);
  const lines = [];
  lines.push(hits.length
    ? 'Der taegliche KI-Check hat etwas gefunden:'
    : 'Der taegliche KI-Check ist unauffaellig.');
  lines.push('');
  for (const c of hits) lines.push(`[!] ${c.name}: ${c.summary}`);
  if (hits.length) lines.push('');
  lines.push('Alle Pruefungen:');
  for (const c of (checks || [])) lines.push(`  ${c.alert ? '[!]' : '[ok]'} ${c.name}: ${c.summary}`);
  lines.push('');
  lines.push('Dieser Waechter misst bewusst das Ergebnis (Tickets, Nummern, Kontingent)');
  lines.push('und nicht den Gespraechsverlauf — die Selbstbewertung von ElevenLabs war');
  lines.push('beim Ausfall vom 03.08.2026 blind dafuer.');
  return {
    alert: hits.length > 0,
    subject: hits.length
      ? `[!] PMK KI-Check: ${hits.map(c => c.name).join(', ')}`
      : 'PMK KI-Check: unauffaellig',
    body: lines.join('\n')
  };
}

// Signatur des aktuellen Befundstands — reihenfolgeunabhaengig, nur die
// tatsaechlich alarmierenden Pruefungen.
function signatureOf(checks) {
  return (checks || []).filter(c => c && c.alert).map(c => c.name).sort().join('|');
}

// Wann darf der Waechter ueberhaupt mailen? Ein bekanntes, andauerndes Problem
// taeglich zu melden waere genau die Alarmmuedigkeit, die im Audit am Watchdog
// kritisiert wurde. Gemeldet wird nur Neues, Veraendertes, Behobenes — plus
// einmal pro Woche eine Erinnerung, damit nichts stillschweigend liegen bleibt.
const REMINDER_DAYS = 7;
function decideDelivery({ signature, prev, now, reminderDays }) {
  const days = reminderDays || REMINDER_DAYS;
  const prevSig = prev && typeof prev.signature === 'string' ? prev.signature : null;
  const lastSent = (prev && prev.lastSent) || 0;
  if (!signature) {
    return (prevSig)
      ? { send: true, reason: 'resolved' }
      : { send: false, reason: 'quiet' };
  }
  if (prevSig === null) return { send: true, reason: 'new' };
  if (prevSig !== signature) return { send: true, reason: 'changed' };
  if ((now - lastSent) >= days * 86400) return { send: true, reason: 'reminder' };
  return { send: false, reason: 'suppressed' };
}

module.exports = { detectStuckCallerId, checkReachability, checkToolErrors, checkQuota, buildReport,
  signatureOf, decideDelivery };

// ------------------------------------------------------------- Datenbeschaffung
async function el(path) {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new Error('ELEVENLABS_API_KEY fehlt');
  const res = await fetch('https://api.elevenlabs.io/v1/' + path, { headers: { 'xi-api-key': key } });
  if (!res.ok) throw new Error(`ElevenLabs ${path}: HTTP ${res.status}`);
  return res.json();
}

// Aus einer vollen Konversation die zwei Dinge ziehen, die zaehlen:
// die Anrufer-ID und wie die Eskalations-Aufrufe ausgegangen sind.
function toRecord(full) {
  const md = full.metadata || {};
  const dyn = (full.conversation_initiation_client_data || {}).dynamic_variables || {};
  const escalations = [];
  for (const turn of (full.transcript || [])) {
    for (const tr of (turn.tool_results || [])) {
      if (!tr || tr.tool_name !== 'create_zgloszenie') continue;
      const raw = String(tr.result_value == null ? '' : tr.result_value);
      escalations.push({
        ok: !tr.is_error,
        phoneUsable: /"phone_usable"\s*:\s*true/.test(raw) ? true
          : /"phone_usable"\s*:\s*false/.test(raw) ? false : null
      });
    }
  }
  return {
    ts: md.start_time_unix_secs || 0,
    callerId: dyn.system__caller_id || '',
    escalations
  };
}

async function gather(sinceTs, maxDetail) {
  const records = [];
  for (const agent of [VOICE_AGENT, CHAT_AGENT]) {
    const list = await el(`convai/conversations?agent_id=${agent}&page_size=100`);
    const recent = (list.conversations || [])
      .filter(c => (c.start_time_unix_secs || 0) >= sinceTs)
      .slice(0, maxDetail);
    for (const c of recent) {
      try { records.push(toRecord(await el(`convai/conversations/${c.conversation_id}`))); }
      catch (_) { /* einzelner Ausfall darf den Check nicht kippen */ }
    }
  }
  return records;
}

// Zustandsspeicher fuer die Zustellregeln (gleiches Muster wie der Watchdog:
// bei CLI-Deploys fehlt der Blob-Kontext, dann ueber Site-ID + Token).
function openStore() {
  const { getStore } = require('@netlify/blobs');
  try {
    return getStore('ki-health');
  } catch (e) {
    const siteID = process.env.NETLIFY_SITE_ID || process.env.SITE_ID;
    const token = process.env.NETLIFY_API_TOKEN || process.env.NETLIFY_BLOBS_TOKEN;
    if (siteID && token) return getStore({ name: 'ki-health', siteID, token });
    throw new Error('blobs_unconfigured: ' + (e && e.message));
  }
}

async function sendMail(subject, body) {
  const user = process.env.IONOS_SMTP_USER;
  const pass = process.env.IONOS_SMTP_PASS;
  if (!user || !pass) return { sent: false, reason: 'smtp_not_configured' };
  let nodemailer;
  try { nodemailer = require('nodemailer'); }
  catch (_) { return { sent: false, reason: 'nodemailer_missing' }; }
  const host = process.env.IONOS_SMTP_HOST || 'smtp.ionos.de';
  const port = parseInt(process.env.IONOS_SMTP_PORT || '465', 10);
  const to = process.env.KI_HEALTH_TO || user;
  const transporter = nodemailer.createTransport({ host, port, secure: port === 465, auth: { user, pass } });
  await transporter.sendMail({ from: 'PMK KI-Waechter <' + user + '>', to, subject, text: body });
  return { sent: true, to };
}

// ACHTUNG: module.exports wurde oben ersetzt — der Handler MUSS deshalb an
// module.exports haengen, nicht an `exports`. Sonst findet Netlify ihn nicht
// und die Function ist stumm. Der Test prueft das.
module.exports.handler = async () => {
  const now = Math.floor(Date.now() / 1000);
  const windowDays = parseInt(process.env.KI_HEALTH_WINDOW_DAYS || '7', 10);
  try {
    const records = await gather(now - windowDays * 86400, 40);
    const voiceRecords = records.filter(r => r.callerId);

    const sub = await el('user/subscription');
    const resetTs = sub.next_character_count_reset_unix || now;
    const daysToReset = Math.max(0, (resetTs - now) / 86400);
    // Verbrauch pro Tag aus dem laufenden Zyklus schaetzen.
    const cycleDays = Math.max(1, 30 - daysToReset);
    const perDay = (sub.character_count || 0) / cycleDays;

    const checks = [
      detectStuckCallerId(voiceRecords),
      checkReachability(records),
      checkToolErrors(records),
      checkQuota({
        used: sub.character_count || 0,
        limit: sub.character_limit || 0,
        daysToReset: Math.round(daysToReset * 10) / 10,
        perDay
      })
    ];
    const report = buildReport(checks);
    const signature = signatureOf(checks);

    // Zustand lesen, damit derselbe Befund nicht taeglich mailt. Ohne
    // Blob-Speicher lieber einmal zu viel melden als stumm bleiben.
    let store = null, prev = null;
    try { store = openStore(); prev = JSON.parse((await store.get('state')) || 'null'); }
    catch (_) { store = null; }

    const decision = decideDelivery({ signature, prev, now });
    let mail = { sent: false, reason: decision.reason };
    if (decision.send) {
      const subject = decision.reason === 'resolved'
        ? 'PMK KI-Check: wieder unauffaellig'
        : report.subject + (decision.reason === 'reminder' ? ' (seit einer Woche offen)' : '');
      const body = decision.reason === 'resolved'
        ? 'Die zuletzt gemeldeten Befunde treten nicht mehr auf.\n\n' + report.body
        : report.body;
      mail = Object.assign({ reason: decision.reason }, await sendMail(subject, body));
    }
    if (store) {
      try {
        await store.set('state', JSON.stringify({
          signature,
          lastSent: decision.send ? now : ((prev && prev.lastSent) || 0)
        }));
      } catch (_) {}
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ ok: true, alert: report.alert, signature, decision, mail, checks, conversations: records.length }, null, 1)
    };
  } catch (e) {
    // Ein kaputter Waechter darf nicht still sein — das war ja gerade das Problem.
    try { await sendMail('[!] PMK KI-Check laeuft nicht', 'Der Gesundheitscheck ist gescheitert:\n\n' + e.message); } catch (_) {}
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: e.message }) };
  }
};

// Taeglich um 06:00 UTC (08:00 Berlin im Sommer).
module.exports.config = { schedule: '0 6 * * *' };
