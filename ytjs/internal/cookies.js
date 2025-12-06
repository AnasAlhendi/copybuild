'use strict';

const fs = require('fs');
const { URL } = require('url');

function parseNetscapeCookieFile(filePath) {
  const cookies = [];
  const text = fs.readFileSync(filePath, 'utf8');
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const parts = trimmed.split(/\t/);
    if (parts.length < 7) continue;
    const [domain, flag, path, secure, expiry, name, value] = parts;
    cookies.push({ domain, path, secure: secure.toUpperCase() === 'TRUE', expiry, name, value });
  }
  return cookies;
}

function cookiesForUrl(filePath, urlStr) {
  try {
    const u = new URL(urlStr);
    const jar = parseNetscapeCookieFile(filePath);
    const domain = u.hostname;
    const path = u.pathname || '/';
    const list = jar.filter((c) => {
      // Domain match (leading dot means include subdomains)
      if (c.domain.startsWith('.')) {
        if (!domain.endsWith(c.domain.slice(1))) return false;
      } else if (c.domain !== domain) {
        return false;
      }
      // Path prefix match
      if (!path.startsWith(c.path)) return false;
      return true;
    });
    if (!list.length) return null;
    return list.map((c) => `${c.name}=${c.value}`).join('; ');
  } catch (_) {
    return null;
  }
}

module.exports = { cookiesForUrl };

function appendSetCookies(filePath, urlStr, setCookies) {
  const { URL } = require('url');
  const u = new URL(urlStr);
  const lines = [];
  for (const sc of setCookies) {
    const parts = sc.split(';').map((s) => s.trim());
    const [nameValue, ...attrs] = parts;
    const [name, value] = nameValue.split('=');
    let domain = u.hostname;
    let path = '/';
    let secure = false;
    for (const a of attrs) {
      const [k, v] = a.split('=');
      const K = (k || '').toLowerCase();
      if (K === 'domain' && v) domain = v.startsWith('.') ? v : '.' + v;
      else if (K === 'path' && v) path = v;
      else if (K === 'secure') secure = true;
    }
    const flag = domain.startsWith('.') ? 'TRUE' : 'FALSE';
    const sec = secure ? 'TRUE' : 'FALSE';
    const expiry = (Date.now() / 1000 + 3600 * 24 * 30) | 0; // +30 days
    lines.push([domain, flag, path, sec, expiry, name, value].join('\t'));
  }
  try {
    const fs = require('fs');
    fs.appendFileSync(filePath, (fs.existsSync(filePath) ? '\n' : '') + lines.join('\n'));
  } catch (_) {}
}

module.exports.appendSetCookies = appendSetCookies;
