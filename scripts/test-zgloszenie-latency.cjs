// Regression test: create_zgloszenie must answer the agent quickly once the
// parish has been notified by mail. Run: node scripts/test-zgloszenie-latency.cjs
//
// Audit 08.10.2026: 8 von 45 Telefon-Weiterleitungen endeten fuer den Agenten
// als Fehler — 5x {"error":"upstream_parse"} nach 15–18 s und 2x ElevenLabs-
// Timeout nach 20 s. Ursache: die Function wartete ohne Zeitlimit auf das
// Google Apps Script (Sheet-Zeile), obwohl die Mail an die Pfarrei — der
// eigentliche Meldeweg — laengst raus war. Der Agent sagte dann "hat nicht
// geklappt" oder versprach einen zweiten Versuch, den er nie machte.
//
// Apps Script (fetch) und SMTP (nodemailer) sind hier gestubbt; nichts geht raus.

process.env.IONOS_SMTP_USER = 'test@example.invalid';
process.env.IONOS_SMTP_PASS = 'x';
process.env.ZGLOSZENIE_SHEET_BUDGET_MS = '300';   // Mail ist raus -> kurz aufs Sheet warten
process.env.ZGLOSZENIE_SHEET_HARD_MS = '1200';    // Mail NICHT raus -> laenger warten, aber begrenzt
process.env.ZGLOSZENIE_SMTP_BUDGET_MS = '400';
delete process.env.ZGLOSZENIE_SECRET;

const delay = ms => new Promise(r => setTimeout(r, ms));
const stub = { mailDelay: 30, mailFails: false, gasDelay: 30, gasBody: '{"success":true,"id":"x"}' };

const nmPath = require.resolve('nodemailer');
require.cache[nmPath] = { id: nmPath, filename: nmPath, loaded: true, exports: {
  createTransport: () => ({ sendMail: async () => {
    await delay(stub.mailDelay);
    if (stub.mailFails) throw new Error('smtp down');
    return { messageId: 'stub' };
  } }),
} };
global.fetch = async () => {
  await delay(stub.gasDelay);
  return { ok: true, status: 200, text: async () => stub.gasBody };
};

const { handler } = require('../netlify/functions/zgloszenie.js');
const event = () => ({
  httpMethod: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ concern: 'pogrzeb — prośba o kontakt', phone: '', caller_id: '+49307524080', urgent: true, lang: 'pl' }),
});

let fail = 0;
async function run(label, setup, check) {
  Object.assign(stub, { mailDelay: 30, mailFails: false, gasDelay: 30, gasBody: '{"success":true,"id":"x"}' }, setup);
  const t0 = Date.now();
  const res = await handler(event());
  const ms = Date.now() - t0;
  const body = JSON.parse(res.body);
  const ok = check(res, body, ms);
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}  (${ms} ms, ${res.statusCode}, success=${body.success}, sheet=${body.sheet})`);
}

(async () => {
  await run('Sheet schnell + Mail raus -> Erfolg, Sheet ok',
    {}, (r, b) => r.statusCode === 200 && b.success === true && b.sheet === 'ok');

  await run('Sheet haengt + Mail raus -> Erfolg innerhalb des kurzen Budgets',
    { gasDelay: 3000 }, (r, b, ms) => r.statusCode === 200 && b.success === true && ms < 900);

  await run('Sheet liefert HTML statt JSON + Mail raus -> trotzdem Erfolg (Pfarrei ist benachrichtigt)',
    { gasBody: '<html><body>Service invoked too many times</body></html>' },
    (r, b) => r.statusCode === 200 && b.success === true && b.sheet === 'upstream_parse');

  await run('Erfolg ohne Sheet behaelt die Nummern-Logik (phone_usable=false -> next_action)',
    { gasDelay: 3000 }, (r, b) => b.phone_usable === false && typeof b.next_action === 'string');

  await run('Sheet ok, Mail scheitert -> Erfolg (Ticket steht im Sheet)',
    { mailFails: true }, (r, b) => r.statusCode === 200 && b.success === true && b.sheet === 'ok');

  await run('Sheet liefert HTML + Mail scheitert -> Fehler (niemand benachrichtigt)',
    { gasBody: '<html>error</html>', mailFails: true }, (r, b) => r.statusCode === 502 && b.success === false);

  await run('Sheet haengt + Mail scheitert -> Fehler, aber innerhalb des harten Limits statt 20 s',
    { gasDelay: 4000, mailFails: true }, (r, b, ms) => r.statusCode === 502 && b.success === false && ms < 1800);

  console.log(`\n${fail ? fail + ' FEHLER' : 'alle Tests gruen'}`);
  process.exit(fail ? 1 : 0);
})();
