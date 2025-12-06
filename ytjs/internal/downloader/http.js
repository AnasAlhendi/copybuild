'use strict';

const fs = require('fs');
const http = require('http');
const https = require('https');
const { URL } = require('url');
const { parseProxy } = require('../net');
const { globalLimiter } = require('../rate_limiter');
const tls = require('tls');

function getClient(url) {
  const u = new URL(url);
  return u.protocol === 'https:' ? https : http;
}

function parseRate(rate) {
  if (!rate) return null;
  const m = String(rate).match(/^(\d+(?:\.\d+)?)([KkMmGg])?$/);
  if (!m) return parseInt(rate, 10) || null;
  const n = parseFloat(m[1]);
  const unit = (m[2] || '').toUpperCase();
  const mult = unit === 'G' ? 1024 * 1024 * 1024 : unit === 'M' ? 1024 * 1024 : unit === 'K' ? 1024 : 1;
  return Math.max(1, Math.floor(n * mult));
}

function head(url, { headers = {}, proxy = null, timeout = 30000, family = undefined } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const client = u.protocol === 'https:' ? https : http;
    const p = proxy && parseProxy(proxy);
    if (p && u.protocol === 'https:') {
      const connectHeaders = {};
      if (p.auth && p.auth.header) connectHeaders['Proxy-Authorization'] = p.auth.header;
      const creq = http.request({ method: 'CONNECT', host: p.host, port: p.port, path: u.hostname + ':' + (u.port || 443), headers: connectHeaders });
      creq.once('connect', (cres, socket) => {
        if (cres.statusCode !== 200) { socket.destroy(); return reject(new Error('Proxy CONNECT failed: ' + cres.statusCode)); }
        const secure = tls.connect({ socket, servername: u.hostname });
        const reqLines = [`HEAD ${u.pathname + (u.search || '')} HTTP/1.1`, `Host: ${u.hostname}`, 'Connection: close'];
        for (const [k, v] of Object.entries(headers)) reqLines.push(`${k}: ${v}`);
        reqLines.push('', '');
        secure.write(reqLines.join('\r\n'));
        let buf = '';
        secure.on('data', (chunk) => { buf += chunk.toString('utf8'); });
        secure.on('end', () => {
          const idx = buf.indexOf('\r\n\r\n');
          const head = idx !== -1 ? buf.slice(0, idx) : buf;
          const lines = head.split('\r\n');
          const statusLine = lines.shift() || '';
          const m = statusLine.match(/^HTTP\/\d\.\d\s+(\d+)/);
          const statusCode = m ? parseInt(m[1], 10) : 0;
          const h = {};
          for (const ln of lines) {
            const i = ln.indexOf(':');
            if (i > 0) h[ln.slice(0, i).toLowerCase()] = ln.slice(i + 1).trim();
          }
          resolve({ statusCode, headers: h });
        });
        secure.on('error', reject);
      });
      creq.on('error', reject);
      creq.end();
      return;
    }
    const opts = p ? { method: 'HEAD', host: p.host, port: p.port, path: url, headers: { ...headers, ...(p.auth && p.auth.header ? { 'Proxy-Authorization': p.auth.header } : {}) }, family } : { method: 'HEAD', headers, family };
    const req = (p ? http : client).request(p ? opts : url, p ? undefined : opts, (res) => {
      resolve({ statusCode: res.statusCode, headers: res.headers });
    });
    req.on('error', reject);
    req.setTimeout(timeout, () => { try { req.destroy(new Error('Timeout')); } catch (_) {} });
    req.end();
  });
}

async function parallelDownload(url, filepath, { verbose, headers = {}, limitRate = null, proxy = null, timeout = 30000, family = undefined, connections = 4 } = {}) {
  // HEAD to get size and check ranges
  const h = await head(url, { headers, proxy, timeout, family });
  const len = parseInt(h.headers['content-length'] || '0', 10);
  const acceptRanges = /bytes/i.test(String(h.headers['accept-ranges'] || ''));
  if (!len || !acceptRanges) {
    // Fallback to single download
    return download(url, filepath, { verbose, headers, resume: true, limitRate, proxy, timeout, family, connections: 1 });
  }
  const partPath = filepath + '.part';
  const total = len;
  const parts = Math.max(1, connections | 0);
  const ranges = [];
  const slice = Math.ceil(total / parts);
  for (let i = 0; i < parts; i++) {
    const start = i * slice;
    let end = Math.min(total - 1, (i + 1) * slice - 1);
    if (start > end) break;
    ranges.push({ i, start, end });
  }
  if (verbose) process.stderr.write(`[download] parallel x${ranges.length} ${url} -> ${filepath} (${total} bytes)\n`);
  let received = 0; const startTime = Date.now(); let lastTick = 0;
  const mkPart = (i) => `${partPath}.${i}`;
  await Promise.all(ranges.map(({ i, start, end }) => new Promise((resolve, reject) => {
    // resume support per part
    let curStart = start;
    try {
      const exist = fs.existsSync(mkPart(i)) ? fs.statSync(mkPart(i)).size : 0;
      if (exist > 0) curStart = Math.min(end + 1, start + exist);
    } catch (_) {}
    if (curStart > end) return resolve();
    const reqHeaders = { ...headers, Range: `bytes=${curStart}-${end}` };
    const u = new URL(url);
    const client = u.protocol === 'https:' ? https : http;
    const p = proxy && parseProxy(proxy);
    const writer = fs.createWriteStream(mkPart(i), { flags: curStart > start ? 'a' : 'w' });
    const handle = (res) => {
      if (res.statusCode !== 206 && res.statusCode !== 200) { writer.close(); return reject(new Error('HTTP ' + res.statusCode)); }
      res.on('data', async (chunk) => {
        await globalLimiter.acquire(chunk.length);
        received += chunk.length;
        if (!writer.destroyed && !writer.writableEnded) writer.write(chunk);
        if (verbose) {
          const now = Date.now();
          if (now - lastTick > 500) {
            const elapsed = (now - startTime) / 1000;
            const speed = received / Math.max(0.001, elapsed);
            const pct = ((received / total) * 100).toFixed(1);
            const remain = total - received;
            const eta = remain / Math.max(1, speed);
            process.stderr.write(`[download] ${pct}% ${(speed/1024).toFixed(1)} KiB/s ETA ${Math.max(0, Math.round(eta))}s\r`);
            lastTick = now;
          }
        }
      });
      res.on('end', () => { writer.end(); });
      res.on('error', (e) => { try { writer.close(); } catch (_) {}; reject(e); });
    };
    if (p && u.protocol === 'https:') {
      const connectHeaders = {};
      if (p.auth && p.auth.header) connectHeaders['Proxy-Authorization'] = p.auth.header;
      const creq = http.request({ method: 'CONNECT', host: p.host, port: p.port, path: u.hostname + ':' + (u.port || 443), headers: connectHeaders });
      creq.once('connect', (cres, socket) => {
        if (cres.statusCode !== 200) { socket.destroy(); return reject(new Error('Proxy CONNECT failed: ' + cres.statusCode)); }
        const secure = tls.connect({ socket, servername: u.hostname });
        const pathAndQuery = u.pathname + (u.search || '');
        const reqLines = [`GET ${pathAndQuery} HTTP/1.1`, `Host: ${u.hostname}`, 'Connection: close'];
        for (const [k, v] of Object.entries(reqHeaders)) reqLines.push(`${k}: ${v}`);
        reqLines.push('', '');
        secure.write(reqLines.join('\r\n'));
        let headerBuf = '';
        let headersParsed = false;
        let statusCode = 0;
        secure.on('data', async (chunk) => {
          if (!headersParsed) {
            headerBuf += chunk.toString('utf8');
            const idx = headerBuf.indexOf('\r\n\r\n');
            if (idx !== -1) {
              const head = headerBuf.slice(0, idx);
              const rest = Buffer.from(headerBuf.slice(idx + 4), 'utf8');
              const lines = head.split('\r\n');
              const statusLine = lines.shift() || '';
              const m = statusLine.match(/^HTTP\/\d\.\d\s+(\d+)/);
              statusCode = m ? parseInt(m[1], 10) : 0;
              headersParsed = true;
              if (statusCode !== 200 && statusCode !== 206) { secure.destroy(); return reject(new Error('HTTP ' + statusCode)); }
              if (rest.length) { await globalLimiter.acquire(rest.length); if (!writer.destroyed && !writer.writableEnded) writer.write(rest); }
            }
          } else { await globalLimiter.acquire(chunk.length); if (!writer.destroyed && !writer.writableEnded) writer.write(chunk); }
        });
        secure.on('end', () => writer.end());
        secure.on('error', reject);
      });
      creq.on('error', reject);
      creq.end();
    } else {
      const opts = p ? { host: p.host, port: p.port, path: url, headers: { ...reqHeaders, ...(p.auth && p.auth.header ? { 'Proxy-Authorization': p.auth.header } : {}) }, family } : { headers: reqHeaders, family };
      (p ? http : client).get(p ? opts : url, p ? undefined : opts, handle).on('error', reject).setTimeout(timeout, function(){ try { this.destroy(new Error('Timeout')); } catch (_) {} });
    }
    writer.on('finish', resolve);
  })));
  // Stitch parts in order
  await new Promise((resolve, reject) => {
    const out = fs.createWriteStream(partPath, { flags: 'w' });
    let idx = 0;
    const appendNext = () => {
      if (idx >= ranges.length) return out.end();
      const rd = fs.createReadStream(`${partPath}.${idx}`);
      rd.on('error', reject);
      rd.on('end', () => { idx++; appendNext(); });
      rd.pipe(out, { end: false });
    };
    out.on('finish', resolve);
    out.on('error', reject);
    appendNext();
  });
  try { fs.renameSync(partPath, filepath); } catch (_) {}
  // Cleanup parts
  for (const { i } of ranges) { try { fs.unlinkSync(`${partPath}.${i}`); } catch (_) {} }
}

function download(url, filepath, { verbose, headers = {}, resume = true, limitRate = null, proxy = null, timeout = 30000, family = undefined, connections = 1 } = {}) {
  if ((connections | 0) > 1) {
    return parallelDownload(url, filepath, { verbose, headers, limitRate, proxy, timeout, family, connections });
  }
  // Single-connection path
  return new Promise((resolve, reject) => {
    const client = getClient(url);
    const partPath = filepath + '.part';
    let startAt = 0;
    if (resume && fs.existsSync(partPath)) {
      try { startAt = fs.statSync(partPath).size; } catch (_) { startAt = 0; }
    }
    const out = fs.createWriteStream(partPath, { flags: startAt > 0 ? 'a' : 'w' });
    const reqHeaders = { ...headers };
    if (startAt > 0) reqHeaders.Range = `bytes=${startAt}-`;
    const p = proxy && parseProxy(proxy);
    const isHttps = new URL(url).protocol === 'https:';
    if (p && isHttps) {
      // Manual CONNECT and stream download
      const u = new URL(url);
      const connectHeaders = {};
      if (p.auth && p.auth.header) connectHeaders['Proxy-Authorization'] = p.auth.header;
      const creq = http.request({ method: 'CONNECT', host: p.host, port: p.port, path: u.hostname + ':' + (u.port || 443), headers: connectHeaders });
      creq.once('connect', (cres, socket) => {
        if (cres.statusCode !== 200) {
          socket.destroy();
          return reject(new Error('Proxy CONNECT failed: ' + cres.statusCode));
        }
        const secure = tls.connect({ socket, servername: u.hostname });
        const pathAndQuery = u.pathname + (u.search || '');
        const reqLines = [`GET ${pathAndQuery} HTTP/1.1`, `Host: ${u.hostname}`, 'Connection: close'];
        for (const [k, v] of Object.entries(reqHeaders)) reqLines.push(`${k}: ${v}`);
        reqLines.push('', '');
        secure.write(reqLines.join('\r\n'));
        secure.setTimeout(timeout, () => { secure.destroy(new Error('Timeout')); });
        let headerBuf = '';
        let headersParsed = false;
        let statusCode = 0;
        secure.on('data', async (chunk) => {
          if (!headersParsed) {
            headerBuf += chunk.toString('utf8');
            const idx = headerBuf.indexOf('\r\n\r\n');
            if (idx !== -1) {
              const head = headerBuf.slice(0, idx);
              const rest = Buffer.from(headerBuf.slice(idx + 4), 'utf8');
              const lines = head.split('\r\n');
              const statusLine = lines.shift() || '';
              const m = statusLine.match(/^HTTP\/\d\.\d\s+(\d+)/);
              statusCode = m ? parseInt(m[1], 10) : 0;
              headersParsed = true;
              if (statusCode !== 200 && statusCode !== 206) {
                secure.destroy();
                return reject(new Error('HTTP ' + statusCode));
              }
              if (rest.length) {
                await globalLimiter.acquire(rest.length);
                out.write(rest);
              }
            }
          } else {
            await globalLimiter.acquire(chunk.length);
            out.write(chunk);
          }
        });
        secure.on('end', () => out.end());
        secure.on('error', reject);
      });
      creq.on('error', reject);
      creq.end();
      out.on('finish', () => {
        out.close(() => {
          try { fs.renameSync(partPath, filepath); } catch (_) {}
          resolve();
        });
      });
      return;
    }
    const opts = p ? { host: p.host, port: p.port, path: url, headers: { ...reqHeaders, ...(p.auth && p.auth.header ? { 'Proxy-Authorization': p.auth.header } : {}) }, family } : { headers: reqHeaders, family };
    const req = (p ? http : client).get(p ? opts : url, p ? undefined : opts, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        out.close();
        return resolve(download(res.headers.location, filepath, { verbose, headers, resume, limitRate, proxy, timeout, family }));
      }
      if (res.statusCode !== 200 && res.statusCode !== 206) {
        out.close();
        return reject(new Error('HTTP ' + res.statusCode));
      }
      const len = parseInt(res.headers['content-length'] || '0', 10);
      if (verbose) {
        process.stderr.write(`[download] ${url} -> ${filepath} (${isNaN(len) ? 'unknown' : len + ' bytes'})\n`);
      }
      const startTime = Date.now();
      let received = 0;
      let lastTick = Date.now();
      const maxBps = parseRate(limitRate);
      let bytesThisWindow = 0;
      let windowStart = Date.now();
      res.on('data', async (chunk) => {
        await globalLimiter.acquire(chunk.length);
        received += chunk.length;
        bytesThisWindow += chunk.length;
        if (maxBps) {
          const now = Date.now();
          const elapsed = (now - windowStart) / 1000;
          if (elapsed > 0 && bytesThisWindow / elapsed > maxBps) {
            const target = bytesThisWindow / maxBps; // seconds
            const sleepMs = Math.min(250, Math.max(0, target * 1000 - (now - windowStart)));
            if (sleepMs > 0) {
              res.pause();
              setTimeout(() => { windowStart = Date.now(); bytesThisWindow = 0; res.resume(); }, sleepMs);
            }
          }
        }
        if (verbose) {
          const now = Date.now();
          if (now - lastTick > 500) {
            let line = '[download] ';
            if (len > 0) {
              const pct = ((received / len) * 100).toFixed(1);
              line += `${pct}% `;
              const elapsed = (now - startTime) / 1000;
              const speed = received / Math.max(0.001, elapsed);
              const remain = len - received;
              const eta = remain / Math.max(1, speed);
              const kbps = (speed / 1024).toFixed(1);
              line += `${kbps} KiB/s ETA ${Math.max(0, Math.round(eta))}s`;
            } else {
              const kb = (received / 1024).toFixed(1);
              line += `${kb} KiB`;
            }
            process.stderr.write(line + "\r");
            lastTick = now;
          }
        }
      });
      res.pipe(out);
      out.on('finish', () => {
        out.close(() => {
          try { fs.renameSync(partPath, filepath); } catch (_) {}
          resolve();
        });
      });
    });
    req.on('error', (err) => {
      try { out.close(); } catch (_) {}
      reject(err);
    });
  });
}

module.exports = { download };
