/**
 * PMK Berlin — Newsletter signup handler
 * Submits to /.netlify/functions/newsletter-subscribe which proxies to Google Apps Script.
 */
(function () {
  'use strict';

  var form = document.getElementById('newsletter-form');
  if (!form) return;

  var input = form.querySelector('input[name="email"]');
  var button = form.querySelector('button[type="submit"]');
  var status = document.getElementById('newsletter-status');
  var honeypot = form.querySelector('input[name="website"]');

  var MESSAGES = {
    success: { pl: 'Dziękujemy! Jesteś na liście.', de: 'Danke! Sie sind auf der Liste.' },
    duplicate: { pl: 'Ten adres już jest zapisany.', de: 'Diese Adresse ist bereits eingetragen.' },
    invalid: { pl: 'Sprawdź proszę swój adres e-mail.', de: 'Bitte prüfen Sie Ihre E-Mail-Adresse.' },
    error: { pl: 'Coś poszło nie tak. Spróbuj ponownie.', de: 'Etwas ist schiefgelaufen. Bitte erneut versuchen.' },
    sending: { pl: 'Wysyłanie…', de: 'Wird gesendet…' }
  };

  function lang() {
    return document.documentElement.lang === 'de' ? 'de' : 'pl';
  }

  function setStatus(kind, state) {
    if (!status) return;
    status.textContent = MESSAGES[kind][lang()];
    status.dataset.state = state || kind;
  }

  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    var email = (input.value || '').trim();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setStatus('invalid', 'error');
      input.focus();
      return;
    }
    button.disabled = true;
    setStatus('sending', 'pending');
    try {
      var res = await fetch('/.netlify/functions/newsletter-subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email,
          lang: lang(),
          source: location.pathname,
          website: honeypot ? honeypot.value : ''
        })
      });
      var data = await res.json().catch(function () { return {}; });
      if (data && data.success) {
        setStatus(data.duplicate ? 'duplicate' : 'success', 'success');
        if (!data.duplicate) form.reset();
      } else if (data && data.error === 'invalid_email') {
        setStatus('invalid', 'error');
      } else {
        setStatus('error', 'error');
      }
    } catch (_) {
      setStatus('error', 'error');
    } finally {
      button.disabled = false;
    }
  });
})();
