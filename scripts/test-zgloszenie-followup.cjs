// Regression test: Folgemeldungen im selben Gespraech duerfen bei Sheet-Ausfall
// nicht verloren gehen. Run: node scripts/test-zgloszenie-followup.cjs
//
// Code-Review 09.10.2026 (kritisch): Nach dem Umbau vom 08.10. galt eine als
// Duplikat unterdrueckte Mail als "Pfarrei benachrichtigt". Fiel dann das
// Apps-Script-Sheet aus, bekam der Agent success:true, obwohl die Folgemeldung
// (PILNE, andere Nummer) nirgends ankam. Ausserdem merkte sich der Zustand
// "gemailt", auch wenn der Versand gescheitert war — danach wurde nie wieder
// gemailt.
//
// Apps Script (fetch), SMTP (nodemailer) und Netlify Blobs sind gestubbt.

process.env.IONOS_SMTP_USER = 'test@example.invalid';
process.env.IONOS_SMTP_PASS = 'x';
process.env.ZGLOSZENIE_SHEET_BUDGET_MS = '300';
process.env.ZGLOSZENIE_SHEET_HARD_MS = '1200';
process.env.ZGLOSZENIE_SMTP_BUDGET_MS = '400';
process.env.ZGLOSZENIE_BLOB_BUDGET_MS = '300';
delete process.env.ZGLOSZENIE_SECRET;

const delay = ms => new Promise(r => setTimeout(r, ms));
const HANG = 10 * 60 * 1000;
const S = { mailFails: false, mailHangs: false, sheet: 'ok', blobHangs: false };
const mails = [];
const state = new Map();

const stub = (name, exports) => { const p = require.resolve(name); require.cache[p] = { id: p, filename: p, loaded: true, exports }; };
stub('nodemailer', { createTransport: () => ({ sendMail: async (m) => {
  if (S.mailHangs) await delay(HANG);
  await delay(20);
  if (S.mailFails) throw new Error('smtp down');
  mails.push(m);
  return { messageId: 'stub' };
} }) });
stub('@netlify/blobs', { getStore: () => ({
  get: async (k) => { if (S.blobHangs) await delay(HANG); return state.has(k) ? state.get(k) : null; },
  set: async (k, v) => { state.set(k, v); },
}) });
global.fetch = async () => {
  if (S.sheet === 'hang') await delay(HANG);
  await delay(S.sheet === 'slow' ? 600 : 20); // slow: laenger als das kurze Budget (300), kuerzer als das harte (1200)
  const body = (S.sheet === 'ok' || S.sheet === 'slow') ? '{"success":true,"id":"row"}' : '<html><body>Service invoked too many times</body></html>';
  return { ok: true, status: 200, text: async () => body };
};

const { handler } = require('../netlify/functions/zgloszenie.js');
const call = (fields) => handler({ httpMethod: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify(Object.assign({ caller_id: '+49307524080', lang: 'pl', concern: 'pogrzeb — prośba o kontakt' }, fields)) });

let fail = 0;
const check = (label, ok, detail) => { if (!ok) fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : '  -> ' + detail}`); };
const reset = (s = {}) => { Object.assign(S, { mailFails: false, mailHangs: false, sheet: 'ok', blobHangs: false }, s); };
const body = r => JSON.parse(r.body);

(async () => {
  // A) Folgemeldung bringt PILNE + andere Nummer, Sheet faellt aus -> Mail MUSS raus
  reset(); mails.length = 0; state.clear();
  let r = await call({ conversation_id: 'cA', phone: '0176 1111 1111' });
  check('A1: Erstmeldung -> Erfolg + 1 Mail', r.statusCode === 200 && mails.length === 1, `${r.statusCode} mails=${mails.length}`);
  reset({ sheet: 'html' });
  r = await call({ conversation_id: 'cA', phone: '0176 2222 2222', urgent: true, name: 'Anna', concern: 'pogrzeb mamy — pilne' });
  check('A2: Folgemeldung PILNE + neue Nummer bei Sheet-Ausfall -> Mail geht raus', mails.length === 2 && /PILNE/.test(mails[1].subject)
    && /0176 2222 2222|17622222222/.test(mails[1].text), `mails=${mails.length} ${mails[1] && mails[1].subject}`);
  check('A3: ... und erst dann Erfolg an den Agenten', r.statusCode === 200 && body(r).success === true, r.body.slice(0, 120));

  // B) Erstmeldung: SMTP kaputt, Sheet ok. Folgemeldung: Sheet kaputt -> Mail MUSS raus
  reset({ mailFails: true }); mails.length = 0; state.clear();
  r = await call({ conversation_id: 'cB' });
  check('B1: SMTP kaputt, Sheet ok -> Erfolg (Zeile steht), 0 Mails', r.statusCode === 200 && mails.length === 0, `${r.statusCode} mails=${mails.length}`);
  check('B2: Zustand merkt sich: noch NICHT gemailt', JSON.parse(state.get('c:cB') || '{}').mailed === false, state.get('c:cB'));
  reset({ sheet: 'html' });
  r = await call({ conversation_id: 'cB', concern: 'mama umiera, prosimy o księdza', urgent: true });
  check('B3: Folgemeldung bei Sheet-Ausfall -> Mail wird jetzt zugestellt', mails.length === 1 && /PILNE/.test(mails[0].subject), `mails=${mails.length}`);
  check('B4: ... Erfolg erst nach Zustellung', r.statusCode === 200 && body(r).success === true, r.body.slice(0, 120));

  // C) Reines Duplikat, Sheet faellt aus -> Mail als Aktualisierung nachreichen
  reset(); mails.length = 0; state.clear();
  await call({ conversation_id: 'cC' });
  reset({ sheet: 'html' });
  r = await call({ conversation_id: 'cC' });
  check('C: Duplikat + Sheet-Ausfall -> Aktualisierungs-Mail statt stiller Verlust', r.statusCode === 200 && mails.length === 2
    && /AKTUALIZACJA/.test(mails[1].subject), `${r.statusCode} mails=${mails.length} ${mails[1] && mails[1].subject}`);

  // D) Reines Duplikat, Sheet ok -> keine zweite Mail
  reset(); mails.length = 0; state.clear();
  await call({ conversation_id: 'cD' });
  r = await call({ conversation_id: 'cD' });
  check('D: Duplikat + Sheet ok -> keine zweite Mail, Erfolg', r.statusCode === 200 && mails.length === 1, `${r.statusCode} mails=${mails.length}`);

  // E) Duplikat, Sheet faellt aus, SMTP auch -> ehrlich Fehler
  reset(); mails.length = 0; state.clear();
  await call({ conversation_id: 'cE' });
  reset({ sheet: 'html', mailFails: true });
  r = await call({ conversation_id: 'cE' });
  check('E: Duplikat + Sheet-Ausfall + SMTP-Ausfall -> 502, kein falsches success', r.statusCode === 502 && body(r).success === false, r.statusCode);

  // F) SMTP haengt laenger als das Budget, Sheet ok -> Erfolg in vertretbarer Zeit, Zustand "nicht gemailt"
  reset({ mailHangs: true }); mails.length = 0; state.clear();
  let t0 = Date.now(); r = await call({ conversation_id: 'cF' }); let ms = Date.now() - t0;
  check('F1: haengender SMTP blockiert nicht (Budget greift)', r.statusCode === 200 && ms < 1500, `${r.statusCode} ${ms} ms`);
  check('F2: Zustand: nicht als gemailt markiert', JSON.parse(state.get('c:cF') || '{}').mailed === false, state.get('c:cF'));

  // G) Zustandsspeicher haengt -> Function antwortet trotzdem und mailt (lieber eine zu viel)
  reset({ blobHangs: true }); mails.length = 0; state.clear();
  t0 = Date.now(); r = await call({ conversation_id: 'cG' }); ms = Date.now() - t0;
  check('G: haengender Blob-Speicher -> Antwort + Mail trotzdem', r.statusCode === 200 && mails.length === 1 && ms < 1500, `${r.statusCode} mails=${mails.length} ${ms} ms`);

  // Re-Review 09.10.2026 ----------------------------------------------------
  // H) PILNE-Aktualisierung scheitert (SMTP), Sheet ok -> Zustand darf "PILNE" NICHT
  //    uebernehmen, sonst wird die naechste PILNE-Meldung als Duplikat unterdrueckt.
  reset(); mails.length = 0; state.clear();
  await call({ conversation_id: 'cH' });
  reset({ mailFails: true });
  r = await call({ conversation_id: 'cH', urgent: true, concern: 'pogrzeb — pilne' });
  check('H1: PILNE-Mail scheitert, Sheet ok -> Erfolg', r.statusCode === 200 && mails.length === 1, `${r.statusCode} mails=${mails.length}`);
  reset();
  r = await call({ conversation_id: 'cH', urgent: true, concern: 'pogrzeb — pilne' });
  check('H2: naechste PILNE-Meldung holt die Mail nach', mails.length === 2 && /PILNE/.test(mails[1].subject), `mails=${mails.length}`);

  // I) Chat: erst ohne Kontakt, dann mit E-Mail im Anliegen -> die Adresse MUSS ins Postfach
  reset(); mails.length = 0; state.clear();
  await call({ conversation_id: 'cI', caller_id: '', urgent: true, concern: 'zmarł mój tata, pogrzeb' });
  r = await call({ conversation_id: 'cI', caller_id: '', urgent: true, concern: 'zmarł mój tata, pogrzeb — kontakt: anna.nowak@example.com' });
  check('I1: E-Mail aus dem Chat kommt per Mail an', mails.length === 2 && /anna\.nowak@example\.com/.test(mails[1].text), `mails=${mails.length}`);
  check('I2: mit E-Mail fragt die Antwort NICHT erneut nach einer Telefonnummer', r.statusCode === 200 && !body(r).next_action, r.body.slice(0, 200));
  check('I3: Chat-Ticket wird als Chat gekennzeichnet', /czat/i.test(mails[0].subject), mails[0] && mails[0].subject);

  // J) Duplikat, Sheet langsamer als das kurze Budget, Ersatz-Mail scheitert -> auf das Sheet
  //    weiter warten statt falschem 502 (sonst doppelte Zeile durch erneuten Versuch)
  reset(); mails.length = 0; state.clear();
  await call({ conversation_id: 'cJ' });
  reset({ sheet: 'slow', mailFails: true });
  r = await call({ conversation_id: 'cJ' });
  check('J: Sheet kommt nach dem kurzen Budget doch noch -> Erfolg statt 502', r.statusCode === 200 && body(r).sheet === 'ok', `${r.statusCode} ${r.body.slice(0, 120)}`);

  // K) Nummern-Aktualisierung nur fuer DIKTIERTE Nummern, nicht fuer den Caller-ID-Rueckfall
  reset(); mails.length = 0; state.clear();
  await call({ conversation_id: 'cK', phone: '0176 1111 1111', caller_id: '+4915112345678' });
  r = await call({ conversation_id: 'cK', phone: '', caller_id: '+4915112345678' });
  check('K: Rueckfall auf Caller-ID loest keine "[AKTUALIZACJA — numer]"-Mail aus', mails.length === 1, `mails=${mails.length} ${mails[1] && mails[1].subject}`);

  console.log(`\n${fail ? fail + ' FEHLER' : 'alle Tests gruen'}`);
  process.exit(fail ? 1 : 0);
})();
