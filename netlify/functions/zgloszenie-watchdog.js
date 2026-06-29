// PMK Berlin — Zgłoszenie-Watchdog
// Geplante Function: pollt die zwei PMK-Agenten, erkennt versprochene Handoffs
// ohne erfolgreichen create_zgloszenie-Tool-Call und erstellt ein als
// "recovered" markiertes Ticket. Reine Detektions-Helfer unten sind für
// scripts/test-watchdog.cjs exportiert.

const AGENTS = {
  'agent_4101kpbhjmptftzr7tscfxk639fq': 'voice',
  'agent_9501kteh8ecmek7asfq0k7zvraqw': 'chat',
};
const EL_BASE = 'https://api.elevenlabs.io/v1/convai';

const HANDOFF_RE = /przekaż|przekaza[łl]|przekazu|zanotuj|notuj[ęe]|odezwie|oddzwoni|weitergeleitet|weitergegeben|leite[^.]{0,25}weiter|melden sich|notiert|i'?ll pass|pass(?:ed)? (?:it|this) on/i;
const SALES_RE = /churchdesk|ofert\w*\s+handlow|współprac|wspolprac|reklam|w imieniu firmy|przedstawiciel handlow|sprzedaż|kooperation|werbung|vertrieb|im auftrag (?:der |des )?firma?/i;
const URGENT_RE = /umiera|kona\b|intensywn|zagrożenie życia|zagrozenie zycia|namaszcz|ostatnie namaszczenie|reanimacj|sterbe|sterbend|stirbt|krankensalbung|letzte ölung|nie żyje|zmar[łl]/i;

function agentText(transcript) {
  return (transcript || []).filter(t => t && t.role === 'agent').map(t => t.message || '').join('\n');
}
function allText(transcript) {
  return (transcript || []).map(t => (t && t.message) || '').join('\n');
}
function userText(transcript) {
  return (transcript || []).filter(t => t && t.role === 'user').map(t => t.message || '').join('\n');
}
function hasHandoffPromise(transcript) { return HANDOFF_RE.test(agentText(transcript)); }
function isSalesCall(transcript) { return SALES_RE.test(allText(transcript)); }
// Dringlichkeit NUR aus den Worten des ANRUFERS — sonst lösen die Sakramenten-
// Antworten des Agenten ("namaszczenie chorych") Fehlalarme bei reinen Infofragen aus.
function isUrgent(transcript) { return URGENT_RE.test(userText(transcript)); }

function hasSuccessfulZgloszenie(transcript) {
  for (const turn of (transcript || [])) {
    for (const r of ((turn && turn.tool_results) || [])) {
      if (r && r.tool_name === 'create_zgloszenie' && r.is_error === false && r.tool_has_been_called === true) {
        return true;
      }
    }
  }
  return false;
}

// Weitere Handoff-Signale jenseits des wörtlichen Versprechens. Die Analyse
// erfasst Rückrufnummer/Name und ggf. ein handoff_promised-Flag in
// data_collection_results (dieselbe Quelle wie extractTicketFields). Ein
// Anrufer, der alles in einem Atemzug sagt und auflegt, bekommt sonst kein
// Versprechen zu hören — sein Anliegen ginge trotz erfasster Nummer verloren.
function handoffPromisedFlag(convo) {
  const dc = (convo && convo.analysis && convo.analysis.data_collection_results) || {};
  const v = dc.handoff_promised;
  const s = (v && typeof v === 'object') ? v.value : v;
  return s === true || String(s == null ? '' : s).trim().toLowerCase() === 'true';
}
function hasContactCaptured(convo) {
  const dc = (convo && convo.analysis && convo.analysis.data_collection_results) || {};
  const params = abandonedToolParams((convo && convo.transcript) || []);
  const phone = (dcValue(dc, 'callback_phone') || params.phone || '').toString().trim();
  return phone.length > 0;
}

function detectLostHandoff(convo) {
  const t = (convo && convo.transcript) || [];
  // Erfolgreicher Tool-Call oder Vertriebsanruf -> nie ein verlorener Handoff.
  if (hasSuccessfulZgloszenie(t)) return { lost: false, reason: 'tool_succeeded' };
  if (isSalesCall(t)) return { lost: false, reason: 'sales_excluded' };
  // Verloren, sobald EIN Signal für Weiterleitungsbedarf vorliegt, aber kein
  // erfolgreicher create_zgloszenie-Tool-Call erfolgte (Reihenfolge = Stärke):
  if (hasHandoffPromise(t)) return { lost: true, reason: 'promise_without_tool' };
  if (handoffPromisedFlag(convo)) return { lost: true, reason: 'flag_without_tool' };
  if (hasContactCaptured(convo)) return { lost: true, reason: 'contact_without_tool' };
  if (isUrgent(t)) return { lost: true, reason: 'urgent_without_tool' };
  return { lost: false, reason: 'no_signal' };
}

function isQuotaFailure(convo) {
  const term = (convo && convo.metadata && convo.metadata.termination_reason) || '';
  return /quota|exceeded\s+quota|rate.?limit/i.test(term);
}

function dcValue(dc, key) {
  const v = dc && dc[key];
  if (v == null) return '';
  if (typeof v === 'object') return String(v.value || v.result || '').trim();
  return String(v).trim();
}

function abandonedToolParams(transcript) {
  for (const turn of (transcript || [])) {
    for (const c of ((turn && turn.tool_calls) || [])) {
      if (c && c.tool_name === 'create_zgloszenie' && c.params_as_json) {
        try { return JSON.parse(c.params_as_json); } catch (_) { /* ignore */ }
      }
    }
  }
  return {};
}

function extractTicketFields(convo) {
  const t = (convo && convo.transcript) || [];
  const ana = (convo && convo.analysis) || {};
  const dc = ana.data_collection_results || {};
  const params = abandonedToolParams(t);
  const name = (dcValue(dc, 'caller_name') || params.name || '').toString().trim();
  const phone = (dcValue(dc, 'callback_phone') || params.phone || '').toString().trim();
  const concern = (dcValue(dc, 'concern') || params.concern || ana.transcript_summary || '').toString().trim();
  const lang = ((convo && convo.metadata && convo.metadata.main_language) || params.lang || '').toString().toLowerCase().slice(0, 2);
  return { name, phone, concern, urgent: isUrgent(t) || !!params.urgent, lang };
}

module.exports = {
  detectLostHandoff, hasHandoffPromise, hasSuccessfulZgloszenie,
  handoffPromisedFlag, hasContactCaptured,
  isSalesCall, isUrgent, isQuotaFailure, extractTicketFields,
};

// ============================================================
// Netzwerk-Helfer (nicht exportiert — nur intern verwendet)
// ============================================================

async function elGet(path) {
  const res = await fetch(EL_BASE + path, { headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY } });
  if (!res.ok) throw new Error('ElevenLabs ' + res.status + ' für ' + path);
  return res.json();
}

async function listRecent(agentId, sinceUnix) {
  const out = []; let cursor = '';
  do {
    const q = `/conversations?agent_id=${agentId}&page_size=100` + (cursor ? `&cursor=${cursor}` : '');
    const d = await elGet(q);
    for (const c of (d.conversations || [])) {
      if ((c.start_time_unix_secs || 0) >= sinceUnix) out.push(c);
    }
    const more = d.has_more && d.next_cursor && (d.conversations || []).some(c => (c.start_time_unix_secs || 0) >= sinceUnix);
    cursor = more ? d.next_cursor : '';
  } while (cursor);
  return out;
}

async function postRecoveredTicket(fields, source, conversationId) {
  const callLink = 'https://elevenlabs.io/app/conversational-ai/history/' + conversationId;
  const url = process.env.ZGLOSZENIE_URL || 'https://www.pmk-berlin.de/.netlify/functions/zgloszenie';
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: fields.name, phone: fields.phone, concern: fields.concern,
      urgent: fields.urgent, lang: fields.lang,
      source: source, recovered: true, call_link: callLink, conversation_id: conversationId,
    }),
  });
  return res.ok;
}

async function sendQuotaAlert(count) {
  const user = process.env.IONOS_SMTP_USER, pass = process.env.IONOS_SMTP_PASS;
  const to = process.env.ZGLOSZENIE_ALERT_TO || process.env.ZGLOSZENIE_TO;
  if (!user || !pass || !to) return false;
  let nodemailer; try { nodemailer = require('nodemailer'); } catch (_) { return false; }
  const host = process.env.IONOS_SMTP_HOST || 'smtp.ionos.de';
  const port = parseInt(process.env.IONOS_SMTP_PORT || '465', 10);
  const transporter = nodemailer.createTransport({ host, port, secure: port === 465, auth: { user, pass } });
  await transporter.sendMail({
    from: 'PMK Watchdog <' + user + '>', to,
    subject: '⚠️ PMK-Chat: ' + count + ' Gespräch(e) durch Quota-Limit abgebrochen',
    text: 'Der Watchdog hat ' + count + ' Chat-Gespräch(e) gefunden, die wegen eines '
      + 'Quota-/Limit-Fehlers ohne Antwort endeten. Bitte das ElevenLabs-/LLM-Kontingent prüfen/anheben.',
  });
  return true;
}

// ============================================================
// Scheduled handler — läuft alle 15 Min auf Netlify
// ============================================================

module.exports.handler = async () => {
  if (!process.env.ELEVENLABS_API_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: 'ELEVENLABS_API_KEY fehlt' }) };
  }
  const dry = process.env.WATCHDOG_DRY_RUN === 'true';
  const lookbackH = parseInt(process.env.WATCHDOG_LOOKBACK_HOURS || '24', 10) || 24;
  const since = Math.floor(Date.now() / 1000) - lookbackH * 3600;

  let store = null;
  if (!dry) { const { getStore } = require('@netlify/blobs'); store = getStore('zgloszenie-watchdog'); }

  const result = { scanned: 0, recovered: 0, failed: 0, quota: 0, skipped: 0, errors: 0, pending: 0, dry, details: [] };
  for (const [agentId, source] of Object.entries(AGENTS)) {
    let list = [];
    try { list = await listRecent(agentId, since); }
    catch (e) { result.errors++; continue; }
    for (const c of list) {
      try {
        const id = c.conversation_id;
        const key = 'done:' + id;
        if (store && (await store.get(key))) { result.skipped++; continue; }
        const full = await elGet('/conversations/' + id);
        // Noch nicht fertig analysiert? -> zählen, nach 6h abschreiben.
        if (!full.analysis) {
          result.pending++;
          const sixHoursAgo = Math.floor(Date.now() / 1000) - 6 * 3600;
          if (store && (c.start_time_unix_secs || 0) < sixHoursAgo) await store.set(key, '1');
          continue;
        }
        result.scanned++;
        const det = detectLostHandoff(full);
        let markDone = true;
        if (det.lost) {
          const fields = extractTicketFields(full);
          // Degenerierter Fall: nichts extrahierbar -> trotzdem ein Ticket mit
          // Call-Link, damit der echte verlorene Handoff nicht stillschweigend
          // verschwindet. Pfarrei hört die Aufnahme ab.
          if (!fields.name && !fields.phone && !fields.concern) {
            fields.concern = '(brak danych w transkrypcji — proszę odsłuchać nagranie)';
          }
          const ok = dry ? true : await postRecoveredTicket(fields, source, id);
          if (ok) {
            result.recovered++;
            result.details.push({ id, source, action: 'recovered', name: fields.name, phone: fields.phone });
          } else {
            // POST fehlgeschlagen -> NICHT als done markieren, nächster Lauf versucht erneut
            result.failed++;
            markDone = false;
          }
        }
        if (isQuotaFailure(full)) result.quota++;
        if (store && markDone) await store.set(key, '1');
      } catch (e) { result.errors++; }
    }
  }
  if (result.quota > 0 && !dry) { try { await sendQuotaAlert(result.quota); } catch (_) { /* alert best-effort */ } }
  return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(result) };
};

module.exports.config = { schedule: '*/15 * * * *' };
