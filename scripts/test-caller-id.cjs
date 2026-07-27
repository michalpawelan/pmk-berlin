#!/usr/bin/env node
// Regressionstest: pickPhone (diktierte Nummer vs. Caller-ID-Fallback)
// Kontext: seit 17.07.2026 liefert die Netz-AWS die echte Anrufernummer als
// system__caller_id — vorher kam immer die maskierende Pfarrei-Nummer an.
const { pickPhone } = require('../netlify/functions/zgloszenie.js');

let fails = 0;
function eq(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { fails++; console.log('FAIL', label, '\n  got ', got, '\n  want', want); }
  else console.log('ok  ', label);
}

// Diktierte Nummer hat Vorrang
eq('diktiert gewinnt', pickPhone('0176 2467 4094', '+4915207205193'),
  { phone: '+49 17624674094', phone_source: 'dictated' });

// Keine diktierte Nummer -> Caller-ID
eq('caller-id springt ein', pickPhone('', '+4915207205193'),
  { phone: '+49 15207205193', phone_source: 'caller_id' });

// Diktierte Wortform (unbrauchbar) -> Caller-ID
eq('wortform -> caller-id', pickPhone('dwadziescia trzy', '+4915207205193'),
  { phone: '+49 15207205193', phone_source: 'caller_id' });

// Caller-ID = maskierende Pfarrei-Nummer -> verwerfen (Alt-Verhalten bleibt sicher)
eq('maskierung verworfen', pickPhone('', '+49307524080'),
  { phone: '', phone_source: '' });

// Caller-ID = KI-Leitung selbst -> verwerfen
eq('eigene leitung verworfen', pickPhone('', '+493075938358'),
  { phone: '', phone_source: '' });

// Unterdrückte Nummer -> nichts erfinden
eq('anonymous verworfen', pickPhone('', 'anonymous'),
  { phone: '', phone_source: '' });

// Beides leer
eq('beides leer', pickPhone('', ''), { phone: '', phone_source: '' });

// Polnische Handynummer als Caller-ID
eq('pl caller-id', pickPhone('', '+48732928831'),
  { phone: '+48 732928831', phone_source: 'caller_id' });

if (fails) { console.log('\n' + fails + ' FAIL(s)'); process.exit(1); }
console.log('\nAlle pickPhone-Tests gruen.');
