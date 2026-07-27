/**
 * Hinweisleiste "keine Cookies".
 *
 * Kein Consent-Banner: die Seite setzt keine Cookies und bindet kein Tracking ein,
 * es gibt also nichts einzuwilligen. Die Leiste informiert nur darüber und weist auf
 * das Klick-zum-Laden der Google-Karten hin (siehe Datenschutzerklaerung Ziffer 8/9).
 *
 * Gespeichert wird ausschliesslich ein Merker im lokalen Speicher, damit der Hinweis
 * nach dem Wegklicken nicht erneut erscheint (§ 25 Abs. 2 Nr. 2 TDDDG).
 */
(function () {
  'use strict';

  var STORAGE_KEY = 'pmk-notice-ok';
  var OPEN_CLASS = 'pmk-notice-open';

  var TEXTS = {
    pl: {
      label: 'Informacja o prywatności',
      text: 'Ta strona nie używa plików cookie ani narzędzi śledzących. Mapy Google wczytują się dopiero po kliknięciu.',
      link: 'Polityka prywatności',
      href: '/polityka-prywatnosci',
      button: 'Rozumiem'
    },
    de: {
      label: 'Datenschutzhinweis',
      text: 'Diese Seite nutzt keine Cookies und kein Tracking. Google-Karten werden erst auf Klick geladen.',
      link: 'Datenschutz',
      href: '/datenschutz',
      button: 'Verstanden'
    }
  };

  function dismissed() {
    try { return localStorage.getItem(STORAGE_KEY) === '1'; } catch (e) { return false; }
  }

  function remember() {
    try { localStorage.setItem(STORAGE_KEY, '1'); } catch (e) {}
  }

  function injectStyles() {
    var css = [
      '.pmk-notice{',
      '  position:fixed;left:24px;bottom:24px;z-index:2147482000;',
      '  max-width:27rem;box-sizing:border-box;',
      '  display:flex;align-items:center;gap:1rem;flex-wrap:wrap;',
      '  padding:1rem 1.25rem;',
      '  background:#fdfcfb;border:1px solid #e4dcd1;border-radius:14px;',
      '  box-shadow:0 16px 40px rgba(31,28,24,.12), 0 3px 8px rgba(31,28,24,.06);',
      '  font-family:"Outfit",-apple-system,BlinkMacSystemFont,sans-serif;',
      '  color:#4a4238;font-size:.85rem;line-height:1.55;',
      '  opacity:0;transform:translateY(8px);',
      '  transition:opacity .35s ease,transform .35s ease;',
      '}',
      '.pmk-notice[data-shown="1"]{opacity:1;transform:none;}',
      '.pmk-notice p{margin:0;flex:1 1 14rem;}',
      '.pmk-notice a{color:#7a6d5c;text-decoration:underline;text-underline-offset:2px;white-space:nowrap;}',
      '.pmk-notice a:hover{color:#4a4238;}',
      '.pmk-notice button{',
      '  flex:0 0 auto;cursor:pointer;font:inherit;font-weight:600;',
      '  padding:.5rem 1.15rem;border-radius:999px;',
      '  border:1px solid #d4c9ba;background:#f0ebe4;color:#4a4238;',
      '  transition:background .2s ease,border-color .2s ease;',
      '}',
      '.pmk-notice button:hover{background:#e4dcd1;border-color:#b8a892;}',
      '.pmk-notice button:focus-visible{outline:2px solid #9a8b76;outline-offset:2px;}',
      /* Auf schmalen Screens volle Breite; Chat-Widget weicht um die gemessene
         Hoehe der Leiste (--pmk-notice-h) nach oben aus. */
      '@media (max-width:720px){',
      '  .pmk-notice{left:12px;right:12px;bottom:12px;max-width:none;}',
      '  html.' + OPEN_CLASS + ' .pmk-launcher{bottom:calc(var(--pmk-notice-h, 0px) + 36px);}',
      '  html.' + OPEN_CLASS + ' .pmk-teaser{bottom:calc(var(--pmk-notice-h, 0px) + 108px);}',
      '}',
      '@media (prefers-reduced-motion:reduce){',
      '  .pmk-notice{transition:none;transform:none;}',
      '}'
    ].join('\n');

    var style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
  }

  function render() {
    var lang = (document.documentElement.lang || 'pl').slice(0, 2).toLowerCase();
    var t = TEXTS[lang] || TEXTS.pl;

    var box = document.createElement('div');
    box.className = 'pmk-notice';
    box.setAttribute('role', 'note');
    box.setAttribute('aria-label', t.label);

    var p = document.createElement('p');
    p.textContent = t.text + ' ';

    var a = document.createElement('a');
    a.href = t.href;
    a.textContent = t.link;
    p.appendChild(a);

    var measure = function () {
      document.documentElement.style.setProperty('--pmk-notice-h', box.offsetHeight + 'px');
    };

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = t.button;
    btn.addEventListener('click', function () {
      remember();
      window.removeEventListener('resize', measure);
      document.documentElement.classList.remove(OPEN_CLASS);
      document.documentElement.style.removeProperty('--pmk-notice-h');
      box.removeAttribute('data-shown');
      window.setTimeout(function () { box.remove(); }, 400);
    });

    box.appendChild(p);
    box.appendChild(btn);
    document.body.appendChild(box);
    document.documentElement.classList.add(OPEN_CLASS);
    measure();
    window.addEventListener('resize', measure);

    // Ein Frame warten, damit der Einblend-Übergang greift.
    window.requestAnimationFrame(function () {
      window.requestAnimationFrame(function () { box.setAttribute('data-shown', '1'); });
    });
  }

  function init() {
    if (dismissed()) return;
    injectStyles();
    render();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
