'use strict';
const fs = require('fs');
const { decipher } = require('../internal/youtube/sig');
(async () => {
  const html = fs.readFileSync('watch.html','utf8');
  const out = await decipher(html, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'abcdefghijklmnopqrstuvwxyz');
  console.log('decipher ok, sample=', out);
})().catch((e)=>{ console.error('decipher failed:', e && e.message || String(e)); process.exit(1); });

