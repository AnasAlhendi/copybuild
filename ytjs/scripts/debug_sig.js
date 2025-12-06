'use strict';

const fs = require('fs');

const js = fs.readFileSync('player.js', 'utf8');
const re1 = /([\w$]+)\s*=\s*function\(a\)\{\s*a\s*=\s*a\.split\(\"\"\);[\s\S]*?return a\.join\(\"\"\)\s*\}/;
const re2 = /function\s+([\w$]+)\(a\)\{\s*a\s*=\s*a\.split\(\"\"\);([\s\S]*?)return a\.join\(\"\"\)\s*\}/;
const m = re1.exec(js) || re2.exec(js);
console.log('fnNameMatch?', !!m, m && m[1]);
if (m) {
  const name = m[1];
  const idx = js.indexOf(name + '=function(a){');
  console.log('assign idx', idx);
  console.log('snippet', js.slice(Math.max(0, idx - 40), idx + 200));
}

// Try to locate object name from body
if (m) {
  let body = null;
  const idx = js.indexOf(m[1] + '=function(a){a=a.split(""");');
  if (idx !== -1) {
    const endMarker = 'return a.join(""")}'
    const end = js.indexOf(endMarker, idx);
    if (end !== -1) body = js.slice(idx, end + endMarker.length);
  }
  if (!body) {
    const reBody = new RegExp('function\\s+' + m[1] + '\\(a\\)\\{\\s*a=a\\.split\\(\\"\\"\\);([\\s\\S]*?)return a\\.join\\(\\"\\"\\)\\}');
    const b = reBody.exec(js);
    if (b) body = b[0];
  }
  if (body) {
    const ref = /([\w$]+)\.[\w$]+\(a/.exec(body);
    console.log('objRef', ref && ref[1]);
  }
}

