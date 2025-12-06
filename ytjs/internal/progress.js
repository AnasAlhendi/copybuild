'use strict';

class ProgressTracker {
  constructor({ totalBytes = null, totalUnits = null, label = '' } = {}) {
    this.start = Date.now();
    this.bytes = 0;
    this.totalBytes = totalBytes;
    this.unitsDone = 0;
    this.totalUnits = totalUnits;
    this.label = label;
  }
  setTotalBytes(n) { this.totalBytes = n; }
  setTotalUnits(n) { this.totalUnits = n; }
  addBytes(n) { this.bytes += n; }
  unitDone() { this.unitsDone += 1; }
  line() {
    const now = Date.now();
    const elapsed = (now - this.start) / 1000;
    const speed = this.bytes / Math.max(0.001, elapsed);
    const kbps = (speed / 1024).toFixed(1);
    let prefix = this.label ? `[${this.label}] ` : '';
    if (this.totalBytes) {
      const pct = ((this.bytes / this.totalBytes) * 100).toFixed(1);
      const remain = this.totalBytes - this.bytes;
      const eta = remain / Math.max(1, speed);
      return `${prefix}${pct}% ${kbps} KiB/s ETA ${Math.max(0, Math.round(eta))}s`;
    }
    if (this.totalUnits) {
      const pct = ((this.unitsDone / this.totalUnits) * 100).toFixed(1);
      // crude ETA from units
      const eta = elapsed * (this.totalUnits - this.unitsDone) / Math.max(1, this.unitsDone);
      return `${prefix}${pct}% ${kbps} KiB/s ETA ${Math.max(0, Math.round(eta))}s`;
    }
    const kb = (this.bytes / 1024).toFixed(1);
    return `${prefix}${kb} KiB ${kbps} KiB/s`;
  }
}

module.exports = { ProgressTracker };

