'use strict';
const { getText } = require('../internal/net');
const fs = require('fs');
(async () => {
  const url = process.argv[2] || 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
  const html = await getText(url, { timeout: 20000 });
  fs.writeFileSync('watch.html', html);
  console.log('wrote watch.html', html.length);
})().catch((e) => { console.error(e && e.stack || String(e)); process.exit(1); });

