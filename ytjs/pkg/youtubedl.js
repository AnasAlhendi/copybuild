'use strict';

const path = require('path');
const fs = require('fs');
const { getExtractors } = require('./extractors/registry');
const { applyTemplate, determineExt, stripExt, urlBasename } = require('./utils');
const { download: httpDownload } = require('../internal/downloader/http');
const { downloadHLS } = require('../internal/downloader/hls');
const { downloadDASH } = require('../internal/downloader/dash');
const { mergeAV, muxSubs, tagFile } = require('../internal/postproc/ffmpeg');
const { matchFilter } = require('./filter');
const { cookiesForUrl } = require('../internal/cookies');
const { expandPlaylist } = require('../internal/youtube/playlist');
const { probe } = require('../internal/net');
const { globalLimiter } = require('../internal/rate_limiter');

class YoutubeDL {
  constructor(options = {}) {
    this.options = options;
    this.extractors = getExtractors();
    // Set global rate limiter from options.limitRate if provided
    const parseRate = (rate) => {
      if (!rate) return null;
      const m = String(rate).match(/^(\d+(?:\.\d+)?)([KkMmGg])?$/);
      if (!m) return parseInt(rate, 10) || null;
      const n = parseFloat(m[1]);
      const unit = (m[2] || '').toUpperCase();
      const mult = unit === 'G' ? 1024 * 1024 * 1024 : unit === 'M' ? 1024 * 1024 : unit === 'K' ? 1024 : 1;
      return Math.max(1, Math.floor(n * mult));
    };
    const bps = parseRate(this.options.limitRate);
    if (bps) globalLimiter.setRate(bps);
  }

  listExtractors() {
    return this.extractors.map((ie) => ({ name: ie.IE_NAME, working: ie._WORKING !== false }));
  }

  _selectExtractor(url) {
    for (const ie of this.extractors) {
      try { if (ie.suitable(url)) return ie; } catch (_) {}
    }
    return null;
  }

  async extract(url) {
    // Forced direct mode via config/CLI
    if (this.options.forceDirect || this.options.ext || this.options.title) {
      const ext = this.options.ext || determineExt(url) || 'bin';
      const base = urlBasename(url);
      const title = this.options.title || stripExt(base) || 'media';
      return { id: url, title, ext, url };
    }

    const ie = this._selectExtractor(url);
    let info;
    if (!ie) {
      info = await this._probeDirectMedia(url);
      if (!info) throw new Error('No suitable extractor found');
    } else {
      info = await ie.extract(url, this.options);
    }
    return info;
  }

  async _probeDirectMedia(url) {
    try {
      const headers = { ...this.options.headers };
      if (this.options.userAgent) headers['User-Agent'] = this.options.userAgent;
      if (this.options.referer) headers['Referer'] = this.options.referer;
      const res = await probe(url, { headers, proxy: this.options.proxy, timeout: (this.options.timeout||30)*1000, family: this.options.ipVersion });
      if (res.statusCode && res.statusCode >= 400) return null;
      const ct = String(res.headers['content-type'] || '').toLowerCase();
      if (!/^video\//.test(ct) && !/^audio\//.test(ct)) return null;
      const cd = String(res.headers['content-disposition'] || '');
      let filename = null;
      const m = /filename\*=UTF-8''([^;\r\n]+)/i.exec(cd) || /filename="?([^";\r\n]+)"?/i.exec(cd);
      if (m) {
        try { filename = decodeURIComponent(m[1]); } catch (_) { filename = m[1]; }
      }
      let ext = null;
      if (ct.includes('mp4')) ext = 'mp4';
      else if (ct.includes('webm')) ext = 'webm';
      else if (ct.includes('mpeg')) ext = 'mpg';
      else if (ct.includes('ogg')) ext = 'ogg';
      else if (ct.includes('aac')) ext = 'aac';
      else if (ct.includes('x-matroska') || ct.includes('matroska')) ext = 'mkv';
      else if (ct.includes('quicktime')) ext = 'mov';
      else if (ct.includes('x-m4a') || ct.includes('mp4a') || /^audio\/mp4/.test(ct)) ext = 'm4a';
      const title = filename ? filename.replace(/\.[^.]+$/, '') : 'media';
      return { id: url, title, ext: ext || 'bin', url };
    } catch (_) {
      return null;
    }
  }

  _resolveOutfile(info) {
    const tpl = this.options.output || '%(title)s.%(ext)s';
    const out = applyTemplate(tpl, info);
    return path.resolve(process.cwd(), out);
  }

  async _ensureDirFor(file) {
    const dir = path.dirname(file);
    await fs.promises.mkdir(dir, { recursive: true });
  }

  async download(urls) {
    const expanded = [];
    for (const u of urls) {
      if (/youtube\.com\/playlist\?/.test(u) || /list=/.test(u)) {
        const headers = { ...this.options.headers };
        if (this.options.userAgent) headers['User-Agent'] = this.options.userAgent;
        if (this.options.referer) headers['Referer'] = this.options.referer;
        let list = await expandPlaylist(u, headers);
        if (this.options.playlistReverse) list.reverse();
        // Apply playlist slicing
        if (this.options.playlistItems) {
          const spec = String(this.options.playlistItems);
          const items = new Set();
          for (const part of spec.split(',')) {
            if (/-/.test(part)) {
              const [a, b] = part.split('-').map((x) => parseInt(x, 10));
              const start = Math.min(a, b), end = Math.max(a, b);
              for (let i = start; i <= end; i++) items.add(i);
            } else {
              items.add(parseInt(part, 10));
            }
          }
          list = list.filter((_, idx) => items.has(idx + 1));
        } else {
          const start = Math.max(1, this.options.playlistStart || 1);
          const end = this.options.playlistEnd || list.length;
          list = list.slice(start - 1, end);
        }
        expanded.push(...list);
      } else {
        expanded.push(u);
      }
    }
    // Archive: preload IDs to skip
    let archiveSet = null;
    if (this.options.archive) {
      try {
        const content = await fs.promises.readFile(this.options.archive, 'utf8');
        archiveSet = new Set(content.split(/\r?\n/).filter(Boolean));
      } catch (_) {}
    }

    const matchRe = this.options.matchTitle ? new RegExp(this.options.matchTitle, 'i') : null;
    const rejectRe = this.options.rejectTitle ? new RegExp(this.options.rejectTitle, 'i') : null;

    let failures = 0;
    for (const url of expanded) {
      let info;
      try {
        info = await this.extract(url);
      } catch (ex) {
        if (this.options.dumpJson) {
          process.stdout.write(JSON.stringify({ url, error: ex && ex.message || String(ex) }) + '\n');
          failures++;
          continue;
        } else {
          if (!this.options.quiet) process.stderr.write('ERROR: ' + (ex && ex.message || String(ex)) + '\n');
          failures++;
          continue;
        }
      }
      if (this.options.dumpJson) {
        const data = { id: info.id, title: info.title, uploader: info.uploader, upload_date: info.uploadDate, ext: info.ext, url: info.url, formats: undefined, info: info.info || null };
        try {
          const ie = this._selectExtractor(url);
          if (ie && typeof ie.listFormats === 'function') data.formats = await ie.listFormats(url, this.options);
        } catch (_) {}
        process.stdout.write(JSON.stringify(data) + '\n');
        continue;
      }
      if (this.options.listFormats) {
        const ie = this._selectExtractor(url);
        if (ie && typeof ie.listFormats === 'function') {
          const lines = await ie.listFormats(url, this.options);
          for (const ln of lines) process.stdout.write(ln + '\n');
          continue;
        }
        process.stdout.write('No format listing for this URL\n');
        continue;
      }
      if (archiveSet && info.id && archiveSet.has(String(info.id))) {
        if (this.options.verbose && !this.options.quiet) process.stderr.write(`[skip] in archive: ${info.id}\n`);
        continue;
      }
      if (matchRe && !matchRe.test(info.title || '')) {
        if (this.options.verbose && !this.options.quiet) process.stderr.write(`[skip] title not matching: ${info.title}\n`);
        continue;
      }
      if (rejectRe && rejectRe.test(info.title || '')) {
        if (this.options.verbose && !this.options.quiet) process.stderr.write(`[skip] title rejected: ${info.title}\n`);
        continue;
      }
      if (this.options.matchFilter && !matchFilter(this.options.matchFilter, info)) {
        if (this.options.verbose) process.stderr.write(`[skip] match-filter not satisfied\n`);
        continue;
      }
      const filename = this._resolveOutfile(info);
      await this._ensureDirFor(filename);
      const headers = { ...this.options.headers };
      if (this.options.userAgent) headers['User-Agent'] = this.options.userAgent;
      if (this.options.referer) headers['Referer'] = this.options.referer;
      if (this.options.cookies) {
        const c = cookiesForUrl(this.options.cookies, info.url);
        if (c) headers['Cookie'] = c;
      }
      const attempts = Math.max(1, this.options.retries | 0);
      let success = false; let lastErr = null;
      const simulate = !!this.options.simulate || !!this.options.skipDownload;
      if (simulate) {
        if (this.options.verbose) process.stderr.write(`[simulate] ${info.title} -> ${filename}\n`);
        if (this.options.writeInfoJson && info.info) {
          const jsonPath = filename.replace(/\.[^.]+$/, '') + '.info.json';
          await fs.promises.writeFile(jsonPath, JSON.stringify(info.info, null, 2));
        }
        continue;
      }
      for (let attempt = 0; attempt < attempts; attempt++) {
        try {
          if (info.hlsManifestUrl) {
            await downloadHLS(info.hlsManifestUrl, filename, { verbose: this.options.verbose, headers, proxy: this.options.proxy, timeout: (this.options.timeout||30)*1000 });
          } else if (info.dashManifestUrl) {
            await downloadDASH(info.dashManifestUrl, filename, { verbose: this.options.verbose, headers, proxy: this.options.proxy, timeout: (this.options.timeout||30)*1000 });
          } else if (info.videoUrl && info.audioUrl) {
            const base = filename.replace(/\.[^.]+$/, '');
            const vFile = base + '.video.' + (info.vext || info.ext || 'mp4');
            const aFile = base + '.audio.' + (info.aext || 'm4a');
            const needVideo = !fs.existsSync(vFile);
            const needAudio = !fs.existsSync(aFile);
            const tasks = [];
            if (needVideo) tasks.push(httpDownload(info.videoUrl, vFile, { verbose: this.options.verbose, headers, resume: true, limitRate: this.options.limitRate, proxy: this.options.proxy, timeout: (this.options.timeout||30)*1000, family: this.options.ipVersion, connections: this.options.connections }));
            if (needAudio) tasks.push(httpDownload(info.audioUrl, aFile, { verbose: this.options.verbose, headers, resume: true, limitRate: this.options.limitRate, proxy: this.options.proxy, timeout: (this.options.timeout||30)*1000, family: this.options.ipVersion, connections: this.options.connections }));
            if (tasks.length) await Promise.all(tasks);
            await mergeAV(vFile, aFile, filename, { log: this.options.verbose });
          } else {
            await httpDownload(info.url, filename, { verbose: this.options.verbose, headers, resume: true, limitRate: this.options.limitRate, proxy: this.options.proxy, timeout: (this.options.timeout||30)*1000, family: this.options.ipVersion, connections: this.options.connections });
          }
          // Write info JSON
          if (this.options.writeInfoJson && info.info) {
            const jsonPath = filename.replace(/\.[^.]+$/, '') + '.info.json';
            await fs.promises.writeFile(jsonPath, JSON.stringify(info.info, null, 2));
          }
          // Write thumbnail
          if (this.options.writeThumbnail && Array.isArray(info.thumbnails) && info.thumbnails.length) {
            const best = info.thumbnails.sort((a, b) => (b.width || 0) - (a.width || 0))[0];
            if (best && best.url) {
              const ext = best.url.includes('.webp') ? 'webp' : 'jpg';
              const tpath = filename.replace(/\.[^.]+$/, '') + '.jpg';
              await httpDownload(best.url, tpath, { verbose: this.options.verbose, headers, resume: false, proxy: this.options.proxy });
          }
          }
          // Subtitles (YouTube)
          if (this.options.writeSub && Array.isArray(info.subtitles) && info.subtitles.length) {
            const base = filename.replace(/\.[^.]+$/, '');
            const wanted = new Set();
            if (this.options.subLang) wanted.add(String(this.options.subLang).toLowerCase());
            if (this.options.subLangs) for (const l of String(this.options.subLangs).split(',').map(s=>s.trim().toLowerCase())) wanted.add(l);
            const tracks = info.subtitles.filter((t) => {
              if (!wanted.size) return true;
              return wanted.has(String(t.lang || '').toLowerCase());
            });
            for (const track of tracks) {
              if (!track || !track.url) continue;
              const vttPath = base + '.' + (track.lang || 'sub') + '.vtt';
              await httpDownload(track.url, vttPath, { verbose: this.options.verbose, headers, resume: false, proxy: this.options.proxy });
              if (this.options.convertSubsSrt) {
                const srtPath = base + '.' + (track.lang || 'sub') + '.srt';
                const data = await fs.promises.readFile(vttPath, 'utf8');
                const srt = data
                  .replace(/^WEBVTT.*$/m, '')
                  .replace(/(\d{2}:\d{2}:\d{2})\.(\d{3})/g, '$1,$2');
                await fs.promises.writeFile(srtPath, srt);
                if (this.options.embedSubs) {
                  const outMkv = base + '.mkv';
                  await muxSubs(filename, srtPath, outMkv, { log: this.options.verbose });
                  try { await fs.promises.rename(outMkv, filename); } catch (_) {}
                }
              }
            }
          }
          // Embed thumbnail (MKV) if requested
          if (this.options.embedThumbnail && Array.isArray(info.thumbnails) && info.thumbnails.length) {
            const best = info.thumbnails.sort((a, b) => (b.width || 0) - (a.width || 0))[0];
            if (best && best.url) {
              const base = filename.replace(/\.[^.]+$/, '');
              const cover = base + '.cover.jpg';
              await httpDownload(best.url, cover, { verbose: this.options.verbose, headers, resume: false, proxy: this.options.proxy });
              // Attach into MKV only; keep simple
              try {
                const { spawn } = require('child_process');
                await new Promise((resolve, reject) => {
                  const args = ['-y', '-i', filename, '-attach', cover, '-metadata:s:t', 'mimetype=image/jpeg', '-c', 'copy', base + '.mkv'];
                  const p = spawn('ffmpeg', args, { stdio: this.options.verbose ? 'inherit' : 'ignore' });
                  p.on('error', reject);
                  p.on('exit', (code) => code === 0 ? resolve() : reject(new Error('ffmpeg attach failed')));
                });
                try { await fs.promises.rename(base + '.mkv', filename); } catch (_) {}
              } catch (_) {}
            }
          }
          // Tag title metadata if possible
          try {
            const tagged = filename.replace(/\.[^.]+$/, '') + '.tag' + filename.slice(filename.lastIndexOf('.'));
            await tagFile(filename, tagged, { title: info.title, log: false });
            try { await fs.promises.rename(tagged, filename); } catch (_) {}
          } catch (_) {}
          success = true;
          break;
        } catch (e) {
          lastErr = e;
          if (this.options.verbose && !this.options.quiet) process.stderr.write(`[retry ${attempt + 1}/${attempts}] ${e.message}\n`);
          await new Promise(r => setTimeout(r, 500));
        }
      }
      if (!success) { failures++; if (!this.options.quiet) process.stderr.write('ERROR: ' + (lastErr && lastErr.message || 'Download failed') + '\n'); continue; }
      if (this.options.verbose && !this.options.quiet) process.stderr.write(`[done] ${filename}\n`);
      if (this.options.archive && info.id) {
        try { await fs.promises.appendFile(this.options.archive, String(info.id) + '\n'); } catch (_) {}
      }
    }
    if (failures > 0) {
      // Signal failures to caller
      const err = new Error(`${failures} item(s) failed`);
      err.code = 1;
      throw err;
    }
  }
}

module.exports = { YoutubeDL };
