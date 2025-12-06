'use strict';
const fs = require('fs');
const js = fs.readFileSync('player.js','utf8');

function findCandidates(src){
  const res=[];
  for(let i=0;i<src.length;i++){
    if(src.startsWith('function', i) || /[\w$]+\s*=\s*function\(/.test(src.slice(i, i+80)) || /[\w$]+\s*=\s*\([\w$,\s]*\)\s*=>\s*\{/.test(src.slice(i, i+120))){
      // find function header
      let headerStart = i;
      // shift start to name= if it's an assignment form
      let m = /([\w$]+)\s*=\s*function\(/.exec(src.slice(i, i+120));
      if (m) headerStart = i + m.index;
      if (!m) {
        m = /([\w$]+)\s*=\s*\([\w$,\s]*\)\s*=>\s*\{/.exec(src.slice(i, i+200));
        if (m) headerStart = i + m.index;
      }
      const headEnd = src.indexOf('{', i);
      if(headEnd === -1) break;
      // find matching brace
      let depth=0; let end=-1;
      for(let k=headEnd; k<src.length; k++){
        const ch = src[k];
        if(ch==='{' ) depth++;
        else if(ch==='}'){ depth--; if(depth===0){ end=k; break; } }
      }
      if(end>0){
        const body = src.slice(headEnd+1,end);
        if(/split\((?:""|'')\)/.test(body) && /join\((?:""|'')\)/.test(body)){
          res.push({start:headerStart, end, header: src.slice(headerStart, headEnd+1).replace(/\n/g,' '), body: body.slice(0,300).replace(/\n/g,' ')});
        }
        i=end;
      }
    }
  }
  return res;
}

const c = findCandidates(js);
console.log('candidates:', c.length);
for(const x of c.slice(0,3)){
  console.log('---');
  console.log(x.header);
  console.log(x.body);
}
