'use strict';

const { getText } = require('../internal/net');
const fs = require('fs');

async function main() {
  const url = process.argv[2] || 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
  const html = await getText(url, { timeout: 20000 });
  const m1 = html.match(/\"jsUrl\":\"([^\"]+base\.js)\"/);
  const m2 = html.match(/\"PLAYER_JS_URL\":\"([^\"]+base\.js)\"/);
  const m3 = html.match(/src\s*=\s*\"([^\"]+\/base\.js)\"/);
  const rel = (m1 && m1[1]) || (m2 && m2[1]) || (m3 && m3[1]) || null;
  console.log('jsUrl rel =', rel);
  if (!rel) return 2;
  const abs = rel.startsWith('http') ? rel : new URL(rel, url).toString();
  console.log('jsUrl abs =', abs);
  const js = await getText(abs, { timeout: 20000 });
  console.log('player.js length =', js.length);
  fs.writeFileSync('player.js', js);
  return 0;
}

main().then((c) => process.exit(c)).catch((e) => { console.error(e && e.stack || String(e)); process.exit(1); });

