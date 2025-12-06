'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const cachePath = path.join(os.homedir() || '.', '.ytdljs', 'cache.json');

function readCache() {
  try { return JSON.parse(fs.readFileSync(cachePath, 'utf8')); } catch (_) { return {}; }
}

function writeCache(data) {
  try {
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    fs.writeFileSync(cachePath, JSON.stringify(data));
  } catch (_) {}
}

function getCached(key, ttlMs) {
  const data = readCache();
  const ent = data[key];
  if (!ent) return null;
  if (Date.now() - (ent.t || 0) > ttlMs) return null;
  return ent.v;
}

function setCached(key, value) {
  const data = readCache();
  data[key] = { v: value, t: Date.now() };
  writeCache(data);
}

module.exports = { getCached, setCached };

