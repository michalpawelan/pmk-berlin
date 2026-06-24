// Regression test for the lost-handoff watchdog detection.
// Run: node scripts/test-watchdog.cjs
// Fixtures are distilled from real conversations (2026-06-24 review).
const w = require('../netlify/functions/zgloszenie-watchdog.js');

function agent(message, extra = {}) { return { role: 'agent', message, ...extra }; }
function user(message) { return { role: 'user', message }; }

// A) Marriage Document Inquiry: Perfekt-Versprechen, KEIN Tool -> lost
const lostCall = { transcript: [
  user('Marta Sawicz, chodzi o protokół ślubny mojego syna.'),
  agent('Potwierdzam, numer to zero sto siedemdziesiąt sześć...'),
  agent('Tak, dziękuję. Przekazałam Pani prośbę, ktoś z parafii się odezwie.'),
  agent('Dziękuję za rozmowę.', { tool_calls: [{ tool_name: 'end_call' }] }),
] };

// B) Erfolgreiche Eskalation: Tool-Result is_error=false -> nicht lost
const okCall = { transcript: [
  user('Proszę o telefon od księdza.'),
  agent('Przekazuję Pani prośbę.', {
    tool_calls: [{ tool_name: 'create_zgloszenie', params_as_json: '{"name":"Jan","phone":"+49 176 1"}' }],
    tool_results: [{ tool_name: 'create_zgloszenie', is_error: false, tool_has_been_called: true, result_value: '{"success":true}' }],
  }),
] };

// C) Abgebrochener Tool-Call: gestartet, aber is_error=true -> lost
const abandonedCall = { transcript: [
  user('Proszę o kontakt.'),
  agent('Przekażę to do zespołu.', {
    tool_calls: [{ tool_name: 'create_zgloszenie', params_as_json: '{"name":"Adela","phone":"030 223"}' }],
    tool_results: [{ tool_name: 'create_zgloszenie', is_error: true, tool_has_been_called: false, result_value: 'Tool execution was abandoned due to user input' }],
  }),
] };

// D) Vertriebsanruf mit "przekażę" -> ausgeschlossen, NICHT lost
const salesCall = { transcript: [
  user('Dzwonię w imieniu firmy ChurchDesk, chcielibyśmy zaoferować oprogramowanie.'),
  agent('Przekażę informację, ale dziękujemy, nie jesteśmy zainteresowani.'),
] };

// E) Reiner Info-Call ohne Handoff-Versprechen -> nicht lost
const infoCall = { transcript: [
  user('O której jest msza w niedzielę?'),
  agent('Msza w niedzielę o dziewiątej i jedenastej. Czy mogę jeszcze pomóc?'),
] };

// F) Quota-Abbruch
const quotaCall = { transcript: [ user('O której msza?') ], metadata: { termination_reason: 'exceeds quota limit' } };

// G) Sterbefall -> urgent
const urgentTranscript = [ user('Mój mąż umiera na intensywnej terapii, potrzebny ksiądz.'), agent('Przekażę natychmiast.') ];

let fail = 0;
function check(label, cond) { if (!cond) fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`); }

check('A lost (Perfekt-Versprechen, kein Tool)',        w.detectLostHandoff(lostCall).lost === true);
check('B nicht lost (Tool-Erfolg)',                     w.detectLostHandoff(okCall).lost === false);
check('B Grund tool_succeeded',                         w.detectLostHandoff(okCall).reason === 'tool_succeeded');
check('C lost (abgebrochener Tool-Call)',               w.detectLostHandoff(abandonedCall).lost === true);
check('D nicht lost (Vertrieb ausgeschlossen)',         w.detectLostHandoff(salesCall).lost === false);
check('D Grund sales_excluded',                         w.detectLostHandoff(salesCall).reason === 'sales_excluded');
check('E nicht lost (kein Versprechen)',                w.detectLostHandoff(infoCall).lost === false);
check('hasSuccessfulZgloszenie B true',                 w.hasSuccessfulZgloszenie(okCall.transcript) === true);
check('hasSuccessfulZgloszenie C false (abandoned)',    w.hasSuccessfulZgloszenie(abandonedCall.transcript) === false);
check('isQuotaFailure F true',                          w.isQuotaFailure(quotaCall) === true);
check('isQuotaFailure B false',                         w.isQuotaFailure(okCall) === false);
check('isUrgent G true',                                w.isUrgent(urgentTranscript) === true);
check('isUrgent E false',                               w.isUrgent(infoCall.transcript) === false);

console.log(`\n${13 - fail}/13 passed`);
process.exit(fail ? 1 : 0);
