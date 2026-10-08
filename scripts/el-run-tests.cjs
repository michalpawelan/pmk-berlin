// Laeuft die an beiden PMK-Agenten haengenden ElevenLabs-Tests und wartet auf das Ergebnis.
// Nutzung: set -a && . ./.env && set +a && node scripts/el-run-tests.cjs
// Die Tests mocken alle Werkzeuge per tool_mock_overrides (seit 08.10.2026): es entsteht
// kein echtes Ticket und keine Mail an die Pfarrei. Nach jeder Prompt-Aenderung laufen lassen.
const KEY = process.env.ELEVENLABS_API_KEY;
const AG = { voice: ['agent_4101kpbhjmptftzr7tscfxk639fq', ['test_0201kvwstpb8f728yg7qam0206k4', 'test_8301kvwstp3qedq9n2awqysx31rg', 'test_5801kvwssgtbeg8tvmz1yvcj3wrj']],
             chat: ['agent_9501kteh8ecmek7asfq0k7zvraqw', ['test_2701kvwstpmyfxtv4w3321vbaqrr', 'test_4001kvwstpw3eqprgtstgnq1pebx']] };
const api = async (m, p, b) => { const r = await fetch('https://api.elevenlabs.io/v1' + p, { method: m, headers: { 'xi-api-key': KEY, 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }); return r.json(); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const runs = {};
  for (const [k, [agent, tests]] of Object.entries(AG)) runs[k] = await api('POST', `/convai/agents/${agent}/run-tests`, { tests: tests.map(test_id => ({ test_id })) });
  for (const [k, inv] of Object.entries(runs)) {
    let d;
    for (let i = 0; i < 60; i++) {
      d = await api('GET', '/convai/test-invocations/' + inv.id);
      if ((d.test_runs || []).every(r => !['pending', 'running'].includes(r.status))) break;
      await sleep(5000);
    }
    for (const r of d.test_runs || []) {
      const res = r.condition_result || {};
      console.log(`${k.padEnd(5)} ${String(r.status).padEnd(8)} ${r.test_name || r.test_id}${r.status === 'passed' ? '' : '\n        -> ' + String(res.rationale && (res.rationale.summary || JSON.stringify(res.rationale)) || '').slice(0, 600)}`);
    }
  }
})();
