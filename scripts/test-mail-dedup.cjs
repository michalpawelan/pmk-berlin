// Regression test for the per-conversation mail de-duplication in
// netlify/functions/zgloszenie.js. Run: node scripts/test-mail-dedup.cjs
//
// Hintergrund (Nachkontrolle 28.08.2026): Der Agent ruft create_zgloszenie
// mehrfach im selben Gespraech — fire-first ohne Nummer, danach nochmal mit
// der diktierten Nummer. Jeder Aufruf schrieb eine Sheet-Zeile UND schickte
// eine Mail. Ergebnis in echt: sieben Mails fuer eine QR-Code-Beschwerde am
// 04.08., vier fuer "Krystian" am 21.08. Das ist genau die Alarmmuedigkeit,
// die das Ticket-Postfach unbrauchbar macht.
//
// Regel: erste Meldung immer, Wiederholung nur wenn eine Rueckrufnummer
// dazugekommen ist (das ist die Information, auf die die Pfarrei wartet).
// Ohne Zustandsspeicher wird IMMER gemailt — lieber eine zu viel als eine
// verlorene Eskalation.
const { shouldSendMail } = require('../netlify/functions/zgloszenie.js');

let fail = 0;
const check = (label, got, want) => {
  const ok = got.send === want;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  (send=${got.send}, erwartet ${want}, reason=${got.reason})`}`);
};

check('erste Meldung im Gespraech -> mailen',
  shouldSendMail(null, false), true);
check('erste Meldung, schon mit Nummer -> mailen',
  shouldSendMail(null, true), true);
check('Wiederholung ohne neue Nummer -> NICHT nochmal mailen',
  shouldSendMail({ mailed: true, phoneUsable: false }, false), false);
check('Wiederholung, Nummer ist dazugekommen -> mailen (das braucht die Pfarrei)',
  shouldSendMail({ mailed: true, phoneUsable: false }, true), true);
check('Wiederholung, Nummer war schon da -> NICHT nochmal mailen',
  shouldSendMail({ mailed: true, phoneUsable: true }, true), false);
check('Wiederholung, Nummer faellt wieder weg -> NICHT mailen',
  shouldSendMail({ mailed: true, phoneUsable: true }, false), false);

// Code-Review 09.10.2026: Eine Folgemeldung kann mehr tragen als eine neue Nummer.
check('Folgemeldung wird PILNE -> mailen',
  shouldSendMail({ mailed: true, phoneUsable: true, phoneKey: 'a', urgent: false }, true, { urgent: true, phoneKey: 'a' }), true);
check('Folgemeldung mit ANDERER verwertbarer Nummer -> mailen',
  shouldSendMail({ mailed: true, phoneUsable: true, phoneKey: 'a', urgent: false }, true, { urgent: false, phoneKey: 'b' }), true);
check('Folgemeldung, gleiche Nummer, schon PILNE -> NICHT nochmal mailen',
  shouldSendMail({ mailed: true, phoneUsable: true, phoneKey: 'a', urgent: true }, true, { urgent: true, phoneKey: 'a' }), false);
check('Bisher nie zugestellt (Versand scheiterte) -> mailen',
  shouldSendMail({ mailed: false, phoneUsable: false }, false), true);
check('Alter Zustand ohne Fingerabdruck, keine neue Info -> NICHT mailen',
  shouldSendMail({ mailed: true, phoneUsable: true }, true, { urgent: false, phoneKey: 'a' }), false);

const r = shouldSendMail({ mailed: true, phoneUsable: false }, true);
const ok = r.reason === 'phone_added';
if (!ok) fail++;
console.log(`${ok ? 'PASS' : 'FAIL'}  Grund wird benannt (fuer den Betreff "Aktualisierung")`);

console.log(`\n${fail === 0 ? 'alle Tests gruen' : fail + ' FEHLER'}`);
process.exit(fail ? 1 : 0);
