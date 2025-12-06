'use strict';

const { getText } = require('../../internal/net');
const os = require('os');
const fs = require('fs');
const path = require('path');

const vm = require('vm');
const cache = new Map(); // playerUrl -> { actions, fn }
const cacheDir = path.join(os.homedir() || '.', '.ytdljs');
const cacheFile = path.join(cacheDir, 'sigcache.json');
try {
  const raw = fs.readFileSync(cacheFile, 'utf8');
  const data = JSON.parse(raw);
  for (const k of Object.keys(data)) cache.set(k, data[k]);
} catch (_) {}

function extractPlayerUrl(html) {
  const m1 = html.match(/"jsUrl":"([^"]+base\.js)"/);
  if (m1) return m1[1].replace(/\\\//g, '/');
  const m2 = html.match(/"PLAYER_JS_URL":"([^"]+base\.js)"/);
  if (m2) return m2[1].replace(/\\\//g, '/');
  const m3 = html.match(/src\s*=\s*"([^"]+\/base\.js)"/);
  if (m3) return m3[1];
  return null;
}

function buildActions(js) {
  // Match transform function with arbitrary param name and allow whitespace
  let fnName = null; let param = null; let body = null;
  // Assigned function
  let m = js.match(/\b([a-zA-Z0-9$]+)\s*=\s*function\(([a-zA-Z0-9$]+)\)\{\s*\2\s*=\s*\2\.split\((?:""|'')\);([\s\S]*?)return\s+\2\.join\((?:""|'')\)\s*\}/);
  if (m) { fnName = m[1]; param = m[2]; body = m[3]; }
  // Named function
  if (!m) {
    m = js.match(/function\s+([a-zA-Z0-9$]+)\(([a-zA-Z0-9$]+)\)\{\s*\2\s*=\s*\2\.split\((?:""|'')\);([\s\S]*?)return\s+\2\.join\((?:""|'')\)\s*\}/);
    if (m) { fnName = m[1]; param = m[2]; body = m[3]; }
  }
  if (!m) return null;
  // Try object-based helpers
  let objName = null;
  let objBody = null;
  const objRefMatch = body.match(new RegExp('([a-zA-Z0-9$]+)\\.[a-zA-Z0-9$]+\\(' + param + ')'));
  if (objRefMatch) {
    objName = objRefMatch[1];
    const objMatch = js.match(new RegExp('(var|let|const)\\s+' + objName + '\\s*=\\s*\\{([\\s\\S]*?)\\};'));
    if (objMatch) objBody = objMatch[2];
  }
  const methods = {};
  if (objBody) {
    objBody.replace(/(?:["']?)([a-zA-Z0-9$]+)(?:["']?)\s*:\s*function\(a(?:,b)?\)\{([^}]*)\}/g, function(_, name, code){
      if (/\.reverse\(\)/.test(code)) methods[name] = 'reverse';
      else if (/a\.splice\(0,\s*b\)/.test(code)) methods[name] = 'splice';
      else if (/(?:var|let|const)?\s*[a-zA-Z$][\w$]*=a\[0\];a\[0\]=a\[b%a\.length\];a\[b%a\.length\]=[a-zA-Z$][\w$]*/.test(code)) methods[name] = 'swap';
      else if (/a\s*=\s*a\.slice\(b\)/.test(code)) methods[name] = 'slice'; // rotate-like
      return '';
    });
  }
  const actions = [];
  if (objName) {
    const callWithArgRe = new RegExp(objName + "\\.([a-zA-Z0-9$]+)\\(" + param + ",(\\d+)\\)", 'g');
    body.replace(callWithArgRe, function(_, m3, n){
      const op = methods[m3];
      const val = parseInt(n, 10) || 0;
      if (op) actions.push({ op, val });
      return '';
    });
    const callNoArgRe = new RegExp(objName + "\\.([a-zA-Z0-9$]+)\\(" + param + "\\)", 'g');
    body.replace(callNoArgRe, function(_, m4){
      const op = methods[m4];
      if (op) actions.push({ op, val: 0 });
      return '';
    });
  }
  // Fallback: inline helper functions
  if (!actions.length) {
    const helperMap = {};
    js.replace(/(?:var|let|const)\s+([a-zA-Z0-9$]+)\s*=\s*function\(a(?:,b)?\)\{([^}]*)\}/g, (_, name, code) => {
      if (/\.reverse\(\)/.test(code)) helperMap[name] = 'reverse';
      else if (/a\.splice\(0,\s*b\)/.test(code)) helperMap[name] = 'splice';
      else if (/(?:var|let|const)?\s*[a-zA-Z$][\w$]*=a\[0\];a\[0\]=a\[b%a\.length\];a\[b%a\.length\]=[a-zA-Z$][\w$]*/.test(code)) helperMap[name] = 'swap';
      else if (/a\s*=\s*a\.slice\(b\)/.test(code)) helperMap[name] = 'slice';
      return '';
    });
    body.replace(new RegExp('([a-zA-Z0-9$]+)\\(' + param + ',(\\d+)\\)', 'g'), (_, fn, n) => {
      const op = helperMap[fn];
      if (op) actions.push({ op, val: parseInt(n, 10) || 0 });
      return '';
    });
    body.replace(new RegExp('([a-zA-Z0-9$]+)\\(' + param + '\\)', 'g'), (_, fn) => {
      const op = helperMap[fn];
      if (op) actions.push({ op, val: 0 });
      return '';
    });
  }
  if (!actions.length) return null;
  return actions;
}

function applyActions(s, actions) {
  const a = s.split('');
  for (const step of actions) {
    const op = step.op; const val = step.val;
    if (op === 'reverse') a.reverse();
    else if (op === 'splice') a.splice(0, val);
    else if (op === 'slice') {
      // slice-like rotation: drop first n chars
      const b = a.slice(val);
      a.length = 0; Array.prototype.push.apply(a, b);
    }
    else if (op === 'swap') {
      const idx = val % a.length;
      const c = a[0]; a[0] = a[idx]; a[idx] = c;
    }
  }
  return a.join('');
}

function buildEvalFn(js, fnName, objName) {
  if (!fnName || !objName) return null;
  const objMatch = js.match(new RegExp('(var|let|const)\\s+' + objName + '\\s*=\\s*\\{([\\s\\S]*?)\\};'));
  if (!objMatch) return null;
  const objDecl = objMatch[0];
  // Extract full function text
  let fnText = null;
  const assignStart = js.indexOf(fnName + "=function(");
  if (assignStart !== -1) {
    let depth = 0;
    for (let i = assignStart + (fnName + "=function(a){").length - 1; i < js.length; i++) {
      const ch = js[i];
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) { fnText = js.slice(assignStart, i + 1); break; }
      }
    }
  }
  if (!fnText) {
    const namedMatch = js.match(new RegExp('function\\s+' + fnName + '\\([a-zA-Z0-9$]+\\)\\{([\\s\\S]*?)\\}'));
    if (namedMatch) fnText = 'function ' + fnName + '(a){' + namedMatch[1] + '}';
  }
  if (!fnText) return null;
  const code = `${objDecl}\n${fnText}\nfunction transform(a){return ${fnName}(a);} transform;`;
  try {
    const fn = vm.runInNewContext(code, {}, { timeout: 1000 });
    if (typeof fn === 'function') return fn;
  } catch (_) {}
  return null;
}

async function loadTransform(html, baseUrl, opts = {}) {
  const playerRel = extractPlayerUrl(html);
  if (!playerRel) throw new Error('YouTube: player JS URL not found');
  const playerUrl = playerRel.startsWith('http') ? playerRel : new URL(playerRel, baseUrl).toString();
  if (cache.has(playerUrl)) return cache.get(playerUrl);
  const js = await getText(playerUrl, { proxy: opts.proxy, timeout: opts.timeout, family: opts.family, cookieJar: opts.cookieJar });
  let actions = buildActions(js);
  let tr = null;
  if (!actions) {
    // Try to eval the transform function
    const fnNameMatch = js.match(/\b([a-zA-Z0-9$]+)\s*=\s*function\([a-zA-Z0-9$]+\)\{\s*[a-zA-Z0-9$]+\s*=\s*[a-zA-Z0-9$]+\.split\(\"\"\);/) || js.match(/function\s+([a-zA-Z0-9$]+)\([a-zA-Z0-9$]+\)\{\s*[a-zA-Z0-9$]+\s*=\s*[a-zA-Z0-9$]+\.split\(\"\"\);/);
    const fnName = fnNameMatch && fnNameMatch[1];
    // Guess obj name from usage
    let body = null;
    let objName = null;
    if (fnName) {
      const idx = js.indexOf(fnName + "=function(");
      if (idx !== -1) {
        const endMarker = 'join(\"\")}';
        const end = js.indexOf(endMarker, idx);
        if (end !== -1) body = js.slice(idx, end + endMarker.length);
      }
      if (!body) {
        const m2 = js.match(new RegExp('function\\s+' + fnName + '\\([a-zA-Z0-9$]+\\)\\{[\\s\\S]*?return\\s+[a-zA-Z0-9$]+\\.join\\(\\"\\"\\)\\}'));
        if (m2) body = m2[0];
      }
      if (body) {
        const ref = body.match(/([a-zA-Z0-9$]+)\.[a-zA-Z0-9$]+\([a-zA-Z0-9$]+/);
        objName = ref && ref[1];
      }
    }
    const fn = buildEvalFn(js, fnName, objName);
    if (fn) tr = { fn, url: playerUrl };
  } else {
    tr = { actions, url: playerUrl };
  }
  if (!tr) throw new Error('YouTube: could not parse signature actions');
  cache.set(playerUrl, tr);
  try {
    fs.mkdirSync(cacheDir, { recursive: true });
    const dump = {};
    for (const [k, v] of cache.entries()) dump[k] = v;
    fs.writeFileSync(cacheFile, JSON.stringify(dump));
  } catch (_) {}
  return tr;
}

async function decipher(html, watchUrl, s, opts = {}) {
  const tr = await loadTransform(html, watchUrl, opts);
  if (tr.actions) return applyActions(s, tr.actions);
  if (tr.fn) return tr.fn(s);
  throw new Error('YouTube: no signature transform available');
}

module.exports = { decipher };
