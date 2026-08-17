// PMK Berlin — Formular-Token (Spam-Schutz)
// Holt ein kurzlebiges, signiertes Token von /.netlify/functions/form-token und
// schickt es beim Absenden mit. Gegenstueck auf dem Server:
// netlify/functions/_form-guard.js.
//
// Anlass (17.08.2026): ~100 Fake-Spendermeldungen von einem Bot, der stumpf auf
// die Function-URL postet und den Honeypot im HTML deshalb nie sieht. Ohne
// Token kommt so ein Direkt-POST nicht mehr durch.
//
// Eingebunden auf den Seiten mit echten Formularen: wesprzyj / de/spenden,
// zgloszenie-komunia, zgloszenie-bierzmowanie.
window.PmkFormToken = (function () {
  // Der Server verlangt mindestens 2000 ms zwischen Ausstellen und Absenden
  // ("Zeitschloss"). Etwas Luft drauf, damit ein schneller Nutzer — Autofill,
  // Enter direkt nach dem Einfuegen — nie faelschlich abgewiesen wird.
  var MIN_AGE = 2300;
  var pending = null;

  function load() {
    return fetch('/.netlify/functions/form-token', { headers: { 'Accept': 'application/json' } })
      .then(function (r) { return r.json(); })
      // Zeit ab EMPFANG messen: der Server hat das Token davor ausgestellt,
      // damit ist sein Alter dort garantiert groesser als das hier gemessene.
      .then(function (d) { return { token: (d && d.token) || '', at: Date.now() }; })
      .catch(function () { return { token: '', at: Date.now() }; });
  }

  function start() {
    if (!pending) pending = load();
    return pending;
  }

  return {
    // Beim ersten Kontakt mit dem Formular vorladen, damit das Token beim
    // Absenden schon alt genug ist und niemand auf das Zeitschloss wartet.
    prime: function (form) {
      if (!form || form.getAttribute('data-token-primed')) return;
      form.setAttribute('data-token-primed', '1');
      form.addEventListener('focusin', start, { once: true });
      form.addEventListener('input', start, { once: true });
    },
    // Liefert das Token; holt notfalls eines nach und wartet die Restzeit ab.
    get: function () {
      return start().then(function (t) {
        var wait = MIN_AGE - (Date.now() - t.at);
        if (wait <= 0) return t.token;
        return new Promise(function (res) { setTimeout(function () { res(t.token); }, wait); });
      });
    }
  };
})();
