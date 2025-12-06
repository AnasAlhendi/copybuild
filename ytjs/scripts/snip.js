'use strict';
const fs=require('fs');
const js=fs.readFileSync('player.js','utf8');
const i=parseInt(process.argv[2],10)||0;
console.log(js.slice(Math.max(0,i-200), i+80).replace(/\n/g,' '));

