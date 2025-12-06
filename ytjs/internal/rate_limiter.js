'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

class TokenBucket {
  constructor() {
    this.rate = Infinity; // bytes per second
    this.tokens = Infinity;
    this.last = Date.now();
    this.queue = [];
    this.persistPath = null;
  }
  setRate(bps, persistPath = null) {
    if (!bps || bps <= 0) {
      this.rate = Infinity;
      this.tokens = Infinity;
      this.persistPath = null;
      return;
    }
    this.rate = bps;
    this.tokens = bps;
    this.last = Date.now();
    this.persistPath = persistPath;
    if (this.persistPath) this._persist();
  }
  _persist() {
    if (!this.persistPath) return;
    try {
      fs.mkdirSync(path.dirname(this.persistPath), { recursive: true });
      fs.writeFileSync(this.persistPath, JSON.stringify({ rate: this.rate, tokens: this.tokens, last: this.last }));
    } catch (_) {}
  }
  _load() {
    if (!this.persistPath) return;
    try {
      const raw = fs.readFileSync(this.persistPath, 'utf8');
      const data = JSON.parse(raw);
      if (data && typeof data.rate === 'number') {
        this.rate = data.rate;
        this.tokens = data.tokens;
        this.last = data.last;
      }
    } catch (_) {}
  }
  _refill() {
    const now = Date.now();
    const elapsed = (now - this.last) / 1000;
    if (elapsed > 0 && this.rate < Infinity) {
      this.tokens = Math.min(this.rate, this.tokens + this.rate * elapsed);
      this.last = now;
    }
  }
  async acquire(n) {
    if (this.rate === Infinity) return;
    // crude cross-process sync: read file, update, write
    if (this.persistPath) this._load();
    this._refill();
    if (this.tokens >= n) {
      this.tokens -= n;
      if (this.persistPath) this._persist();
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
    return this.acquire(n);
  }
}

const globalLimiter = new TokenBucket();
const defaultPersist = path.join(os.homedir() || '.', '.ytdljs', 'ratelimit.json');

module.exports = { globalLimiter, defaultPersist };
