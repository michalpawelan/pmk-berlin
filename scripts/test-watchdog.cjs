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

// H) Pastorale "oferta mszalna" (Mess-Stipendium) ist KEIN Vertrieb -> darf NICHT unterdrückt werden
const massStipendCall = { transcript: [
  user('Chciałbym zamówić ofertę mszalną za zmarłego ojca i proszę o kontakt.'),
  agent('Oczywiście, przekażę to do biura parafialnego, ktoś się odezwie.'),
] };
check('H lost (oferta mszalna ist KEIN Vertrieb)', w.detectLostHandoff(massStipendCall).lost === true);
check('H isSalesCall false (oferta mszalna)',       w.isSalesCall(massStipendCall.transcript) === false);

// --- Extraktion ---
// data_collection bevorzugt
const dcConvo = { transcript: [agent('Przekażę.')], analysis: { data_collection_results: {
  caller_name: { value: 'Marta Sawicz' }, callback_phone: { value: '+49 176 4389' }, concern: { value: 'Protokół ślubny' }
} }, metadata: { main_language: 'pl' } };
const f1 = w.extractTicketFields(dcConvo);
check('extract: Name aus data_collection', f1.name === 'Marta Sawicz');
check('extract: Phone aus data_collection', f1.phone === '+49 176 4389');
check('extract: lang aus metadata', f1.lang === 'pl');

// Fallback auf abgebrochene Tool-Params
const f2 = w.extractTicketFields(abandonedCall);
check('extract: Name aus abgebrochenen Tool-Params', f2.name === 'Adela');
check('extract: Phone aus abgebrochenen Tool-Params', f2.phone === '030 223');

// Fallback auf transcript_summary als concern
const sumConvo = { transcript: [agent('Przekażę.')], analysis: { transcript_summary: 'Sprawa pogrzebu.' } };
check('extract: concern Fallback auf Summary', w.extractTicketFields(sumConvo).concern === 'Sprawa pogrzebu.');

console.log(`\n${20 - fail}/20 passed`);
process.exit(fail ? 1 : 0);
