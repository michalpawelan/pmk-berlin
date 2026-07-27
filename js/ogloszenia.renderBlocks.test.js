// Standalone unit test for renderBlocks() — run with: node js/ogloszenia.renderBlocks.test.js
// The module is an IIFE that assigns window.PMK_Ogloszenia. We shim window, load it, then assert.
'use strict';
const assert = require('assert');

global.window = {};
require('./ogloszenia.js'); // IIFE runs on require, sets global.window.PMK_Ogloszenia

const { renderBlocks } = global.window.PMK_Ogloszenia;

// 1. A Drive image block renders as a plain <img> (natural aspect, no crop, no blur frame),
//    with the first-party proxy URL (never lh3 directly — DSGVO) and perf attributes.
const driveBody = JSON.stringify([
  { t: 'img', u: 'https://drive.google.com/file/d/ABC123_xyz-9/view' }
]);
const driveOut = renderBlocks(driveBody);
// & is HTML-escaped inside the attribute — the browser parses it back to a plain &.
const resolved = '/.netlify/functions/img?id=ABC123_xyz-9&amp;w=1200';
assert(driveOut.includes('class="ogloszenia-img-block"'), 'img has ogloszenia-img-block class');
assert(driveOut.includes('src="' + resolved + '"'), 'img src set to resolved proxy url');
assert(!driveOut.includes('googleusercontent'), 'no direct third-party google url in output');
assert(driveOut.includes('loading="lazy"') && driveOut.includes('decoding="async"'), 'perf attrs present');
assert(!driveOut.includes('ogloszenia-img-frame') && !driveOut.includes('--img'), 'no blur-frame wrapper');

// 2. A text block still renders as <p> (unchanged behavior).
const textOut = renderBlocks(JSON.stringify([{ t: 'txt', c: 'Hello\n\nWorld' }]));
assert(textOut.includes('<p>Hello</p>') && textOut.includes('<p>World</p>'), 'text blocks render as paragraphs');

// 3. Legacy non-JSON body is passed through untouched.
assert(renderBlocks('<p>legacy</p>') === '<p>legacy</p>', 'legacy html passthrough');

// 4. PRIVACY: any foreign absolute url is DROPPED, not passed through. Passing it through would
//    make the visitor's browser fetch straight from a third party again (IP transfer without
//    consent) — exactly what the proxy exists to prevent. No <img> may be emitted at all.
const foreignOut = renderBlocks(JSON.stringify([{ t: 'img', u: 'https://example.com/plakat.jpg' }]));
assert(!foreignOut.includes('<img'), 'foreign absolute url emits no img at all');
assert(!foreignOut.includes('example.com'), 'foreign host never reaches the markup');

// 5. SECURITY: a hostile url that is NOT absolute still gets rendered (own-origin path), so it
//    must be HTML-escaped in the src — it cannot break out of the double-quoted attribute.
const evilOut = renderBlocks(JSON.stringify([{ t: 'img', u: '/upload/"><script>alert(1)</script>' }]));
assert(!evilOut.includes('<script>'), 'raw <script> neutralized (no literal <script>)');
assert(!evilOut.includes('"><'), 'attribute-break sequence "> neutralized');
assert(evilOut.includes('&lt;script&gt;'), 'script tag is HTML-escaped in src');
assert(evilOut.includes('&quot;'), 'double-quote in url is escaped to &quot;');

// 6. SECURITY: a hostile ABSOLUTE url is dropped before escaping ever matters — belt and braces.
const evilAbsOut = renderBlocks(JSON.stringify([{ t: 'img', u: 'http://x/"><script>alert(1)</script>' }]));
assert(!evilAbsOut.includes('<script>'), 'hostile absolute url: no literal <script>');
assert(!evilAbsOut.includes('<img'), 'hostile absolute url: no img emitted');

console.log('ok - renderBlocks plain-image + foreign-url drop + src escaping: all assertions passed');
