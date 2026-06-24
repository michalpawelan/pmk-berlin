// Regression test for buildMail() in netlify/functions/zgloszenie.js
// Run: node scripts/test-zgloszenie-mail.cjs
const { buildMail } = require('../netlify/functions/zgloszenie.js');

let fail = 0;
function check(label, cond) {
  if (!cond) fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`);
}

// 1) Normaler Voice-Fall: kein Recovered-Präfix
const normal = buildMail({ name: 'Jan Kowalski', phone: '+49 176 123', concern: 'Ślub', lang: 'pl', source: 'voice', urgent: false });
check('normal: kein AUTO-Präfix im Betreff', !/AUTO-WIEDERHERGESTELLT/.test(normal.subject));
check('normal: Name im Body', /Jan Kowalski/.test(normal.body));

// 2) Recovered-Fall: Warn-Präfix + Call-Link
const rec = buildMail({ name: 'Marta Sawicz', phone: '+49 176 4389', concern: 'Protokół ślubny', lang: 'pl', source: 'voice', urgent: false, recovered: true, call_link: 'https://elevenlabs.io/app/conversational-ai/history/conv_X' });
check('recovered: Warn-Präfix im Betreff', /AUTO-WIEDERHERGESTELLT/.test(rec.subject));
check('recovered: Prüf-Hinweis im Body', /gegen die Aufnahme prüfen|sprawdzić z nagraniem/.test(rec.body));
check('recovered: Call-Link im Body', /conv_X/.test(rec.body));

// 3) Urgent bleibt erhalten, auch recovered
const urg = buildMail({ name: 'X', phone: '', concern: 'umierający', lang: 'pl', source: 'voice', urgent: true, recovered: true, call_link: 'L' });
check('urgent+recovered: [PILNE] im Betreff', /\[PILNE\]/.test(urg.subject));

console.log(`\n${6 - fail}/6 passed`);
process.exit(fail ? 1 : 0);
