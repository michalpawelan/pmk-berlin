// admin/auth.js — PIN-basierter Login fuer das Admin-Dashboard.
// Spaeter erweiterbar um Rollen (Owner/Sekretarin/Pfarrer).

const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwr6u5qQRUuQ37gIaczdCG0DmfQRlazDGYUbQOC2CaSCy_tJBywwwChXwtAS8Ivqe9HPw/exec';

const Auth = {
  url: APPS_SCRIPT_URL,

  getPin() {
    return sessionStorage.getItem('pmk_admin_pin') || '';
  },

  setPin(pin) {
    sessionStorage.setItem('pmk_admin_pin', pin);
  },

  clear() {
    sessionStorage.removeItem('pmk_admin_pin');
  },

  // Prueft den PIN durch einen list-Aufruf gegen Apps Script.
  // Liefert { ok: true, events } oder { ok: false, error }.
  async verify(pin) {
    try {
      const url = new URL(this.url);
      url.searchParams.set('action', 'list');
      url.searchParams.set('pin', pin);
      const res = await fetch(url.toString(), { redirect: 'follow' });
      const text = await res.text();
      let data;
      try { data = JSON.parse(text); } catch (e) { return { ok: false, error: 'Blad serwera' }; }
      if (data && data.success !== false && Array.isArray(data.events)) {
        return { ok: true, events: data.events };
      }
      return { ok: false, error: (data && data.error) || 'PIN ungueltig' };
    } catch (e) {
      return { ok: false, error: 'Blad polaczenia' };
    }
  }
};

window.Auth = Auth;
