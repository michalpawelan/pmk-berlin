// PMK Berlin — Rechts-Compliance beider ElevenLabs-Agenten.
//
// Setzt drei Dinge, die rechtlich zusammengehoeren:
//   1. Prompt aus dem Repo (Source of Truth) -> Agent. Enthaelt die offene
//      KI-Kennzeichnung und den Umgang mit Aufzeichnungs-Widerspruch.
//   2. first_message inkl. aller Sprach-Presets: KI-Hinweis (EU AI Act Art. 50,
//      anwendbar ab 02.08.2026) und Aufzeichnungs-Hinweis (§ 201 StGB,
//      Art. 13 DSGVO). Die Ansage laeuft VOR dem ersten Wort des Anrufers.
//   3. Speicherbegrenzung (Art. 5 Abs. 1 lit. e DSGVO): retention_days statt -1.
//
// Idempotent: liest den Ist-Stand, merged, patcht, verifiziert.
// apply_to_existing_conversations bleibt bewusst false — bestehende Aufnahmen
// werden NICHT angefasst; ueber deren Loeschung entscheidet die Pfarrei separat.
//
// Run: node scripts/el-set-legal-disclosure.mjs [--dry]
import fs from 'node:fs';

const KEY = process.env.ELEVENLABS_API_KEY
  || (fs.readFileSync('.env', 'utf8').split('\n').find(l => l.startsWith('ELEVENLABS_API_KEY=')) || '').split('=')[1]?.trim();
if (!KEY) { console.error('ELEVENLABS_API_KEY fehlt'); process.exit(1); }

const DRY = process.argv.includes('--dry');

// Aufbewahrung in Tagen. Die operativen Daten (Tickets) liegen ohnehin in der
// Google-Tabelle der Pfarrei — ElevenLabs braucht nur ein QS-Fenster.
const RETENTION_DAYS = 90;

const AGENTS = [
  {
    id: 'agent_4101kpbhjmptftzr7tscfxk639fq',
    label: 'Voice (Telefon)',
    promptFile: 'elevenlabs-agent-prompt.md',
    // Kurz halten: jede zusaetzliche Silbe verzoegert die Antwort hoerbar.
    firstMessages: {
      pl: 'Polska Misja Katolicka, tu Marta, asystentka cyfrowa. Rozmowa jest nagrywana. W czym mogę pomóc?',
      de: 'Grüß Gott! Polska Misja Katolicka, hier ist Marta, die digitale Assistentin. Das Gespräch wird aufgezeichnet. Wie kann ich helfen?',
      en: 'Hello! Polska Misja Katolicka, this is Marta, the digital assistant. This call is recorded. How can I help?',
    },
  },
  {
    id: 'agent_9501kteh8ecmek7asfq0k7zvraqw',
    label: 'Chat (Website)',
    promptFile: 'elevenlabs-agent-prompt-chat.md',
    // Der Chat rendert seine eigene Begruessung im Widget (js/pmk-chat.js);
    // die KI-Kennzeichnung sitzt dort. Hier nichts ueberschreiben.
    firstMessages: null,
  },
];

const PRIVACY = {
  retention_days: RETENTION_DAYS,
  delete_audio: true,
  delete_transcript_and_pii: true,
  apply_to_existing_conversations: false,
};

async function el(method, path, body) {
  const res = await fetch('https://api.elevenlabs.io/v1/convai' + path, {
    method,
    headers: { 'xi-api-key': KEY, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${(await res.text()).slice(0, 400)}`);
  return res.json();
}

let failed = false;

for (const a of AGENTS) {
  console.log(`\n=== ${a.label} — ${a.id} ===`);
  const before = await el('GET', '/agents/' + a.id);

  const patch = { conversation_config: {}, platform_settings: {} };

  // --- 1. Prompt ---------------------------------------------------------
  const repoPrompt = fs.readFileSync(a.promptFile, 'utf8').replace(/\s+$/, '');
  const livePrompt = (before.conversation_config?.agent?.prompt?.prompt || '').replace(/\s+$/, '');
  const promptChanged = repoPrompt !== livePrompt;
  if (promptChanged) {
    // Die API liefert beim GET sowohl `tools` (deprecated) als auch `tool_ids`,
    // lehnt beim PATCH aber genau diese Kombination ab. `tools` muss also raus —
    // die Werkzeuge haengen ohnehin an `tool_ids`.
    const promptObj = { ...(before.conversation_config?.agent?.prompt || {}), prompt: repoPrompt };
    if (promptObj.tool_ids) delete promptObj.tools;
    patch.conversation_config.agent = {
      ...(patch.conversation_config.agent || {}),
      prompt: promptObj,
    };
  }
  console.log(`prompt:        ${promptChanged ? 'wird aktualisiert' : 'unveraendert'} (${a.promptFile})`);

  // --- 2. first_message + Sprach-Presets ---------------------------------
  if (a.firstMessages) {
    const base = before.conversation_config?.agent?.language || 'pl';
    patch.conversation_config.agent = {
      ...(patch.conversation_config.agent || {}),
      first_message: a.firstMessages[base],
    };
    console.log(`first_message: ${a.firstMessages[base]}`);

    // Presets deep-merged, damit soft_timeout & Co. erhalten bleiben.
    const presets = JSON.parse(JSON.stringify(before.conversation_config?.language_presets || {}));
    for (const [lang, text] of Object.entries(a.firstMessages)) {
      if (lang === base) continue;
      if (!presets[lang]) continue; // kein Preset vorhanden -> nicht neu erfinden
      presets[lang].overrides = presets[lang].overrides || {};
      presets[lang].overrides.agent = { ...(presets[lang].overrides.agent || {}), first_message: text };
      console.log(`  preset ${lang}:    ${text}`);
    }
    patch.conversation_config.language_presets = presets;

    const missing = Object.keys(a.firstMessages).filter(l => l !== base && !presets[l]);
    if (missing.length) console.log(`  HINWEIS: kein Sprach-Preset fuer: ${missing.join(', ')}`);
  }

  // --- 3. Aufbewahrung ---------------------------------------------------
  const curPriv = before.platform_settings?.privacy || {};
  patch.platform_settings.privacy = { ...curPriv, ...PRIVACY };
  console.log(`privacy:       retention ${curPriv.retention_days} -> ${RETENTION_DAYS} Tage, ` +
    `delete_audio ${curPriv.delete_audio} -> true, delete_transcript_and_pii ${curPriv.delete_transcript_and_pii} -> true, ` +
    `apply_to_existing ${PRIVACY.apply_to_existing_conversations} (Altbestand bleibt unangetastet)`);

  if (DRY) { console.log('-- dry run, nichts gepatcht --'); continue; }

  await el('PATCH', '/agents/' + a.id, patch);

  // --- Verifikation ------------------------------------------------------
  const after = await el('GET', '/agents/' + a.id);
  const checks = [];
  checks.push(['prompt', (after.conversation_config?.agent?.prompt?.prompt || '').replace(/\s+$/, '') === repoPrompt]);
  const p = after.platform_settings?.privacy || {};
  checks.push(['retention_days', p.retention_days === RETENTION_DAYS]);
  checks.push(['delete_audio', p.delete_audio === true]);
  checks.push(['delete_transcript_and_pii', p.delete_transcript_and_pii === true]);
  if (a.firstMessages) {
    const base = after.conversation_config?.agent?.language || 'pl';
    checks.push(['first_message', after.conversation_config?.agent?.first_message === a.firstMessages[base]]);
    for (const [lang, text] of Object.entries(a.firstMessages)) {
      if (lang === base) continue;
      const got = after.conversation_config?.language_presets?.[lang]?.overrides?.agent?.first_message;
      if (got !== undefined) checks.push([`preset ${lang}`, got === text]);
    }
  }
  for (const [name, ok] of checks) {
    console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${name}`);
    if (!ok) failed = true;
  }
}

console.log(failed ? '\nFEHLGESCHLAGEN — bitte pruefen.' : '\nFertig — beide Agenten sind auf dem neuen Stand.');
process.exit(failed ? 1 : 0);
