// Standalone unit test for renderBlocks() — run with: node js/ogloszenia.renderBlocks.test.js
// The module is an IIFE that assigns window.PMK_Ogloszenia. We shim window, load it, then assert.
'use strict';
const assert = require('assert');

global.window = {};
require('./ogloszenia.js'); // IIFE runs on require, sets global.window.PMK_Ogloszenia

const { renderBlocks } = global.window.PMK_Ogloszenia;

// 1. A Drive image block renders as a plain <img> (natural aspect, no crop, no blur frame),
//    with the resolved lh3 URL and perf attributes.
const driveBody = JSON.stringify([
  { t: 'img', u: 'https://drive.google.com/file/d/ABC123_xyz-9/view' }
]);
const driveOut = renderBlocks(driveBody);
const resolved = 'https://lh3.googleusercontent.com/d/ABC123_xyz-9=w1200';
assert(driveOut.includes('class="ogloszenia-img-block"'), 'img has ogloszenia-img-block class');
assert(driveOut.includes('src="' + resolved + '"'), 'img src set to resolved url');
assert(driveOut.includes('loading="lazy"') && driveOut.includes('decoding="async"'), 'perf attrs present');
assert(!driveOut.includes('ogloszenia-img-frame') && !driveOut.includes('--img'), 'no blur-frame wrapper');

// 2. A text block still renders as <p> (unchanged behavior).
const textOut = renderBlocks(JSON.stringify([{ t: 'txt', c: 'Hello\n\nWorld' }]));
assert(textOut.includes('<p>Hello</p>') && textOut.includes('<p>World</p>'), 'text blocks render as paragraphs');

// 3. Legacy non-JSON body is passed through untouched.
assert(renderBlocks('<p>legacy</p>') === '<p>legacy</p>', 'legacy html passthrough');

// 4. SECURITY: a hostile raw (non-Drive) url is HTML-escaped in the src — it cannot break out
//    of the double-quoted attribute or inject markup.
const evilOut = renderBlocks(JSON.stringify([{ t: 'img', u: 'http://x/"><script>alert(1)</script>' }]));
assert(!evilOut.includes('<script>'), 'raw <script> neutralized (no literal <script>)');
assert(!evilOut.includes('"><'), 'attribute-break sequence "> neutralized');
assert(evilOut.includes('&lt;script&gt;'), 'script tag is HTML-escaped in src');
assert(evilOut.includes('&quot;'), 'double-quote in url is escaped to &quot;');

console.log('ok - renderBlocks plain-image + src escaping: all assertions passed');
