'use strict';

const fs = require('fs');
const http = require('http');
const https = require('https');
const { URL } = require('url');
const { parseProxy } = require('../net');
const tls = require('tls');
const { globalLimiter } = require('../rate_limiter');

function getClient(url) {
  const u = new URL(url);
  return u.protocol === 'https:' ? https : http;
}

function fetch(url, { headers = {}, proxy = null, timeout = 30000 } = {}) {
  return new Promise((resolve, reject) => {
    const client = getClient(url);
    const p = proxy && parseProxy(proxy);
    const isHttps = new URL(url).protocol === 'https:';
    if (p && isHttps) {
      const u = new URL(url);
      const ch = {};
      if (p.auth && p.auth.header) ch['Proxy-Authorization'] = p.auth.header;
      const creq = http.request({ method: 'CONNECT', host: p.host, port: p.port, path: u.hostname + ':' + (u.port || 443), headers: ch });
      creq.once('connect', (cres, socket) => {
        if (cres.statusCode !== 200) { socket.destroy(); return reject(new Error('Proxy CONNECT failed: ' + cres.statusCode)); }
        const secure = tls.connect({ socket, servername: u.hostname });
        const rq = [`GET ${u.pathname + (u.search || '')} HTTP/1.1`, `Host: ${u.hostname}`, 'Connection: close'];
        for (const [k, v] of Object.entries(headers)) rq.push(`${k}: ${v}`);
        rq.push('', '');
        secure.write(rq.join('\r\n'));
        secure.setTimeout(timeout, () => { secure.destroy(new Error('Timeout')); });
        let buf = '';
        let headerDone = false; let code = 0; const chunks = [];
        secure.on('data', (d) => {
          if (!headerDone) {
            buf += d.toString('utf8');
            const idx = buf.indexOf('\r\n\r\n');
            if (idx !== -1) {
              const head = buf.slice(0, idx);
              const statusLine = head.split('\r\n')[0] || '';
              const m = statusLine.match(/HTTP\/\d\.\d\s+(\d+)/);
              code = m ? parseInt(m[1], 10) : 0;
              headerDone = true;
              const rest = Buffer.from(buf.slice(idx + 4), 'utf8');
              if (code !== 200) { secure.destroy(); return reject(new Error('HTTP ' + code)); }
              if (rest.length) chunks.push(rest);
            }
          } else {
            chunks.push(d);
          }
        });
        secure.on('end', () => resolve(Buffer.concat(chunks)));
        secure.on('error', reject);
      });
      creq.on('error', reject);
      creq.end();
      return;
    }
    const req = client.get(url, { headers }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return resolve(fetch(new URL(res.headers.location, url).toString(), { headers, proxy, timeout }));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error('HTTP ' + res.statusCode));
      }
      const bufs = [];
      res.on('data', async (c) => { await globalLimiter.acquire(c.length); bufs.push(c); });
      res.on('end', () => resolve(Buffer.concat(bufs)));
    });
    req.on('error', reject);
  });
}

function fetchRange(url, start, end, { headers = {} } = {}) {
  const reqHeaders = { ...headers, Range: `bytes=${start}-${end}` };
  return fetch(url, { headers: reqHeaders });
}

function text(xml) {
  return xml.toString('utf8');
}

function getAttr(str, name) {
  const m = str.match(new RegExp(name + '="([^"]+)"'));
  return m ? m[1] : null;
}

function resolveUrl(base, rel) {
  try { return new URL(rel, base).toString(); } catch (_) { return rel; }
}

async function downloadDASH(mpdUrl, outPath, { headers = {}, verbose = false, proxy = null, timeout = 30000, audioLang = null } = {}) {
  const mpdXml = text(await fetch(mpdUrl, { headers, proxy, timeout }));
  // BaseURL inheritance helper
  function findBaseUrl(ctxXml) {
    const m = ctxXml.match(/<BaseURL>([^<]+)<\/BaseURL>/);
    return m ? m[1] : null;
  }
  const mpdBase = findBaseUrl(mpdXml) || '';
  // Gather periods
  const periodList = mpdXml.match(/<Period[\s\S]*?<\/Period>/g) || [];
  const reps = [];
  for (const periodXml of (periodList.length ? periodList : [mpdXml])) {
    const periodBase = findBaseUrl(periodXml) || mpdBase;
    const adaps = periodXml.match(/<AdaptationSet[\s\S]*?<\/AdaptationSet>/g) || [];
    let bestVideo = null, bestAudio = null;
    for (const a of adaps) {
      const mime = getAttr(a, 'mimeType') || '';
      const type = mime.startsWith('audio/') ? 'audio' : mime.startsWith('video/') ? 'video' : null;
      if (!type) continue;
      const setBase = findBaseUrl(a) || periodBase;
      const repList = a.match(/<Representation[\s\S]*?<\/Representation>/g) || [];
      // Language/role selection for audio
      const lang = getAttr(a, 'lang') || getAttr(a, 'language');
      repList.sort((r1, r2) => {
        const b1 = parseInt(getAttr(r1, 'bandwidth') || '0', 10);
        const b2 = parseInt(getAttr(r2, 'bandwidth') || '0', 10);
        return b2 - b1;
      });
      const rep = repList[0] || null;
      if (!rep) continue;
      if (type === 'video') {
        if (!bestVideo) bestVideo = { type, xml: rep, setXml: a, base: setBase, periodBase };
      } else {
        if (audioLang) {
          if (String(lang || '').toLowerCase() === String(audioLang).toLowerCase()) {
            bestAudio = { type, xml: rep, setXml: a, base: setBase, periodBase };
          }
        } else if (!bestAudio) {
          bestAudio = { type, xml: rep, setXml: a, base: setBase, periodBase };
        }
      }
    }
    if (bestVideo) reps.push(bestVideo);
    if (bestAudio) reps.push(bestAudio);
  }
  // Function to materialize segments from a representation
  async function materialize(rep) {
    const repXml = rep.xml;
    // Determine effective base URL
    const repBase = findBaseUrl(repXml) || rep.base || '';
    const effectiveBase = repBase ? resolveUrl(mpdUrl, repBase) : (rep.base ? resolveUrl(mpdUrl, rep.base) : mpdUrl);
    // SegmentList
    const segList = repXml.match(/<SegmentList[\s\S]*?<\/SegmentList>/);
    const segTemplate = rep.setXml.match(/<SegmentTemplate[\s\S]*?>/) || repXml.match(/<SegmentTemplate[\s\S]*?>/);
    const initTag = repXml.match(/<Initialization[^>]*?>/) || (segList && segList[0].match(/<Initialization[^>]*?>/)) || rep.setXml.match(/<Initialization[^>]*?>/);
    let initUrl = null;
    let initRange = null;
    if (initTag) {
      const src = getAttr(initTag[0], 'sourceURL') || getAttr(initTag[0], 'sourceUrl') || getAttr(initTag[0], 'url') || getAttr(initTag[0], 'href');
      if (src) initUrl = resolveUrl(effectiveBase, src);
      const rng = getAttr(initTag[0], 'range') || getAttr(initTag[0], 'indexRange');
      if (rng) initRange = rng;
    }
    const segBase = repXml.match(/<SegmentBase[^>]*?>[\s\S]*?<\/SegmentBase>/) || rep.setXml.match(/<SegmentBase[^>]*?>[\s\S]*?<\/SegmentBase>/);
    let indexRange = null;
    if (segBase) {
      indexRange = getAttr(segBase[0], 'indexRange') || null;
      if (!initUrl) {
        const initNode = segBase[0].match(/<Initialization[^>]*?>/);
        if (initNode) {
          const src = getAttr(initNode[0], 'sourceURL');
          const rng = getAttr(initNode[0], 'range');
          if (src) initUrl = resolveUrl(effectiveBase, src);
          if (rng) initRange = rng;
        }
      }
    }
    const segments = [];
    if (segList) {
      const listXml = segList[0];
      const urls = listXml.match(/<SegmentURL[^>]*>/g) || [];
      for (const u of urls) {
        const media = getAttr(u, 'media') || getAttr(u, 'mediaURL') || getAttr(u, 'sourceURL');
        const mediaRange = getAttr(u, 'mediaRange');
        if (media) segments.push({ url: resolveUrl(effectiveBase, media), range: mediaRange });
      }
    } else if (segTemplate) {
      const tag = segTemplate[0];
      const media = getAttr(tag, 'media');
      const startNumber = parseInt(getAttr(tag, 'startNumber') || '1', 10);
      const duration = parseInt(getAttr(tag, 'duration') || '0', 10);
      const timescale = parseInt(getAttr(tag, 'timescale') || '1', 10);
      // SegmentTimeline or simple count
      const timelineMatch = rep.setXml.match(/<SegmentTimeline[\s\S]*?<\/SegmentTimeline>/) || repXml.match(/<SegmentTimeline[\s\S]*?<\/SegmentTimeline>/);
      const id = getAttr(repXml, 'id') || '';
      if (timelineMatch) {
        const tl = timelineMatch[0];
        const entries = tl.match(/<S[^>]*>/g) || [];
        let n = startNumber;
        let t = 0;
        for (const ent of entries) {
          const d = parseInt(getAttr(ent, 'd') || String(duration), 10);
          const r = parseInt(getAttr(ent, 'r') || '0', 10);
          const times = [];
          const tAttr = getAttr(ent, 't');
          if (tAttr) t = parseInt(tAttr, 10);
          for (let i = 0; i <= Math.max(0, r); i++) {
            times.push(t);
            t += d;
          }
          for (const ti of times) {
            let u = media;
            if (u.includes('$Time$')) u = u.replace('$Time$', String(ti));
            if (u.includes('$Number$')) u = u.replace('$Number$', String(n++));
            u = u.replace('$RepresentationID$', id);
            segments.push({ url: resolveUrl(effectiveBase, u), range: null });
          }
        }
      } else {
        // Fall back to a finite number of segments if no timeline
        const count = Math.max(1, Math.floor((60 * timescale) / Math.max(1, duration))); // ~1 minute worth
        for (let i = 0; i < count; i++) {
          const num = startNumber + i;
          const url = media.replace('$Number$', String(num)).replace('$RepresentationID$', id);
          segments.push({ url: resolveUrl(effectiveBase, url), range: null });
        }
      }
    } else {
      // Single BaseURL media
      const mediaTag = repXml.match(/<BaseURL>([^<]+)<\/BaseURL>/);
      if (mediaTag) segments.push({ url: resolveUrl(effectiveBase, mediaTag[1]), range: null });
    }
    return { initUrl: initUrl ? resolveUrl(effectiveBase, initUrl) : null, initRange, segments };
  }

  const progPath = outPath + '.dash.progress';
  let startIdx = 0;
  try { startIdx = parseInt(require('fs').readFileSync(progPath, 'utf8'), 10) || 0; } catch (_) {}

  const out = fs.createWriteStream(outPath);
  const { ProgressTracker } = require('../progress');
  for (const rep of reps) {
    if (rep.type !== 'video' && rep.type !== 'audio') continue;
    const mat = await materialize(rep);
    if (verbose) process.stderr.write(`[dash] ${rep.type} init+${mat.segments.length} segments\n`);
    const tracker = new ProgressTracker({ totalUnits: mat.segments.length, label: 'dash' });
    if (mat.initUrl) {
      let initBuf;
      if (mat.initRange) {
        const [a, b] = mat.initRange.split('-').map((x) => parseInt(x, 10));
        initBuf = await fetchRange(mat.initUrl, a, b, { headers });
      } else {
        initBuf = await fetch(mat.initUrl, { headers, proxy, timeout });
      }
      out.write(initBuf);
      tracker.addBytes(initBuf.length);
    }
    for (let i = startIdx; i < mat.segments.length; i++) {
      const seg = mat.segments[i];
      let ok = false; let lastErr = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          let buf;
          if (seg.range) {
            const [aa, bb] = seg.range.split('-').map((x) => parseInt(x, 10));
            buf = await fetchRange(seg.url, aa, bb, { headers });
          } else {
            buf = await fetch(seg.url, { headers, proxy, timeout });
          }
          out.write(buf);
          ok = true;
          tracker.addBytes(buf.length);
          try { fs.writeFileSync(progPath, String(i + 1)); } catch (_) {}
          break;
        } catch (e) {
          lastErr = e;
          if (verbose) process.stderr.write(`[dash] segment retry ${attempt + 1}/3 failed: ${e.message}\n`);
          await new Promise(r => setTimeout(r, 250));
        }
      }
      if (!ok) {
        if (verbose) process.stderr.write(`[dash] segment failed ${i + 1}: ${lastErr && lastErr.message}\n`);
        break;
      }
      if (verbose) process.stderr.write(tracker.line() + "\r\n");
      tracker.unitDone();
    }
  }
  await new Promise((r) => out.end(r));
}

module.exports = { downloadDASH };
