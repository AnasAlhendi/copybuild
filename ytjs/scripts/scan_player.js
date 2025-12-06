'use strict';
const fs = require('fs');
const js = fs.readFileSync('player.js','utf8');
const re = /join\((?:""|'')\)/g;
let m, c=0; const hits=[];
while ((m = re.exec(js))) { c++; if (hits.length < 5) hits.push(m.index); }
console.log('join("") hits:', c, hits);
// Try to find split in proximity
for (const i of hits) {
  const start = Math.max(0, i - 200);
  const snip = js.slice(start, i + 50);
  if (/split\(""\)/.test(snip)) {
    console.log('Nearby split found at', start);
    console.log(snip.replace(/\n/g,' '));
    break;
  }
}
console.log('has split double', js.includes('split("")'));
console.log('has split single', js.includes("split('')"));
