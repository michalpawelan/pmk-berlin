// Standalone unit test for renderBlocks() — run with: node js/ogloszenia.renderBlocks.test.js
// The module is an IIFE that assigns window.PMK_Ogloszenia. We shim window, load it, then assert.
'use strict';
const assert = require('assert');

global.window = {};
require('./ogloszenia.js'); // IIFE runs on require, sets global.window.PMK_Ogloszenia

const { renderBlocks } = global.window.PMK_Ogloszenia;

// 1. A Drive image block is wrapped in the ambient frame, with the URL in BOTH src and --img.
const driveBody = JSON.stringify([
  { t: 'img', u: 'https://drive.google.com/file/d/ABC123_xyz-9/view' }
]);
const driveOut = renderBlocks(driveBody);
const resolved = 'https://lh3.googleusercontent.com/d/ABC123_xyz-9=w1200';
assert(driveOut.includes('class="ogloszenia-img-frame"'), 'frame wrapper present');
assert(driveOut.includes("--img:url('" + resolved + "')"), '--img custom property set to resolved url');
assert(driveOut.includes('src="' + resolved + '"'), 'img src set to resolved url');
assert(driveOut.includes('class="ogloszenia-img-block"'), 'inner img keeps its class');
assert(driveOut.includes('loading="lazy"') && driveOut.includes('decoding="async"'), 'perf attrs present');

// 2. A text block still renders as <p> (unchanged behavior).
const textOut = renderBlocks(JSON.stringify([{ t: 'txt', c: 'Hello\n\nWorld' }]));
assert(textOut.includes('<p>Hello</p>') && textOut.includes('<p>World</p>'), 'text blocks render as paragraphs');

// 3. Legacy non-JSON body is passed through untouched.
assert(renderBlocks('<p>legacy</p>') === '<p>legacy</p>', 'legacy html passthrough');

// 4. SECURITY: a hostile raw (non-Drive) url cannot break out of the CSS url('') or the style attribute.
const evilBody = JSON.stringify([
  { t: 'img', u: "http://x/a')}#bad{(\"q" }
]);
const evilOut = renderBlocks(evilBody);
const styleMatch = evilOut.match(/style="([^"]*)"/);
assert(styleMatch, 'style attribute present and not broken by a double-quote');
const styleVal = styleMatch[1];                      // --img:url('....')
// Extract the escaped URL sitting between the wrapper's  url('  and its final  ')
const innerStart = styleVal.indexOf("url('") + 5;
const innerEnd = styleVal.lastIndexOf("')");
const inner = styleVal.slice(innerStart, innerEnd);
assert(inner.length > 0, 'escaped url content present');
assert(!/['"()<>]/.test(inner), 'all CSS/HTML-dangerous chars in the url are hex-escaped');

console.log('ok - renderBlocks ambient-frame + escaping: all assertions passed');
