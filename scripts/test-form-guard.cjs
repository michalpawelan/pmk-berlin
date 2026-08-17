// Regression test for the public-form spam guard in netlify/functions/_form-guard.js
// Run: node scripts/test-form-guard.cjs
//
// Hintergrund (17.08.2026): Ein Bot hat ~100 Fake-Spendermeldungen durch
// /.netlify/functions/spende-danke geschickt (Faker-Namen wie "Alda Kilback",
// erfundene US-Nummern). Der Honeypot greift dabei nicht, weil der Bot direkt
// auf die Function-URL postet und das versteckte Feld nie sieht.
// Gefahr war nicht das volle Postfach, sondern die Danke-Mail: sie ging von
// admin@pmk-berlin.de an eine vom Bot frei gewaehlte Fremdadresse (Backscatter
// -> Sperre/Blacklisting der IONOS-Absenderadresse).
//
// Der Guard prueft drei Dinge, dieser Test deckt die reinen Funktionen ab:
//   1) Origin/Referer muss zur eigenen Seite gehoeren
//   2) signiertes, kurzlebiges Einmal-Token (Zeitschloss: min. Ausfuellzeit)
//   3) Rate-Limit pro IP (Blobs, hier nicht getestet — braucht Netzwerk)

process.env.FORM_TOKEN_SECRET = 'test-secret-nur-fuer-den-test';

const g = require('../netlify/functions/_form-guard.js');

let fail = 0;
function check(label, got, expected) {
  const ok = got === expected;
  if (!ok) fail++;
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + label + (ok ? '' : `\n        got: ${got}\n        expected: ${expected}`));
}

const ev = (headers) => ({ headers });

// ---------------------------------------------------------------- Origin
console.log('\n--- originOk ---');
check('Origin = eigene Domain (www)', g.originOk(ev({ origin: 'https://www.pmk-berlin.de' })), true);
check('Origin = eigene Domain (apex)', g.originOk(ev({ origin: 'https://pmk-berlin.de' })), true);
check('Origin = Netlify-Staging', g.originOk(ev({ origin: 'https://pmk-berlinpl.netlify.app' })), true);
check('Origin = Netlify-Draft-Deploy', g.originOk(ev({ origin: 'https://68a1f--pmk-berlinpl.netlify.app' })), true);
check('Origin = localhost (netlify dev)', g.originOk(ev({ origin: 'http://localhost:8888' })), true);
check('Referer als Fallback (Origin fehlt)', g.originOk(ev({ referer: 'https://www.pmk-berlin.de/wesprzyj' })), true);

check('Bot: gar kein Origin/Referer -> raus', g.originOk(ev({})), false);
check('Bot: fremde Domain -> raus', g.originOk(ev({ origin: 'https://evil.example.com' })), false);
check('Bot: Suffix-Trick pmk-berlin.de.evil.com -> raus', g.originOk(ev({ origin: 'https://pmk-berlin.de.evil.com' })), false);
check('Bot: Praefix-Trick notpmk-berlin.de -> raus', g.originOk(ev({ origin: 'https://notpmk-berlin.de' })), false);
check('Bot: fremdes netlify.app -> raus', g.originOk(ev({ origin: 'https://boese-seite.netlify.app' })), false);
check('Bot: Muell im Origin -> raus', g.originOk(ev({ origin: 'nicht-mal-eine-url' })), false);
check('Bot: leerer Origin-String -> raus', g.originOk(ev({ origin: '' })), false);

// ------------------------------------------------------------------ Token
console.log('\n--- issueToken / verifyToken ---');
const NOW = 1_755_000_000_000;              // fixer Zeitpunkt, damit der Test stabil ist
const fresh = g.issueToken(NOW);

check('frisches Token, nach 5 s abgeschickt', g.verifyToken(fresh, NOW + 5000).ok, true);
check('Token nach 20 min noch gueltig', g.verifyToken(fresh, NOW + 20 * 60 * 1000).ok, true);

check('Bot: sofort abgeschickt (< 2 s) -> too_fast', g.verifyToken(fresh, NOW + 300).error, 'too_fast');
check('Bot: Token aelter als 2 h -> expired', g.verifyToken(fresh, NOW + 3 * 60 * 60 * 1000).error, 'token_expired');
check('Bot: gar kein Token -> bad_token', g.verifyToken('', NOW + 5000).error, 'bad_token');
check('Bot: Fantasie-Token -> bad_token', g.verifyToken('irgendwas', NOW + 5000).error, 'bad_token');

// Signatur faelschen: Zeitstempel vorspulen, Rest behalten
const [v, ts, nonce, sig] = fresh.split('.');
check('Bot: Zeitstempel manipuliert -> bad_token',
  g.verifyToken([v, String(Number(ts) + 60000), nonce, sig].join('.'), NOW + 65000).error, 'bad_token');
check('Bot: Signatur manipuliert -> bad_token',
  g.verifyToken([v, ts, nonce, 'AAAA' + sig.slice(4)].join('.'), NOW + 5000).error, 'bad_token');
check('Bot: fremdes Secret -> bad_token', (() => {
  const other = g._signWith('anderes-secret', ts + '.' + nonce);
  return g.verifyToken([v, ts, nonce, other].join('.'), NOW + 5000).error;
})(), 'bad_token');

// Kein Secret gesetzt -> Guard darf die Formulare NICHT abwuergen (sanfter Ausfall)
console.log('\n--- Degradieren ohne FORM_TOKEN_SECRET ---');
check('ohne Secret: verify laesst durch', g.verifyToken('', NOW, { secret: '' }).ok, true);
check('ohne Secret: als degraded markiert', g.verifyToken('', NOW, { secret: '' }).degraded, true);

// --------------------------------------------------------------- clientIp
console.log('\n--- clientIp ---');
check('Netlify-Header bevorzugt', g.clientIp(ev({ 'x-nf-client-connection-ip': '1.2.3.4', 'x-forwarded-for': '9.9.9.9' })), '1.2.3.4');
check('x-forwarded-for: erste IP', g.clientIp(ev({ 'x-forwarded-for': '5.6.7.8, 10.0.0.1' })), '5.6.7.8');
check('nichts da -> unknown', g.clientIp(ev({})), 'unknown');

console.log('\n' + (fail === 0 ? 'alle Tests gruen' : fail + ' Test(s) rot'));
process.exit(fail === 0 ? 0 : 1);
