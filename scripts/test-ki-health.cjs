// Regression test for the KI health checks in netlify/functions/ki-health.js
// Run: node scripts/test-ki-health.cjs
//
// Hintergrund (Audit 20.08.2026): Der Rueckruf-Ausfall lief 17 Tage unbemerkt,
// weil JEDES vorhandene Signal gruen blieb — Ticket angelegt, Mail raus,
// success:true, und ElevenLabs' eigenes Kriterium "rueckrufnummer" lief sogar
// in die falsche Richtung (29 % Fehler vorher, 22 % nachher). Auch
// scripts/voice-review.py haette nichts gezeigt: es misst Dauer, Latenz,
// Unterbrechungen und die EL-Bewertungen, nicht das Ergebnis.
//
// Diese Checks messen deshalb das ERGEBNIS, nicht das Gespraech.
const h = require('../netlify/functions/ki-health.js');

let fail = 0;
function check(label, cond, detail) {
  if (!cond) { fail++; console.log(`FAIL  ${label}`); if (detail !== undefined) console.log(`      ${JSON.stringify(detail)}`); }
  else console.log(`PASS  ${label}`);
}

// ---------------------------------------------------------------- Caller-ID
// Signatur des Ausfalls vom 03.08.: ab 16:06 kam bei 52 aufeinanderfolgenden
// Anrufen dieselbe Nummer an. Das ist bei echten Anrufern praktisch unmoeglich.
const run = (id, n) => Array.from({ length: n }, (_, i) => ({ ts: 1000 + i, callerId: id }));
check('Caller-ID: 5x dieselbe Nummer -> Alarm',
  h.detectStuckCallerId(run('+49307524080', 5)).alert === true);
check('Caller-ID: 4x dieselbe Nummer -> noch kein Alarm (zu wenig Evidenz)',
  h.detectStuckCallerId(run('+49307524080', 4)).alert === false);
check('Caller-ID: gemischte echte Nummern -> kein Alarm',
  h.detectStuckCallerId([
    { ts: 1, callerId: '+491701111111' }, { ts: 2, callerId: '+491702222222' },
    { ts: 3, callerId: '+491703333333' }, { ts: 4, callerId: '+491704444444' },
    { ts: 5, callerId: '+491705555555' }, { ts: 6, callerId: '+491706666666' },
  ]).alert === false);
check('Caller-ID: nur die JUENGSTEN zaehlen — alte Gleichlaeufe stoeren nicht',
  h.detectStuckCallerId([
    ...run('+49307524080', 6).map((r, i) => ({ ...r, ts: i })),
    { ts: 100, callerId: '+491701111111' },
  ]).alert === false);
check('Caller-ID: leere/unbekannte Nummern loesen keinen Alarm aus',
  h.detectStuckCallerId([
    { ts: 1, callerId: '' }, { ts: 2, callerId: null }, { ts: 3, callerId: '' },
    { ts: 4, callerId: '' }, { ts: 5, callerId: null }, { ts: 6, callerId: '' },
  ]).alert === false);
check('Caller-ID: Alarm nennt die Nummer und die Laenge',
  (() => { const r = h.detectStuckCallerId(run('+49307524080', 7));
    return r.callerId === '+49307524080' && r.run >= 5; })(),
  h.detectStuckCallerId(run('+49307524080', 7)));

// ------------------------------------------------------------ Rueckrufbarkeit
const tick = (usable) => ({ ok: true, phoneUsable: usable });
check('Rueckrufbarkeit: 0 von 7 erreichbar -> Alarm (der reale Fall)',
  h.checkReachability([{ escalations: Array.from({ length: 7 }, () => tick(false)) }]).alert === true);
check('Rueckrufbarkeit: 9 von 9 erreichbar -> kein Alarm (Zustand vor dem 03.08.)',
  h.checkReachability([{ escalations: Array.from({ length: 9 }, () => tick(true)) }]).alert === false);
check('Rueckrufbarkeit: unter 3 Tickets -> kein Alarm (zu duenne Datenlage)',
  h.checkReachability([{ escalations: [tick(false), tick(false)] }]).alert === false);
check('Rueckrufbarkeit: gescheiterte Tool-Aufrufe zaehlen nicht als Ticket',
  h.checkReachability([{ escalations: [{ ok: false, phoneUsable: null }, tick(true), tick(true), tick(true)] }]).tickets === 3);

// --------------------------------------------------------------- Tool-Fehler
check('Tool-Fehler: 6 von 22 -> Alarm (realer Wert 27 %)',
  h.checkToolErrors([{ escalations: [
    ...Array.from({ length: 16 }, () => ({ ok: true, phoneUsable: true })),
    ...Array.from({ length: 6 }, () => ({ ok: false, phoneUsable: null })),
  ] }]).alert === true);
check('Tool-Fehler: 1 von 20 -> kein Alarm',
  h.checkToolErrors([{ escalations: [
    ...Array.from({ length: 19 }, () => ({ ok: true, phoneUsable: true })),
    { ok: false, phoneUsable: null },
  ] }]).alert === false);

// -------------------------------------------------------------------- Quota
// 20.08.: 767.866 / 917.858 bei Reset am 07.09. und ~155k/Tag Verbrauch.
check('Quota: Hochrechnung reicht nicht bis zum Reset -> Alarm',
  h.checkQuota({ used: 767866, limit: 917858, daysToReset: 18, perDay: 155000 }).alert === true);
check('Quota: entspannter Verbrauch -> kein Alarm',
  h.checkQuota({ used: 200000, limit: 917858, daysToReset: 18, perDay: 9000 }).alert === false);
check('Quota: knapp am Limit -> Alarm auch ohne Verbrauchsschaetzung',
  h.checkQuota({ used: 900000, limit: 917858, daysToReset: 18, perDay: 0 }).alert === true);
check('Quota: Restreichweite in Tagen wird gemeldet',
  typeof h.checkQuota({ used: 767866, limit: 917858, daysToReset: 18, perDay: 155000 }).daysLeft === 'number');
// Unter zwei Tagen Reichweite aendert sich der Name und damit die Signatur —
// sonst faende die Unterdrueckung genau die kritische Verschaerfung nicht.
check('Quota: unter 2 Tagen Reichweite -> als akut gekennzeichnet',
  /akut/.test(h.checkQuota({ used: 1853581, limit: 2069372, daysToReset: 17, perDay: 175000 }).name));
check('Quota: mehrere Tage Reichweite -> nicht als akut gekennzeichnet',
  !/akut/.test(h.checkQuota({ used: 500000, limit: 2069372, daysToReset: 17, perDay: 175000 }).name));
check('Quota: Verschaerfung erzeugt eine NEUE Signatur (also eine neue Mail)',
  h.signatureOf([h.checkQuota({ used: 500000, limit: 2069372, daysToReset: 17, perDay: 175000 })])
  !== h.signatureOf([h.checkQuota({ used: 1853581, limit: 2069372, daysToReset: 17, perDay: 175000 })]));

// ------------------------------------------------------------------ Bericht
const report = h.buildReport([
  h.detectStuckCallerId(run('+49307524080', 6)),
  h.checkReachability([{ escalations: Array.from({ length: 7 }, () => tick(false)) }]),
]);
check('Bericht: Betreff kennzeichnet den Alarm', /PMK/.test(report.subject) && report.alert === true);
check('Bericht: Nummer taucht im Text auf', report.body.includes('+49307524080'), report.body.slice(0, 200));
check('Bericht ohne Befunde -> alert=false, keine Mail noetig',
  h.buildReport([{ alert: false, name: 'x', summary: 'ok' }]).alert === false);

// ------------------------------------------------------------ Zustellregeln
// Ein bekanntes, andauerndes Problem darf nicht jeden Tag mailen — sonst wird
// der Waechter zu dem, was im Audit am Watchdog kritisiert wurde (18 Zeilen
// fuer 5 Anrufer). Gemeldet wird: Neues, Veraendertes, Behobenes, und einmal
// pro Woche eine Erinnerung, damit nichts stillschweigend liegen bleibt.
const DAY = 86400;
const d = (sig, extra) => Object.assign({ signature: sig, lastSent: 0 }, extra);
check('Zustellung: erster Befund -> senden',
  h.decideDelivery({ signature: 'A', prev: null, now: 100 * DAY }).send === true);
check('Zustellung: derselbe Befund am naechsten Tag -> unterdruecken',
  h.decideDelivery({ signature: 'A', prev: d('A', { lastSent: 100 * DAY }), now: 101 * DAY }).send === false);
check('Zustellung: neuer Befund kommt dazu -> senden',
  h.decideDelivery({ signature: 'A|B', prev: d('A', { lastSent: 100 * DAY }), now: 101 * DAY }).send === true);
check('Zustellung: nach 7 Tagen Erinnerung -> senden',
  h.decideDelivery({ signature: 'A', prev: d('A', { lastSent: 100 * DAY }), now: 107 * DAY }).send === true);
check('Zustellung: Problem behoben -> einmal Entwarnung',
  (() => { const r = h.decideDelivery({ signature: '', prev: d('A', { lastSent: 100 * DAY }), now: 101 * DAY });
    return r.send === true && r.reason === 'resolved'; })());
check('Zustellung: dauerhaft sauber -> keine Post',
  h.decideDelivery({ signature: '', prev: d('', { lastSent: 100 * DAY }), now: 101 * DAY }).send === false);
check('Zustellung: Signatur ist reihenfolgeunabhaengig',
  h.signatureOf([{ name: 'B', alert: true }, { name: 'A', alert: true }])
  === h.signatureOf([{ name: 'A', alert: true }, { name: 'B', alert: true }]));
check('Zustellung: nicht alarmierende Pruefungen stehen nicht in der Signatur',
  h.signatureOf([{ name: 'A', alert: true }, { name: 'C', alert: false }]) === h.signatureOf([{ name: 'A', alert: true }]));

// -------------------------------------------------------------- Verdrahtung
// module.exports wird in ki-health.js ersetzt; wird der Handler danach an
// `exports` statt an `module.exports` gehaengt, findet Netlify ihn nicht und
// die Function ist stumm — der Waechter waere selbst der blinde Fleck.
check('Handler ist exportiert (sonst findet Netlify ihn nicht)', typeof h.handler === 'function');
check('Zeitplan ist exportiert', h.config && typeof h.config.schedule === 'string');

console.log(`\n${fail === 0 ? 'alle Tests gruen' : fail + ' FEHLER'}`);
process.exit(fail ? 1 : 0);
