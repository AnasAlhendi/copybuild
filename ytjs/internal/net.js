'use strict';

const http = require('http');
const https = require('https');
const tls = require('tls');
const { connectSocks5 } = require('./socks5');
const { URL } = require('url');

function getClient(url) {
  const u = new URL(url);
  return u.protocol === 'https:' ? https : http;
}

function parseProxy(proxyUrl) {
  try {
    const u = new URL(proxyUrl);
    if (u.protocol === 'http:') {
      const auth = u.username ? { header: 'Basic ' + Buffer.from(decodeURIComponent(u.username) + ':' + decodeURIComponent(u.password || '')).toString('base64') } : null;
      return { type: 'http', host: u.hostname, port: u.port ? parseInt(u.port, 10) : 80, auth };
    }
    if (u.protocol === 'socks5:') {
      const auth = u.username ? { username: decodeURIComponent(u.username), password: decodeURIComponent(u.password || '') } : null;
      return { type: 'socks5', host: u.hostname, port: u.port ? parseInt(u.port, 10) : 1080, auth };
    }
    return null;
  } catch (_) {
    return null;
  }
}

function requestViaConnect(urlStr, proxy, { method = 'GET', headers = {}, timeout = 30000 } = {}) {
  return new Promise((resolve, reject) => {
    try {
      const u = new URL(urlStr);
      const host = u.hostname;
      const port = u.port ? parseInt(u.port, 10) : (u.protocol === 'https:' ? 443 : 80);
      const path = u.pathname + (u.search || '');
      const p = parseProxy(proxy);
      if (!p) return reject(new Error('Invalid proxy for CONNECT'));
      const connectHeaders = {};
      if (p.auth && p.auth.header) connectHeaders['Proxy-Authorization'] = p.auth.header;
      const connectReq = http.request({ method: 'CONNECT', host: p.host, port: p.port, path: host + ':' + port, headers: connectHeaders });
      connectReq.once('connect', (res, socket) => {
        if (res.statusCode !== 200) {
          socket.destroy();
          return reject(new Error('Proxy CONNECT failed: ' + res.statusCode));
        }
        const secure = tls.connect({ socket, servername: host });
        let buf = '';
        const bodyBufs = [];
        let headersParsed = false;
        const reqLines = [`${method} ${path} HTTP/1.1`, `Host: ${host}`, 'Connection: close'];
        for (const [k, v] of Object.entries(headers)) {
          reqLines.push(`${k}: ${v}`);
        }
        reqLines.push('', '');
        secure.write(reqLines.join('\r\n'));
        secure.setTimeout(timeout, () => { secure.destroy(new Error('Timeout')); });
        let statusCode = 0; let hdrs = {};
        secure.on('data', (chunk) => {
          if (!headersParsed) {
            buf += chunk.toString('utf8');
            const idx = buf.indexOf('\r\n\r\n');
            if (idx !== -1) {
              const head = buf.slice(0, idx);
              const rest = Buffer.from(buf.slice(idx + 4), 'utf8');
              const lines = head.split('\r\n');
              const statusLine = lines.shift() || '';
              const m = statusLine.match(/^HTTP\/\d\.\d\s+(\d+)/);
              statusCode = m ? parseInt(m[1], 10) : 0;
              hdrs = {};
              for (const ln of lines) {
                const p2 = ln.indexOf(':');
                if (p2 > 0) {
                  const k = ln.slice(0, p2).trim().toLowerCase();
                  const v = ln.slice(p2 + 1).trim();
                  hdrs[k] = v;
                }
              }
              headersParsed = true;
              if (rest.length) bodyBufs.push(rest);
            }
          } else {
            bodyBufs.push(chunk);
          }
        });
        secure.on('end', () => resolve({ statusCode, headers: hdrs, body: Buffer.concat(bodyBufs) }));
        secure.on('error', reject);
      });
      connectReq.on('error', reject);
      connectReq.end();
    } catch (e) {
      reject(e);
    }
  });
}

function head(url, { headers = {}, maxRedirects = 5, proxy = null, timeout = 30000, family = undefined } = {}) {
  return new Promise((resolve, reject) => {
    const client = getClient(url);
    const p = proxy && parseProxy(proxy);
    const isHttps = new URL(url).protocol === 'https:';
    if (p && p.type === 'http' && isHttps) {
      requestViaConnect(url, proxy, { method: 'HEAD', headers, timeout }).then((r) => resolve({ statusCode: r.statusCode, headers: r.headers, url })).catch(reject);
      return;
    }
    if (p && p.type === 'socks5') {
      // Issue raw HEAD via socks socket
      (async () => {
        try {
          const u = new URL(url);
          const sock = await connectSocks5(p, u.hostname, u.port ? parseInt(u.port, 10) : (isHttps ? 443 : 80), timeout);
          const s = isHttps ? tls.connect({ socket: sock, servername: u.hostname }) : sock;
          const path = u.pathname + (u.search || '');
          const reqLines = [`HEAD ${path} HTTP/1.1`, `Host: ${u.hostname}`, 'Connection: close'];
          for (const [k, v] of Object.entries(headers)) reqLines.push(`${k}: ${v}`);
          reqLines.push('', '');
          s.write(reqLines.join('\r\n'));
          let buf = '';
          s.on('data', (d) => { buf += d.toString('utf8'); });
          s.on('end', () => {
            const idx = buf.indexOf('\r\n\r\n');
            const head = idx !== -1 ? buf.slice(0, idx) : buf;
            const lines = head.split('\r\n');
            const m = lines[0].match(/HTTP\/\d\.\d\s+(\d+)/);
            const statusCode = m ? parseInt(m[1], 10) : 0;
            const hdrs = {};
            for (const ln of lines.slice(1)) {
              const p2 = ln.indexOf(':'); if (p2 > 0) hdrs[ln.slice(0, p2).toLowerCase()] = ln.slice(p2 + 1).trim();
            }
            resolve({ statusCode, headers: hdrs, url });
          });
          s.on('error', reject);
        } catch (e) { reject(e); }
      })();
      return;
    }
    const opts = p ? { host: p.host, port: p.port, method: 'HEAD', path: url, headers: { ...headers, ...(p.auth && p.auth.header ? { 'Proxy-Authorization': p.auth.header } : {}) }, family } : { method: 'HEAD', headers, family };
    const req = (p ? http : client).request(p ? opts : url, p ? undefined : opts, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && maxRedirects > 0) {
        const loc = res.headers.location.startsWith('http') ? res.headers.location : new URL(res.headers.location, url).toString();
        res.resume();
        return resolve(head(loc, { headers, maxRedirects: maxRedirects - 1 }));
      }
      resolve({
        statusCode: res.statusCode,
        headers: res.headers,
        url,
      });
    });
    req.setTimeout(timeout, () => { req.destroy(new Error('Timeout')); });
    req.on('error', reject);
    req.end();
  });
}

function probe(url, { headers = {}, proxy = null, timeout = 30000, family = undefined } = {}) {
  // Try HEAD, then GET with Range: bytes=0-0 as fallback for servers blocking HEAD
  return head(url, { headers, proxy, timeout, family }).catch(() => ({ statusCode: 0, headers: {}, url })).then(async (res) => {
    const ct = String(res.headers && res.headers['content-type'] || '');
    if (ct) return res;
    // Fallback GET
    const client = getClient(url);
    return new Promise((resolve, reject) => {
      const p = proxy && parseProxy(proxy);
      const isHttps = new URL(url).protocol === 'https:';
      if (p && p.type === 'http' && isHttps) {
        requestViaConnect(url, proxy, { method: 'GET', headers: { ...headers, Range: 'bytes=0-0' }, timeout }).then((r) => resolve({ statusCode: r.statusCode, headers: r.headers, url })).catch(reject);
        return;
      }
      if (p && p.type === 'socks5') {
        (async () => {
          try {
            const u = new URL(url);
            const sock = await connectSocks5(p, u.hostname, u.port ? parseInt(u.port, 10) : (isHttps ? 443 : 80), timeout);
            const s = isHttps ? tls.connect({ socket: sock, servername: u.hostname }) : sock;
            const path = u.pathname + (u.search || '');
            const reqLines = [`GET ${path} HTTP/1.1`, `Host: ${u.hostname}`, 'Connection: close', `Range: bytes=0-0`];
            for (const [k, v] of Object.entries(headers)) reqLines.push(`${k}: ${v}`);
            reqLines.push('', '');
            s.write(reqLines.join('\r\n'));
            let buf = '';
            s.on('data', (d) => { buf += d.toString('utf8'); });
            s.on('end', () => {
              const idx = buf.indexOf('\r\n\r\n');
              const head = idx !== -1 ? buf.slice(0, idx) : buf;
              const lines = head.split('\r\n');
              const m = lines[0].match(/HTTP\/\d\.\d\s+(\d+)/);
              const statusCode = m ? parseInt(m[1], 10) : 0;
              const hdrs = {};
              for (const ln of lines.slice(1)) { const p2 = ln.indexOf(':'); if (p2 > 0) hdrs[ln.slice(0, p2).toLowerCase()] = ln.slice(p2 + 1).trim(); }
              resolve({ statusCode, headers: hdrs, url });
            });
            s.on('error', reject);
          } catch (e) { reject(e); }
        })();
        return;
      }
      const opts = p ? { host: p.host, port: p.port, method: 'GET', path: url, headers: { ...headers, Range: 'bytes=0-0', ...(p.auth && p.auth.header ? { 'Proxy-Authorization': p.auth.header } : {}) }, family } : { method: 'GET', headers: { ...headers, Range: 'bytes=0-0' }, family };
      const req = (p ? http : client).request(p ? opts : url, p ? undefined : opts, (r) => {
        resolve({ statusCode: r.statusCode, headers: r.headers, url });
        r.resume();
      });
      req.setTimeout(timeout, () => { req.destroy(new Error('Timeout')); });
      req.on('error', reject);
      req.end();
    });
  });
}

function getText(url, { headers = {}, maxRedirects = 5, proxy = null, timeout = 30000, family = undefined, cacheTTL = 0, cookieJar = null } = {}) {
  return new Promise((resolve, reject) => {
    const { getCached, setCached } = require('./cache');
    if (cacheTTL > 0) {
      const cached = getCached(url, cacheTTL);
      if (cached) return resolve(cached);
    }
    const client = getClient(url);
    // Attach cookies from jar if available
    const reqHeaders = { ...headers };
    if (cookieJar && !reqHeaders['Cookie']) {
      try {
        const { cookiesForUrl } = require('./cookies');
        const c = cookiesForUrl(cookieJar, url);
        if (c) reqHeaders['Cookie'] = c;
      } catch (_) {}
    }
    const p = proxy && parseProxy(proxy);
    const isHttps = new URL(url).protocol === 'https:';
    if (p && p.type === 'http' && isHttps) {
      requestViaConnect(url, proxy, { method: 'GET', headers: reqHeaders, timeout })
        .then((r) => {
          if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location && maxRedirects > 0) {
            const loc = r.headers.location.startsWith('http') ? r.headers.location : new URL(r.headers.location, url).toString();
            return resolve(getText(loc, { headers: reqHeaders, maxRedirects: maxRedirects - 1, proxy, timeout, family, cacheTTL, cookieJar }));
          }
          if (r.statusCode !== 200) return reject(new Error('HTTP ' + r.statusCode));
          const body = r.body.toString('utf8');
          if (cacheTTL > 0) setCached(url, body);
          resolve(body);
        })
        .catch(reject);
      return;
    }
    if (p && p.type === 'socks5') {
      (async () => {
        try {
          const u = new URL(url);
          const sock = await connectSocks5(p, u.hostname, u.port ? parseInt(u.port, 10) : (isHttps ? 443 : 80), timeout);
          const s = isHttps ? tls.connect({ socket: sock, servername: u.hostname }) : sock;
          const path = u.pathname + (u.search || '');
          const reqLines = [`GET ${path} HTTP/1.1`, `Host: ${u.hostname}`, 'Connection: close'];
          for (const [k, v] of Object.entries(reqHeaders)) reqLines.push(`${k}: ${v}`);
          reqLines.push('', '');
          s.write(reqLines.join('\r\n'));
          let buf = '';
          s.on('data', (d) => { buf += d.toString('utf8'); });
          s.on('end', () => {
            const idx = buf.indexOf('\r\n\r\n');
            if (idx !== -1) {
              const status = buf.slice(0, idx).split('\r\n')[0];
              const m = status.match(/HTTP\/\d\.\d\s+(\d+)/);
              if (m && parseInt(m[1], 10) !== 200) return reject(new Error('HTTP ' + m[1]));
              const body = buf.slice(idx + 4);
              if (cacheTTL > 0) setCached(url, body);
              resolve(body);
            } else resolve(buf);
          });
          s.on('error', reject);
        } catch (e) { reject(e); }
      })();
      return;
    }
    const opts = p ? { host: p.host, port: p.port, path: url, headers: { ...reqHeaders, ...(p.auth && p.auth.header ? { 'Proxy-Authorization': p.auth.header } : {}) }, family } : { headers: reqHeaders, family };
    const req = (p ? http : client).get(p ? opts : url, p ? undefined : opts, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && maxRedirects > 0) {
        const loc = res.headers.location.startsWith('http') ? res.headers.location : new URL(res.headers.location, url).toString();
        res.resume();
        return resolve(getText(loc, { headers: reqHeaders, maxRedirects: maxRedirects - 1, proxy, timeout, family, cacheTTL, cookieJar }));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error('HTTP ' + res.statusCode));
      }
      const setCookies = res.headers['set-cookie'];
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (cacheTTL > 0) setCached(url, data);
        if (cookieJar && Array.isArray(setCookies) && setCookies.length) {
          try { require('./cookies').appendSetCookies(cookieJar, url, setCookies); } catch (_) {}
        }
        resolve(data);
      });
    });
    req.setTimeout(timeout, () => { req.destroy(new Error('Timeout')); });
    req.on('error', reject);
  });
}

module.exports = { head, probe, getText, parseProxy };
