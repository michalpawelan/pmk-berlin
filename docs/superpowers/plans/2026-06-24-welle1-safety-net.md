# Welle 1 — Safety-Net + Event-Feed + Quota-Alert — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Kein versprochener Rückruf der PMK-KI-Agenten geht mehr verloren; der Event-Feed liefert keine falsche PLZ/Links mehr; Quota-Totalausfälle lösen einen Alert aus.

**Architecture:** Eine geplante Netlify-Function (`zgloszenie-watchdog.js`) pollt alle ~15 Min die beiden PMK-Agenten über die ElevenLabs-API, erkennt Gespräche mit Handoff-Versprechen ohne erfolgreichen `create_zgloszenie`-Tool-Call (inkl. abgebrochener Tool-Calls), dedupliziert über `@netlify/blobs` und POSTet ein als „wiederhergestellt" markiertes Ticket an die bestehende `zgloszenie.js`. Dieselbe Function flaggt Quota-Terminierungen. Der Event-Feed (`agent-events.js`) normalisiert PLZ/Links defensiv.

**Tech Stack:** Node.js (CommonJS, esbuild-Bundler), Netlify Functions + Scheduled Functions, `@netlify/blobs` (vorhanden), `nodemailer` (vorhanden), ElevenLabs Convai REST API. Tests: einfache `node`-Assert-Skripte in `scripts/*.cjs` (Projektmuster, vgl. `scripts/test-normalize-phone.cjs`).

## Global Constraints

- **Deploy nur manuell:** `netlify deploy --prod --dir=.` — `git push` deployt NICHT.
- **Apps Script darf NIE mailen:** `zgloszenie.js` setzt `no_email=true`; Mail läuft ausschließlich über IONOS-SMTP. Diese Invariante nicht brechen.
- **Polnische Diakritika:** in allen an Anrufer/Pfarrei gerichteten Texten korrekt (ą/ć/ę/ł/…), nicht strippen.
- **PMK-Agenten:** Voice `agent_4101kpbhjmptftzr7tscfxk639fq`, Chat `agent_9501kteh8ecmek7asfq0k7zvraqw`. Nur diese zwei verarbeiten — der ElevenLabs-Workspace ist geteilt (andere Kunden).
- **Secrets:** `ELEVENLABS_API_KEY` liegt in `.env` (lokal) und MUSS in den Netlify-Env-Vars gesetzt sein, damit die Function im Prod läuft. Niemals den Key ins Repo committen.
- **Tool-Erfolg:** „erfolgreiches `create_zgloszenie`" = `tool_result.tool_name=="create_zgloszenie"` UND `is_error==false` UND `tool_has_been_called==true`. Abgebrochene Tool-Calls (`is_error:true`) zählen als NICHT erfüllt.

---

### Task 1: Event-Feed defensive Normalisierung (D1)

Korrigiert stale PLZ `12049→10965` und `events.html→events` direkt im Feed-Output, unabhängig davon, was in den Sheet-Beschreibungen steht.

**Files:**
- Modify: `netlify/functions/agent-events.js` (Funktion ergänzen + in `parseEvents` anwenden + exportieren)
- Test: `scripts/test-event-normalize.cjs` (neu)

**Interfaces:**
- Produces: `exports.normalizeEventText(str: string) => string`

- [ ] **Step 1: Test schreiben** — `scripts/test-event-normalize.cjs`

```js
// Regression test for the event-feed text normalizer in netlify/functions/agent-events.js
// Run: node scripts/test-event-normalize.cjs
// Guards the production bug where stale Sheet event descriptions leaked the OLD
// postal code 12049 (correct is 10965) and a dead /events.html link into the
// voice/chat agent output (verified in 3 chat conversations, 2026-06-24).
const { normalizeEventText } = require('../netlify/functions/agent-events.js');

const cases = [
  // [input, expected, label]
  ['Lilienthalstraße 5, 12049 Berlin', 'Lilienthalstraße 5, 10965 Berlin', 'old PLZ -> 10965'],
  ['…, 10965 Berlin', '…, 10965 Berlin',                                     'correct PLZ untouched'],
  ['Mehr: https://www.pmk-berlin.de/events.html heute', 'Mehr: https://www.pmk-berlin.de/events heute', 'dead .html link -> clean'],
  ['siehe /events.html', 'siehe /events',                                    'relative .html link -> clean'],
  ['Festyn am 21.06.', 'Festyn am 21.06.',                                    'unrelated text untouched'],
  ['', '',                                                                    'empty stays empty'],
];

let fail = 0;
for (const [input, expected, label] of cases) {
  const got = normalizeEventText(input);
  const ok = got === expected;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${JSON.stringify(input)} -> ${JSON.stringify(got)}`
    + `${ok ? '' : `  (expected ${JSON.stringify(expected)})`}  [${label}]`);
}
console.log(`\n${cases.length - fail}/${cases.length} passed`);
process.exit(fail ? 1 : 0);
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag bestätigen**

Run: `node scripts/test-event-normalize.cjs`
Expected: FAIL — `TypeError: normalizeEventText is not a function` (Funktion existiert noch nicht).

- [ ] **Step 3: Normalisierer implementieren** — in `netlify/functions/agent-events.js` direkt vor `function cellValue(cell)` einfügen:

```js
// Defensive Korrektur stale Daten aus den Sheet-Event-Beschreibungen:
// alte PLZ 12049 -> 10965 (sitewide-verifiziert), tote /events.html-Links -> /events.
// Greift unabhängig davon, was Admins ins Sheet tippen. Verifizierter Bug 2026-06-24.
function normalizeEventText(str) {
  return String(str == null ? '' : str)
    .replace(/\b12049\b/g, '10965')
    .replace(/events\.html/g, 'events');
}
exports.normalizeEventText = normalizeEventText;
```

- [ ] **Step 4: In `parseEvents` anwenden** — die drei Felder beim Aufbau normalisieren. Ersetze in `netlify/functions/agent-events.js` den `out.push({…})`-Block in `parseEvents` (aktuell Zeilen ~58–65) durch:

```js
    out.push({
      title: normalizeEventText(title),
      date,
      time: parseTime(row.c[2]),
      description: normalizeEventText(String(cellValue(row.c[3])).trim()),
      location: normalizeEventText(String(cellValue(row.c[5])).trim()) || 'Johannes-Basilika',
      address: normalizeEventText(String(cellValue(row.c[6])).trim()) || 'Lilienthalstraße 5, 10965 Berlin'
    });
```

- [ ] **Step 5: Test laufen lassen, Erfolg bestätigen**

Run: `node scripts/test-event-normalize.cjs`
Expected: PASS — `6/6 passed`.

- [ ] **Step 6: Commit**

```bash
git add netlify/functions/agent-events.js scripts/test-event-normalize.cjs
git commit -m "fix(events): Feed normalisiert stale PLZ 12049->10965 + tote events.html-Links

Verifizierter Bug: 3 Chat-Gespräche gaben die alte PLZ/Tot-Links aus den
Sheet-Beschreibungen aus. Defensive Normalisierung im Feed greift unabhängig
von künftigen Fehleingaben.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `zgloszenie.js` — Recovered-Flag + testbare Mail-Erzeugung (A, Teil 1)

Extrahiert die Mail-Texterzeugung in eine reine, testbare Funktion und ergänzt das `recovered`-Flag (Prüf-Hinweis + Call-Link im Betreff/Body), ohne den bestehenden Pfad zu brechen.

**Files:**
- Modify: `netlify/functions/zgloszenie.js`
- Test: `scripts/test-zgloszenie-mail.cjs` (neu)

**Interfaces:**
- Produces: `exports.buildMail(d) => { subject: string, body: string }` mit `d = { name, phone, concern, lang, source, urgent, recovered, call_link }`
- Consumes (Task 5): Handler akzeptiert zusätzlich Body-Felder `recovered` (bool), `call_link` (string), `conversation_id` (string).

- [ ] **Step 1: Test schreiben** — `scripts/test-zgloszenie-mail.cjs`

```js
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

console.log(`\n${4 - fail}/4 passed`);
process.exit(fail ? 1 : 0);
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag bestätigen**

Run: `node scripts/test-zgloszenie-mail.cjs`
Expected: FAIL — `buildMail is not a function`.

- [ ] **Step 3: `buildMail` extrahieren + Recovered-Logik** — in `netlify/functions/zgloszenie.js`, ersetze in `sendViaIonos` den Block, der aktuell `subject` und `body` baut (Zeilen ~90–100), durch einen Aufruf von `buildMail`, und definiere `buildMail` als Modul-Funktion direkt vor `sendViaIonos`:

```js
// Reine Mail-Texterzeugung (für scripts/test-zgloszenie-mail.cjs exportiert).
// recovered=true => das Safety-Net hat dieses Anliegen aus dem Transkript
// rekonstruiert (Tool feuerte nicht). Pfarrei MUSS Name/Nummer gegen die
// Aufnahme prüfen, daher Warn-Präfix + Call-Link.
function buildMail(d) {
  const srcLabel = d.source === 'chat' ? 'czat na stronie' : 'asystent telefoniczny';
  const recPrefix = d.recovered ? '⚠️ AUTO-WIEDERHERGESTELLT — ' : '';
  const subject = recPrefix + (d.urgent ? '[PILNE] ' : '') + 'Nowe zgłoszenie (' + srcLabel + ')'
    + (d.name ? ' — ' + d.name : '');
  const recBanner = d.recovered
    ? '⚠️ AUTOMATYCZNIE ODZYSKANE ZGŁOSZENIE\n'
      + 'Asystent obiecał przekazać sprawę, ale narzędzie nie zostało wywołane. '
      + 'Dane wyodrębniono z transkrypcji — proszę sprawdzić imię i numer z nagraniem przed oddzwonieniem.\n'
      + (d.call_link ? 'Nagranie / transkrypcja: ' + d.call_link + '\n' : '')
      + '(Hinweis DE: automatisch wiederhergestellt — Name/Nummer gegen die Aufnahme prüfen.)\n\n'
    : '';
  const body =
    (d.urgent ? '⚠️ ZGŁOSZENIE PILNE (np. pogrzeb / namaszczenie chorych)\n\n' : '')
    + recBanner
    + 'Nowe zgłoszenie przekazane przez ' + srcLabel + ':\n\n'
    + 'Imię i nazwisko: ' + (d.name || '—') + '\n'
    + 'Telefon (oddzwonić): ' + (d.phone || '—') + '\n'
    + 'Język rozmowy: ' + (d.lang ? d.lang.toUpperCase() : '—') + '\n\n'
    + 'Sprawa:\n' + (d.concern || '—') + '\n\n'
    + '— Prosimy oddzwonić. Wiadomość wygenerowana automatycznie przez asystenta PMK.';
  return { subject, body };
}
exports.buildMail = buildMail;
```

Und in `sendViaIonos` ersetze die alte `subject`/`body`-Konstruktion durch:

```js
  const { subject, body } = buildMail(d);
```

(Die `sendMail`-Zeile bleibt unverändert; `d` enthält jetzt zusätzlich `recovered`/`call_link`, die `buildMail` liest.)

- [ ] **Step 4: Handler-Durchreichung** — in `exports.handler`, nach der `source`-Ableitung (Zeile ~150), die neuen Felder lesen und an `sendViaIonos` + Apps-Script-Form weitergeben. Ersetze die `sendViaIonos`-Zeile (~154) und ergänze die Form:

```js
  const recovered = truthy(p.recovered);
  const callLink = String(p.call_link || '').trim().slice(0, 300);

  let mail = { sent: false, reason: 'skipped' };
  try { mail = await sendViaIonos({ name, phone, concern, lang, source, urgent: truthy(p.urgent), recovered, call_link: callLink }); }
  catch (e) { mail = { sent: false, reason: 'smtp_error', detail: e.message }; }
```

Und nach `form.set('source', source);` ergänzen:

```js
  form.set('recovered', recovered ? 'true' : 'false');
  if (callLink) form.set('call_link', callLink);
```

- [ ] **Step 5: Tests laufen lassen (neu + bestehende Regression)**

Run: `node scripts/test-zgloszenie-mail.cjs && node scripts/test-normalize-phone.cjs`
Expected: `4/4 passed` und `9/9 passed` (bestehende Phone-Regression bleibt grün).

- [ ] **Step 6: Commit**

```bash
git add netlify/functions/zgloszenie.js scripts/test-zgloszenie-mail.cjs
git commit -m "feat(zgloszenie): recovered-Flag + testbare buildMail() für Safety-Net

buildMail() als reine Funktion extrahiert; recovered=true erzeugt Warn-Präfix,
Prüf-Hinweis und Call-Link, damit auto-wiederhergestellte Tickets vor dem
Rückruf gegen die Aufnahme verifiziert werden.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Watchdog-Detektion (reine Funktionen) (A, Teil 2)

Die Kern-Erkennungslogik als reine, mit echten Fällen getestete Funktionen.

**Files:**
- Create: `netlify/functions/zgloszenie-watchdog.js` (zunächst nur Helfer + Exporte)
- Test: `scripts/test-watchdog.cjs` (neu)

**Interfaces:**
- Produces:
  - `detectLostHandoff(convo) => { lost: boolean, reason: string }`
  - `hasHandoffPromise(transcript[]) => boolean`
  - `hasSuccessfulZgloszenie(transcript[]) => boolean`
  - `isSalesCall(transcript[]) => boolean`
  - `isUrgent(transcript[]) => boolean`
  - `isQuotaFailure(convo) => boolean`
  - `convo` = volle ElevenLabs-Conversation: `{ transcript: Turn[], analysis, metadata }`; `Turn = { role, message, tool_calls?, tool_results?, interrupted? }`.

- [ ] **Step 1: Test schreiben** — `scripts/test-watchdog.cjs` (Fixtures aus verifizierten Realfällen 2026-06-24)

```js
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
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag bestätigen**

Run: `node scripts/test-watchdog.cjs`
Expected: FAIL — `Cannot find module '../netlify/functions/zgloszenie-watchdog.js'`.

- [ ] **Step 3: Detektion implementieren** — `netlify/functions/zgloszenie-watchdog.js` anlegen mit:

```js
// PMK Berlin — Zgłoszenie-Watchdog
// Geplante Function: pollt die zwei PMK-Agenten, erkennt versprochene Handoffs
// ohne erfolgreichen create_zgloszenie-Tool-Call und erstellt ein als
// "recovered" markiertes Ticket. Reine Detektions-Helfer unten sind für
// scripts/test-watchdog.cjs exportiert.

const HANDOFF_RE = /przekaż|przekaza[łl]|zanotuj|notuj[ęe]|odezwie|oddzwoni|weitergeleitet|weitergegeben|leite[^.]{0,25}weiter|melden sich|notiert|i'?ll pass|pass(?:ed)? (?:it|this) on/i;
const SALES_RE = /churchdesk|ofert|współprac|wspolprac|reklam|w imieniu firmy|przedstawiciel handlow|sprzedaż|kooperation|werbung|vertrieb|im auftrag (?:der |des )?firma?/i;
const URGENT_RE = /umieraj|kona\b|intensywn|zagrożenie życia|zagrozenie zycia|namaszcz|ostatnie namaszczenie|reanimacj|sterbe|sterbend|krankensalbung|letzte ölung|nie żyje|zmar[łl]/i;

function agentText(transcript) {
  return (transcript || []).filter(t => t && t.role === 'agent').map(t => t.message || '').join('\n');
}
function allText(transcript) {
  return (transcript || []).map(t => (t && t.message) || '').join('\n');
}
function hasHandoffPromise(transcript) { return HANDOFF_RE.test(agentText(transcript)); }
function isSalesCall(transcript) { return SALES_RE.test(allText(transcript)); }
function isUrgent(transcript) { return URGENT_RE.test(allText(transcript)); }

function hasSuccessfulZgloszenie(transcript) {
  for (const turn of (transcript || [])) {
    for (const r of ((turn && turn.tool_results) || [])) {
      if (r && r.tool_name === 'create_zgloszenie' && r.is_error === false && r.tool_has_been_called === true) {
        return true;
      }
    }
  }
  return false;
}

function detectLostHandoff(convo) {
  const t = (convo && convo.transcript) || [];
  if (!hasHandoffPromise(t)) return { lost: false, reason: 'no_promise' };
  if (hasSuccessfulZgloszenie(t)) return { lost: false, reason: 'tool_succeeded' };
  if (isSalesCall(t)) return { lost: false, reason: 'sales_excluded' };
  return { lost: true, reason: 'promise_without_tool' };
}

function isQuotaFailure(convo) {
  const term = (convo && convo.metadata && convo.metadata.termination_reason) || '';
  return /quota|exceeded\s+quota|rate.?limit/i.test(term);
}

module.exports = {
  detectLostHandoff, hasHandoffPromise, hasSuccessfulZgloszenie,
  isSalesCall, isUrgent, isQuotaFailure,
};
```

- [ ] **Step 4: Test laufen lassen, Erfolg bestätigen**

Run: `node scripts/test-watchdog.cjs`
Expected: PASS — `13/13 passed`.

- [ ] **Step 5: Commit**

```bash
git add netlify/functions/zgloszenie-watchdog.js scripts/test-watchdog.cjs
git commit -m "feat(watchdog): Detektion verlorener Handoffs (reine Funktionen + Tests)

Erkennt Handoff-Versprechen ohne erfolgreichen create_zgloszenie (inkl.
abgebrochener Tool-Calls via is_error), schließt Vertriebsanrufe aus.
Fixtures aus verifizierten Realfällen.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Watchdog-Extraktion der Ticket-Felder (A, Teil 3)

Holt Name/Telefon/Anliegen für das Recovery-Ticket — bevorzugt aus den data-collection-Feldern, sonst aus den (auch abgebrochenen) Tool-Params, sonst aus der Transkript-Zusammenfassung.

**Files:**
- Modify: `netlify/functions/zgloszenie-watchdog.js` (Funktion + Export ergänzen)
- Modify: `scripts/test-watchdog.cjs` (Extraktions-Fälle ergänzen)

**Interfaces:**
- Produces: `extractTicketFields(convo) => { name, phone, concern, urgent, lang }` (alle Strings, `urgent` bool)

- [ ] **Step 1: Test ergänzen** — vor der `console.log(\`\n${13 - fail}\`...)`-Zeile in `scripts/test-watchdog.cjs` einfügen, und die Gesamtzahl von `13` auf `18` erhöhen (beide Vorkommen):

```js
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
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag bestätigen**

Run: `node scripts/test-watchdog.cjs`
Expected: FAIL — `w.extractTicketFields is not a function`.

- [ ] **Step 3: Extraktion implementieren** — in `netlify/functions/zgloszenie-watchdog.js` vor dem `module.exports`-Block einfügen, und im `module.exports` `extractTicketFields` ergänzen:

```js
function dcValue(dc, key) {
  const v = dc && dc[key];
  if (v == null) return '';
  if (typeof v === 'object') return String(v.value || v.result || '').trim();
  return String(v).trim();
}

function abandonedToolParams(transcript) {
  for (const turn of (transcript || [])) {
    for (const c of ((turn && turn.tool_calls) || [])) {
      if (c && c.tool_name === 'create_zgloszenie' && c.params_as_json) {
        try { return JSON.parse(c.params_as_json); } catch (_) { /* ignore */ }
      }
    }
  }
  return {};
}

function extractTicketFields(convo) {
  const t = (convo && convo.transcript) || [];
  const ana = (convo && convo.analysis) || {};
  const dc = ana.data_collection_results || {};
  const params = abandonedToolParams(t);
  const name = (dcValue(dc, 'caller_name') || params.name || '').toString().trim();
  const phone = (dcValue(dc, 'callback_phone') || params.phone || '').toString().trim();
  const concern = (dcValue(dc, 'concern') || params.concern || ana.transcript_summary || '').toString().trim();
  const lang = ((convo && convo.metadata && convo.metadata.main_language) || params.lang || '').toString().toLowerCase().slice(0, 2);
  return { name, phone, concern, urgent: isUrgent(t) || !!params.urgent, lang };
}
```

(Im `module.exports` ergänzen: `extractTicketFields,`)

- [ ] **Step 4: Test laufen lassen, Erfolg bestätigen**

Run: `node scripts/test-watchdog.cjs`
Expected: PASS — `18/18 passed`.

- [ ] **Step 5: Commit**

```bash
git add netlify/functions/zgloszenie-watchdog.js scripts/test-watchdog.cjs
git commit -m "feat(watchdog): Ticket-Feld-Extraktion (data_collection + Tool-Param-Fallback)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Watchdog-Handler — Polling, Idempotenz, Ticket-POST, Quota-Alert (A, Teil 4)

Verdrahtet die reinen Funktionen zu einer geplanten Function mit Dry-Run-Modus für sicheres Live-Testen.

**Files:**
- Modify: `netlify/functions/zgloszenie-watchdog.js` (Handler + Netzwerk-Helfer + Schedule)
- Modify: `netlify.toml` (Schedule eintragen)

**Interfaces:**
- Consumes: `detectLostHandoff`, `extractTicketFields`, `isQuotaFailure` (Tasks 3–4); `zgloszenie.js`-Endpoint (Task 2).
- Env: `ELEVENLABS_API_KEY` (Pflicht), `ZGLOSZENIE_URL` (optional, Default Prod-URL), `WATCHDOG_DRY_RUN` (`"true"` = nichts schreiben), `WATCHDOG_LOOKBACK_HOURS` (optional, Default 24), `ZGLOSZENIE_ALERT_TO` (optional, Quota-Alert-Empfänger), IONOS-SMTP-Vars (für Quota-Alert, vorhanden).

- [ ] **Step 1: Handler + Helfer ergänzen** — in `netlify/functions/zgloszenie-watchdog.js` oben (nach den Regexen) die Konstanten und unten (vor `module.exports`) den Handler einfügen:

```js
const AGENTS = {
  'agent_4101kpbhjmptftzr7tscfxk639fq': 'voice',
  'agent_9501kteh8ecmek7asfq0k7zvraqw': 'chat',
};
const EL_BASE = 'https://api.elevenlabs.io/v1/convai';

async function elGet(path) {
  const res = await fetch(EL_BASE + path, { headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY } });
  if (!res.ok) throw new Error('ElevenLabs ' + res.status + ' für ' + path);
  return res.json();
}

async function listRecent(agentId, sinceUnix) {
  const out = []; let cursor = '';
  do {
    const q = `/conversations?agent_id=${agentId}&page_size=100` + (cursor ? `&cursor=${cursor}` : '');
    const d = await elGet(q);
    for (const c of (d.conversations || [])) {
      if ((c.start_time_unix_secs || 0) >= sinceUnix) out.push(c);
    }
    const more = d.has_more && d.next_cursor && (d.conversations || []).some(c => (c.start_time_unix_secs || 0) >= sinceUnix);
    cursor = more ? d.next_cursor : '';
  } while (cursor);
  return out;
}

async function postRecoveredTicket(fields, source, conversationId) {
  const callLink = 'https://elevenlabs.io/app/conversational-ai/history/' + conversationId;
  const url = process.env.ZGLOSZENIE_URL || 'https://www.pmk-berlin.de/.netlify/functions/zgloszenie';
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: fields.name, phone: fields.phone, concern: fields.concern,
      urgent: fields.urgent, lang: fields.lang,
      source: source, recovered: true, call_link: callLink, conversation_id: conversationId,
    }),
  });
  return res.ok;
}

async function sendQuotaAlert(count) {
  const user = process.env.IONOS_SMTP_USER, pass = process.env.IONOS_SMTP_PASS;
  const to = process.env.ZGLOSZENIE_ALERT_TO || process.env.ZGLOSZENIE_TO;
  if (!user || !pass || !to) return false;
  let nodemailer; try { nodemailer = require('nodemailer'); } catch (_) { return false; }
  const host = process.env.IONOS_SMTP_HOST || 'smtp.ionos.de';
  const port = parseInt(process.env.IONOS_SMTP_PORT || '465', 10);
  const transporter = nodemailer.createTransport({ host, port, secure: port === 465, auth: { user, pass } });
  await transporter.sendMail({
    from: 'PMK Watchdog <' + user + '>', to,
    subject: '⚠️ PMK-Chat: ' + count + ' Gespräch(e) durch Quota-Limit abgebrochen',
    text: 'Der Watchdog hat ' + count + ' Chat-Gespräch(e) gefunden, die wegen eines '
      + 'Quota-/Limit-Fehlers ohne Antwort endeten. Bitte das ElevenLabs-/LLM-Kontingent prüfen/anheben.',
  });
  return true;
}

exports.handler = async () => {
  if (!process.env.ELEVENLABS_API_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: 'ELEVENLABS_API_KEY fehlt' }) };
  }
  const dry = process.env.WATCHDOG_DRY_RUN === 'true';
  const lookbackH = parseInt(process.env.WATCHDOG_LOOKBACK_HOURS || '24', 10);
  const since = Math.floor(Date.now() / 1000) - lookbackH * 3600;

  let store = null;
  if (!dry) { const { getStore } = require('@netlify/blobs'); store = getStore('zgloszenie-watchdog'); }

  const result = { scanned: 0, recovered: 0, quota: 0, skipped: 0, dry, details: [] };
  for (const [agentId, source] of Object.entries(AGENTS)) {
    const list = await listRecent(agentId, since);
    for (const c of list) {
      const id = c.conversation_id;
      const key = 'done:' + id;
      if (store && (await store.get(key))) { result.skipped++; continue; }
      const full = await elGet('/conversations/' + id);
      // Noch nicht fertig analysiert? -> nicht markieren, nächster Lauf erneut.
      if (!full.analysis) { continue; }
      result.scanned++;
      const det = detectLostHandoff(full);
      if (det.lost) {
        const fields = extractTicketFields(full);
        if (!dry) await postRecoveredTicket(fields, source, id);
        result.recovered++;
        result.details.push({ id, source, action: 'recovered', name: fields.name, phone: fields.phone });
      }
      if (isQuotaFailure(full)) result.quota++;
      if (store) await store.set(key, '1');
    }
  }
  if (result.quota > 0 && !dry) { try { await sendQuotaAlert(result.quota); } catch (_) { /* alert best-effort */ } }
  return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(result) };
};

exports.config = { schedule: '*/15 * * * *' };
```

- [ ] **Step 2: Schedule in `netlify.toml` absichern** — falls `exports.config.schedule` allein nicht greift, im `netlify.toml` ergänzen (ans Ende):

```toml
[functions."zgloszenie-watchdog"]
  schedule = "*/15 * * * *"
```

- [ ] **Step 3: Reine Tests müssen weiter grün sein** (Handler-Ergänzung darf die Exporte nicht brechen)

Run: `node scripts/test-watchdog.cjs`
Expected: PASS — `18/18 passed`.

- [ ] **Step 4: Live-Dry-Run gegen echte API** (kein Schreiben, nur Erkennung) — verifiziert, dass die bekannten Verlustfälle erkannt werden

Run:
```bash
WATCHDOG_DRY_RUN=true WATCHDOG_LOOKBACK_HOURS=720 \
ELEVENLABS_API_KEY=$(grep '^ELEVENLABS_API_KEY=' .env | cut -d= -f2) \
node -e "require('./netlify/functions/zgloszenie-watchdog.js').handler().then(r=>console.log(r.body))"
```
Expected: JSON mit `"dry":true`, `recovered` ≥ 3 und in `details` die bekannten Fälle (z. B. „Marta Sawicz" / Pax-Bank). Es wird KEIN Ticket erstellt und nichts in Blobs geschrieben.

- [ ] **Step 5: Commit**

```bash
git add netlify/functions/zgloszenie-watchdog.js netlify.toml
git commit -m "feat(watchdog): Polling-Handler + Idempotenz + Quota-Alert + 15-Min-Schedule

Geplante Function pollt beide PMK-Agenten, erstellt recovered-Tickets via
zgloszenie.js, dedupliziert via @netlify/blobs, alarmiert bei Quota-Abbrüchen.
Dry-Run-Modus (WATCHDOG_DRY_RUN) für sicheres Live-Testen.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: ElevenLabs data-collection-Felder konfigurieren (A, Teil 5)

Konfiguriert pro Agent die Felder, die der Watchdog bevorzugt liest. Reine ElevenLabs-Config (kein geteilter Workspace-Eingriff), per API analog zum Turn-Taking-Patch.

**Files:**
- Create: `scripts/el-set-datacollection.mjs` (Setup-Skript, einmalig ausführbar + idempotent)

**Interfaces:**
- Consumes: ElevenLabs `PATCH /v1/convai/agents/{id}` mit `platform_settings.data_collection`.

- [ ] **Step 1: Setup-Skript schreiben** — `scripts/el-set-datacollection.mjs`

```js
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
```

- [ ] **Step 2: Skript ausführen + verifizieren**

Run: `ELEVENLABS_API_KEY=$(grep '^ELEVENLABS_API_KEY=' .env | cut -d= -f2) node scripts/el-set-datacollection.mjs`
Expected: zweimal `OK … data_collection: caller_name, callback_phone, concern, handoff_promised`, dann `Fertig`.

- [ ] **Step 3: Commit**

```bash
git add scripts/el-set-datacollection.mjs
git commit -m "chore(agents): data-collection-Felder für Watchdog-Extraktion (beide Agenten)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Netlify-Env, Deploy, Live-Verifikation

Bringt den Watchdog live (env + scharfer Lauf) und verifiziert end-to-end.

**Files:** keine Code-Änderung — Konfiguration & Deploy.

- [ ] **Step 1: Netlify-Env-Vars setzen** (über CLI; Werte aus lokaler `.env`)

Run:
```bash
netlify env:set ELEVENLABS_API_KEY "$(grep '^ELEVENLABS_API_KEY=' .env | cut -d= -f2)"
netlify env:set WATCHDOG_DRY_RUN "true"      # zunächst sicher: live deployen, aber noch keine Tickets
```
Expected: Bestätigung „Set environment variable …" für beide.

- [ ] **Step 2: Prod-Deploy** (manuell — kein CI)

Run: `netlify deploy --prod --dir=.`
Expected: „Deploy is live", Functions-Liste enthält `zgloszenie-watchdog`.

- [ ] **Step 3: Geplanten Lauf im Dry-Run prüfen** — Function manuell triggern und Logs lesen

Run: `netlify functions:invoke zgloszenie-watchdog --no-identity`
Expected: JSON mit `"dry":true`, `recovered` ≥ 0; in den Netlify-Logs erscheinen die erkannten Fälle. KEINE Tickets/Mails.

- [ ] **Step 4: Scharf schalten** — Dry-Run aus, Lookback auf normales Fenster, neu deployen

Run:
```bash
netlify env:set WATCHDOG_DRY_RUN "false"
netlify env:set WATCHDOG_LOOKBACK_HOURS "24"
netlify deploy --prod --dir=.
```
Expected: „Deploy is live".

- [ ] **Step 5: End-to-End-Verifikation** — einen kontrollierten Testanruf führen (Handoff versprechen, NICHT zum erfolgreichen Tool kommen lassen / mittendrin auflegen), 15–30 Min warten, prüfen:
  - Posteingang `pmk@pmk-berlin.de`: Mail mit Betreff „⚠️ AUTO-WIEDERHERGESTELLT …" + Call-Link.
  - Sheet-Tab „Zgłoszenia": neue Zeile mit `recovered=true`.
  - Zweiter Watchdog-Lauf erzeugt KEIN Duplikat desselben Calls (Idempotenz greift).
  Expected: genau ein Ticket, korrekt geflaggt, kein Duplikat.

- [ ] **Step 6: Messung dokumentieren** — Baseline-Lauf festhalten

Run: `python3 scripts/voice-review.py --days 14`
Notiere die aktuelle Verlust-/Frust-/Unterbrechungsquote als neue Baseline nach Welle 1 (für die Re-Messung in 4–6 Wochen).

---

## Offene Punkte (außerhalb dieses Plans, brauchen User/Account)

- **E1 Quota-Limit anheben:** Der Watchdog *alarmiert* nur. Das tatsächliche Anheben des ElevenLabs-/LLM-Kontingents ist eine Billing-Entscheidung des Users.
- **D1 Sheet-Daten:** Die defensive Normalisierung deckt PLZ/Links ab. Inhaltliche Pflege der Event-Beschreibungen bleibt Aufgabe der Pfarrei/Admin.

## Self-Review

- **Spec-Abdeckung:** A → Tasks 2–7; D1 → Task 1; E1 (Alert-Teil) → Task 5 (`isQuotaFailure` + `sendQuotaAlert`), Limit-Anhebung als offener Punkt geführt. Turn-Taking (Welle 0) bereits erledigt; Messung in Task 7 Step 6.
- **Platzhalter:** keine — jeder Code-Schritt enthält vollständigen Code, jeder Test echte Assertions, jeder Run einen erwarteten Output.
- **Typ-Konsistenz:** `detectLostHandoff/extractTicketFields/isQuotaFailure/isUrgent/hasSuccessfulZgloszenie` identisch in Task 3/4 definiert und in Task 5 konsumiert; `buildMail(d)`-Felder (`recovered`, `call_link`) stimmen zwischen Task 2 und dem POST-Body in Task 5 überein; data-collection-Feldnamen (`caller_name`, `callback_phone`, `concern`) identisch in Task 4 (Lesen) und Task 6 (Anlegen).
