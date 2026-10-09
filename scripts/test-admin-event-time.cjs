// Test: Uhrzeiten im Admin-Panel (Termine) gehen beim Speichern nicht verloren.
// Run: node scripts/test-admin-event-time.cjs
//
// Hintergrund (09.10.2026): Das Apps Script lieferte Uhrzeit-Zellen als Datums-Text
// ("Sat Dec 30 1899 19:00:00 GMT+0100 ..." fuer 10:00, Sheet- und Skript-Zeitzone liegen
// 9 h auseinander). Das <input type="time"> im Bearbeiten-Dialog verwirft so einen Wert
// und bleibt leer, "Speichern" schrieb dann eine leere Uhrzeit ins Sheet.
// Teil A prueft das Apps Script (listEvents), Teil B das Formular (admin/events.js).
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let fail = 0;
const check = (label, ok, detail) => { if (!ok) fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : '  -> ' + detail}`); };

// ---------------------------------------------------------------- Teil A: Apps Script
const SHEET_TZ = 'America/Los_Angeles';
function loadGas(rows) {
  const ctx = vm.createContext({ console });
  const CDate = vm.runInContext('Date', ctx); // instanceof Date muss im Skript-Kontext greifen
  const values = [['Tytuł', 'Data', 'Godzina', 'Opis', 'Zdjęcie', 'Miejsce', 'Adres', 'Opublikowane', 'Wspólnota']];
  const shown = [values[0].slice()];
  for (const r of rows) {
    const raw = r.time && r.time.iso ? new CDate(r.time.iso) : r.time;
    values.push([r.title, new CDate(2026, 9, 10), raw, '', '', '', '', 'TAK', '']);
    shown.push([r.title, '10.10.2026', r.shown, '', '', '', '', 'TAK', '']);
  }
  const range = { getValues: () => values, getDisplayValues: () => shown };
  const ss = { getSpreadsheetTimeZone: () => SHEET_TZ };
  const sheet = { getDataRange: () => range, getParent: () => ss };
  Object.assign(ctx, {
    SpreadsheetApp: { openById: () => Object.assign({ getSheetByName: () => sheet }, ss) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => '' }) },
    Utilities: { formatDate(d, tz, fmt) {
      if (fmt !== 'HH:mm') throw new Error('unerwartetes Format ' + fmt);
      const p = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d);
      return p.find(x => x.type === 'hour').value + ':' + p.find(x => x.type === 'minute').value;
    } },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../admin/google-apps-script.js'), 'utf8'), ctx);
  return ctx;
}

const gas = loadGas([
  { title: 'Zeitwert 10:00', time: { iso: '1899-12-30T18:00:00Z' }, shown: '10:00' },
  { title: 'Zeitwert 19:15 (Tag kippt)', time: { iso: '1899-12-31T03:15:00Z' }, shown: '19:15' },
  { title: 'Text-Spanne', time: '10:00-12:00', shown: '10:00-12:00' },
  { title: 'Ohne Uhrzeit', time: '', shown: '' },
  { title: 'Anzeige mit Sekunden', time: { iso: '1899-12-30T17:00:00Z' }, shown: '9:00:00' },
  { title: 'Anzeige 12h-Format', time: { iso: '1899-12-30T22:30:00Z' }, shown: '2:30 PM' },
]);
const listed = gas.listEvents();
const timeOf = t => (listed.events.find(e => e.title === t) || {}).time;
check('GAS: list erfolgreich', listed.success === true, JSON.stringify(listed).slice(0, 200));
check('GAS: Zeitwert -> "10:00" (wie im Sheet angezeigt)', timeOf('Zeitwert 10:00') === '10:00', JSON.stringify(timeOf('Zeitwert 10:00')));
check('GAS: Zeitwert 19:15 auch wenn das Datum intern auf den 31.12. kippt', timeOf('Zeitwert 19:15 (Tag kippt)') === '19:15', JSON.stringify(timeOf('Zeitwert 19:15 (Tag kippt)')));
check('GAS: Text-Spanne bleibt unveraendert', timeOf('Text-Spanne') === '10:00-12:00', JSON.stringify(timeOf('Text-Spanne')));
check('GAS: leere Uhrzeit bleibt leer', timeOf('Ohne Uhrzeit') === '', JSON.stringify(timeOf('Ohne Uhrzeit')));
check('GAS: "9:00:00" -> "09:00" (passt ins Zeitfeld)', timeOf('Anzeige mit Sekunden') === '09:00', JSON.stringify(timeOf('Anzeige mit Sekunden')));
check('GAS: unbekanntes Anzeigeformat -> aus Sheet-Zeitzone "14:30"', timeOf('Anzeige 12h-Format') === '14:30', JSON.stringify(timeOf('Anzeige 12h-Format')));
check('GAS: Datum unveraendert "2026-10-10"', listed.events.every(e => e.date === '2026-10-10'), JSON.stringify(listed.events.map(e => e.date)));

// ---------------------------------------------------------------- Teil B: Formular
// Nachbau des DOM, so weit admin/events.js ihn braucht. Zeitfelder verhalten sich wie im
// Browser: kein gueltiger Zeit-Text (HH:MM[:SS]) -> Wert wird zu ''.
function loadAdmin(events) {
  const TIME_IDS = new Set(['eventTimeFrom', 'eventTimeRangeFrom', 'eventTimeRangeTo']);
  const VALID_TIME = /^\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?$/;
  const toasts = [];
  const calls = [];
  const els = new Map();
  function el(id, tag) {
    let v = '';
    const set = new Set();
    const options = [];
    const e = {
      id, tagName: String(tag || 'div').toUpperCase(), options, checked: false, innerHTML: '', textContent: '', className: '', disabled: false, style: {}, dataset: {},
      classList: { add: c => set.add(c), remove: c => set.delete(c), contains: c => set.has(c),
        toggle: (c, f) => ((f === undefined ? !set.has(c) : f) ? set.add(c) : set.delete(c)) },
      setAttribute() {}, getAttribute() { return null; }, removeAttribute() {}, addEventListener() {},
      focus() {}, reset() {}, click() {}, select() {},
      remove(i) { if (typeof i === 'number') options.splice(i, 1); },
      appendChild(child) {
        if (id === 'toastContainer') toasts.push(child);
        if (child.tagName === 'OPTION') options.push(child);
        return child;
      },
      querySelector: () => el('_q'), querySelectorAll: () => [],
    };
    Object.defineProperty(e, 'value', {
      get: () => v,
      set: x => { x = x == null ? '' : String(x); v = TIME_IDS.has(id) && x !== '' && !VALID_TIME.test(x) ? '' : x; },
    });
    return e;
  }
  const document = {
    getElementById: id => { if (!els.has(id)) els.set(id, el(id)); return els.get(id); },
    createElement: tag => el('_new', tag), querySelector: () => el('_q'), querySelectorAll: () => [],
    addEventListener() {}, body: el('body'),
  };
  const ctx = vm.createContext({
    console, URL, document, setTimeout: () => 0, clearTimeout() {},
    window: { addEventListener() {} },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    requestAnimationFrame: cb => cb(),
    Auth: { url: 'https://example.test/exec', getPin: () => 'test-pin' },
    fetch: async url => {
      const u = new URL(url);
      const action = u.searchParams.get('action');
      calls.push({ action, time: u.searchParams.get('time') });
      const body = action === 'list' ? { success: true, events } : { success: true };
      return { ok: true, status: 200, text: async () => JSON.stringify(body) };
    },
  });
  const src = fs.readFileSync(path.join(__dirname, '../admin/events.js'), 'utf8');
  vm.runInContext(src + '\n;globalThis.__Events = Events;', ctx);
  const Events = ctx.__Events;
  Events.setEvents(events);
  return { Events, document, toasts, calls };
}

const baseEvent = { row: 22, title: 'Katecheza dla maluszków', date: '2026-10-10', description: 'Opis', image: '',
  location: 'Johannes-Basilika', address: 'Lilienthalstraße 5, 10965 Berlin', published: 'TAK', community: '' };

async function saveScenario(time, edit) {
  const t = loadAdmin([Object.assign({}, baseEvent, { time })]);
  t.Events.openModal(22);
  if (edit) edit(t.document);
  await t.Events.handleSaveEvent({ preventDefault() {} });
  const upd = t.calls.find(c => c.action === 'update');
  const errors = t.toasts.filter(x => /\berror\b/.test(x.className)).map(x => x.innerHTML);
  return { upd, errors };
}

(async () => {
  const OLD = 'Sat Dec 30 1899 23:00:00 GMT+0100 (Mitteleuropäische Normalzeit)';

  let r = await saveScenario(OLD);
  check('Admin: unlesbare Uhrzeit wird beim Speichern NICHT geloescht (kein update mit leerer Zeit)',
    !r.upd || r.upd.time !== '', JSON.stringify(r.upd));
  check('Admin: ... und es kommt eine Fehlermeldung zur Uhrzeit', r.errors.some(m => /godzin/i.test(m)), JSON.stringify(r.errors));

  r = await saveScenario(OLD, d => { d.getElementById('eventTimeFrom').value = '14:00'; });
  check('Admin: unlesbare Uhrzeit, neue Uhrzeit eingetragen -> wird gespeichert', r.upd && r.upd.time === '14:00', JSON.stringify(r.upd));

  r = await saveScenario('10:00');
  check('Admin: lesbare Uhrzeit bleibt beim Speichern erhalten', r.upd && r.upd.time === '10:00', JSON.stringify(r.upd));

  r = await saveScenario('10:00', d => { d.getElementById('eventTimeFrom').value = ''; });
  check('Admin: Uhrzeit absichtlich geleert -> darf leer gespeichert werden', r.upd && r.upd.time === '', JSON.stringify(r.upd));

  r = await saveScenario('10:00-12:00');
  check('Admin: Zeitspanne bleibt erhalten', r.upd && r.upd.time === '10:00-12:00', JSON.stringify(r.upd));

  r = await saveScenario('');
  check('Admin: Termin ohne Uhrzeit laesst sich ohne Uhrzeit speichern', r.upd && r.upd.time === '' && !r.errors.length, JSON.stringify(r));

  console.log(`\n${fail ? fail + ' FEHLER' : 'alle Tests gruen'}`);
  process.exit(fail ? 1 : 0);
})();
