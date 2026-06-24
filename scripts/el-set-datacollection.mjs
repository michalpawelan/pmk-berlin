// Setzt die data-collection-Felder beider PMK-Agenten, die der Watchdog für
// Recovery-Tickets liest. Idempotent: liest erst den Ist-Stand, merged, patcht,
// verifiziert. Nur diese Felder; restliche Config bleibt unberührt.
// Run: ELEVENLABS_API_KEY=... node scripts/el-set-datacollection.mjs
import fs from 'node:fs';

const KEY = process.env.ELEVENLABS_API_KEY
  || (fs.readFileSync('.env', 'utf8').split('\n').find(l => l.startsWith('ELEVENLABS_API_KEY=')) || '').split('=')[1]?.trim();
if (!KEY) { console.error('ELEVENLABS_API_KEY fehlt'); process.exit(1); }

const AGENTS = ['agent_4101kpbhjmptftzr7tscfxk639fq', 'agent_9501kteh8ecmek7asfq0k7zvraqw'];
const FIELDS = {
  caller_name:     { type: 'string',  description: 'Vor- und ggf. Nachname des Anrufers/Schreibers, falls genannt. Sonst leer.' },
  callback_phone:  { type: 'string',  description: 'Die diktierte Rückrufnummer des Anrufers (nicht die Leitung, von der angerufen wird). Sonst leer.' },
  concern:         { type: 'string',  description: 'Kurze Beschreibung des Anliegens in einem Satz.' },
  handoff_promised:{ type: 'boolean', description: 'True, wenn die Assistentin zugesagt hat, das Anliegen weiterzuleiten oder einen Rückruf zu veranlassen.' },
};

async function el(method, path, body) {
  const res = await fetch('https://api.elevenlabs.io/v1/convai' + path, {
    method, headers: { 'xi-api-key': KEY, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(method + ' ' + path + ' -> ' + res.status + ' ' + (await res.text()).slice(0, 300));
  return res.json();
}

for (const id of AGENTS) {
  const before = await el('GET', '/agents/' + id);
  const cur = (before.platform_settings && before.platform_settings.data_collection) || {};
  const merged = { ...cur, ...FIELDS };
  await el('PATCH', '/agents/' + id, { platform_settings: { data_collection: merged } });
  const after = await el('GET', '/agents/' + id);
  const got = Object.keys((after.platform_settings && after.platform_settings.data_collection) || {});
  const ok = Object.keys(FIELDS).every(k => got.includes(k));
  console.log(`${ok ? 'OK ' : 'FAIL'} ${id} data_collection: ${got.join(', ')}`);
  if (!ok) process.exit(1);
}
console.log('Fertig — data-collection-Felder gesetzt.');
