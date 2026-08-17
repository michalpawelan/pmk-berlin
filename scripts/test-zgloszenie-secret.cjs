// Regression test for the shared-secret gate in netlify/functions/zgloszenie.js
// Run: node scripts/test-zgloszenie-secret.cjs
//
// An diesem Endpoint haengt die Notfall-Eskalation (Beerdigung, Krankensalbung).
// Die Pruefung MUSS deshalb env-gated sein: ohne gesetztes ZGLOSZENIE_SECRET
// bleibt der Endpoint offen wie bisher. Ein Tippfehler in der Netlify-Config
// darf niemals dazu fuehren, dass ein Anliegen still verschwindet.
//
// Aufrufer sind nur Server (ElevenLabs-Tool create_zgloszenie + Watchdog),
// nie der Browser — deshalb ist ein Shared Secret hier ueberhaupt moeglich.

const path = require('path');
const modPath = path.join(__dirname, '..', 'netlify', 'functions', 'zgloszenie.js');

let fail = 0;
function check(label, got, expected) {
  const ok = got === expected;
  if (!ok) fail++;
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + label + (ok ? '' : `\n        got: ${got}  expected: ${expected}`));
}

// Modul mit frischem Env laden (das Secret wird beim Laden eingelesen).
function load(secret) {
  delete require.cache[require.resolve(modPath)];
  if (secret === null) delete process.env.ZGLOSZENIE_SECRET;
  else process.env.ZGLOSZENIE_SECRET = secret;
  return require(modPath);
}

const ev = (headers) => ({ headers });

console.log('\n--- ohne konfiguriertes Secret: Endpoint bleibt offen ---');
let m = load(null);
check('kein Header -> durchlassen', m.secretOk(ev({})), true);
check('irgendein Header -> durchlassen', m.secretOk(ev({ 'x-zgloszenie-secret': 'egal' })), true);

console.log('\n--- mit Secret: nur der richtige Aufrufer kommt durch ---');
m = load('geheim-123');
check('richtiger X-Zgloszenie-Secret', m.secretOk(ev({ 'x-zgloszenie-secret': 'geheim-123' })), true);
check('richtiger Bearer-Token', m.secretOk(ev({ authorization: 'Bearer geheim-123' })), true);
check('Bearer klein geschrieben', m.secretOk(ev({ authorization: 'bearer geheim-123' })), true);

check('gar kein Header -> raus', m.secretOk(ev({})), false);
check('falsches Secret -> raus', m.secretOk(ev({ 'x-zgloszenie-secret': 'falsch' })), false);
check('leerer Header -> raus', m.secretOk(ev({ 'x-zgloszenie-secret': '' })), false);
check('falscher Bearer -> raus', m.secretOk(ev({ authorization: 'Bearer falsch' })), false);
check('Secret als Praefix -> raus', m.secretOk(ev({ 'x-zgloszenie-secret': 'geheim-1' })), false);
check('Secret mit Anhang -> raus', m.secretOk(ev({ 'x-zgloszenie-secret': 'geheim-123x' })), false);

console.log('\n' + (fail === 0 ? 'alle Tests gruen' : fail + ' Test(s) rot'));
process.exit(fail === 0 ? 0 : 1);
