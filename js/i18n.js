/**
 * PMK Berlin — i18n Runtime
 * Lightweight translation system using JSON files + data-i18n attributes.
 *
 * Usage in HTML:
 *   <span data-i18n="key">Polish default</span>
 *   <h1 data-i18n-html="key">Polish <em>with markup</em></h1>
 *   <input data-i18n-attr="placeholder:key" placeholder="Polish placeholder">
 */

(function () {
  'use strict';

  const DEFAULT_LANG = 'pl';
  const STORAGE_KEY = 'pmk-lang';

  // Cache: { "common": { "nav.home": { pl: "...", de: "..." } }, ... }
  let translationCache = {};

  // Store original Polish content so we can restore without reloading
  let originalContent = new Map();

  // Detect which page we're on to load the right JSON
  function getPageId() {
    const path = window.location.pathname;
    const file = path.split('/').pop().replace('.html', '') || 'index';
    if (file.startsWith('wspolnota-')) return 'wspolnoty';
    return file;
  }

  // Load a single translation JSON; returns {} on failure
  async function loadJSON(name) {
    if (translationCache[name]) return translationCache[name];
    try {
      const resp = await fetch('translations/' + name + '.json');
      if (!resp.ok) return {};
      const data = await resp.json();
      translationCache[name] = data;
      return data;
    } catch (e) {
      // Could not load translations file
      return {};
    }
  }

  // Merge multiple translation objects into one flat dict
  function mergeTranslations(sources) {
    const merged = {};
    sources.forEach(function (src) {
      Object.keys(src).forEach(function (key) {
        merged[key] = src[key];
      });
    });
    return merged;
  }

  // Save original Polish content on first run
  function snapshotOriginals() {
    if (originalContent.size > 0) return; // already snapshotted

    document.querySelectorAll('[data-i18n]').forEach(function (el) {
      originalContent.set(el, { type: 'text', value: el.textContent });
    });
    document.querySelectorAll('[data-i18n-html]').forEach(function (el) {
      originalContent.set(el, { type: 'html', value: el.innerHTML });
    });
    document.querySelectorAll('[data-i18n-attr]').forEach(function (el) {
      var spec = el.getAttribute('data-i18n-attr');
      var pairs = spec.split(',').map(function (s) { return s.trim(); });
      var saved = {};
      pairs.forEach(function (pair) {
        var parts = pair.split(':');
        var attr = parts[0];
        saved[attr] = el.getAttribute(attr) || '';
      });
      originalContent.set(el, { type: 'attr', value: saved });
    });
  }

  // Apply translations to the DOM
  function applyTranslations(lang, translations) {
    // data-i18n → textContent
    document.querySelectorAll('[data-i18n]').forEach(function (el) {
      var key = el.getAttribute('data-i18n');
      var entry = translations[key];
      if (entry && entry[lang]) {
        el.textContent = entry[lang];
      } else if (lang === DEFAULT_LANG) {
        var orig = originalContent.get(el);
        if (orig) el.textContent = orig.value;
      }
    });

    // data-i18n-html → innerHTML (for content with <em>, <strong>, etc.)
    document.querySelectorAll('[data-i18n-html]').forEach(function (el) {
      var key = el.getAttribute('data-i18n-html');
      var entry = translations[key];
      if (entry && entry[lang]) {
        el.innerHTML = entry[lang];
      } else if (lang === DEFAULT_LANG) {
        var orig = originalContent.get(el);
        if (orig) el.innerHTML = orig.value;
      }
    });

    // data-i18n-attr → attribute values
    document.querySelectorAll('[data-i18n-attr]').forEach(function (el) {
      var spec = el.getAttribute('data-i18n-attr');
      var pairs = spec.split(',').map(function (s) { return s.trim(); });
      pairs.forEach(function (pair) {
        var parts = pair.split(':');
        var attr = parts[0];
        var key = parts[1];
        var entry = translations[key];
        if (entry && entry[lang]) {
          el.setAttribute(attr, entry[lang]);
        } else if (lang === DEFAULT_LANG) {
          var orig = originalContent.get(el);
          if (orig && orig.value[attr] !== undefined) {
            el.setAttribute(attr, orig.value[attr]);
          }
        }
      });
    });

    // Update <html lang="">
    document.documentElement.lang = lang;

    // Update button states
    document.querySelectorAll('.lang-btn').forEach(function (btn) {
      btn.classList.toggle('active', btn.textContent.trim() === lang.toUpperCase());
    });
  }

  // Main entry: switch language
  async function setLanguage(lang) {
    snapshotOriginals();

    var pageId = getPageId();
    var sources = await Promise.all([
      loadJSON('common'),
      loadJSON(pageId)
    ]);

    var translations = mergeTranslations(sources);
    applyTranslations(lang, translations);

    // Persist choice
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch (e) { /* private browsing */ }
  }

  // Expose globally — replaces the stub in main.js
  window.setLang = function (lang) {
    setLanguage(lang);
  };

  // On DOM ready: apply saved language
  document.addEventListener('DOMContentLoaded', function () {
    var saved = DEFAULT_LANG;
    try {
      saved = localStorage.getItem(STORAGE_KEY) || DEFAULT_LANG;
    } catch (e) { /* private browsing */ }

    // Only run translation if non-default language was saved
    if (saved !== DEFAULT_LANG) {
      setLanguage(saved);
    } else {
      // Still snapshot originals for later switching
      snapshotOriginals();
    }
  });

})();
