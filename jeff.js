#!/usr/bin/env node
/**
 * Simple Node helper to download YouTube (and supported) videos
 * using the local youtube-dl module/CLI from this repo.
 *
 * Usage (CLI):
 *   node jeff.js <url> [--out <template>] [--quality best|worst] [--playlist]
 *
 * As a module:
 *   const { youtubeDownload } = require('./jeff');
 *   await youtubeDownload('https://youtu.be/ID', { out: '%(title)s.%(ext)s' });
 */

const { spawn } = require('child_process');
const os = require('os');
const fs = require('fs');
const path = require('path');

// --- Simple variables you can edit ---
// Fill these and run `node jeff.js` without any CLI flags
const CONFIG = {
  url: 'https://www.youtube.com/watch?v=6j6WLHNioIo', // e.g. 'https://youtu.be/VIDEO_ID'
  out: '%(title)s.%(ext)s', // output template
  // quality: 'best' for highest quality, 'worst' for lowest
  quality: '1080p',
  // set to true to allow playlist downloads
  playlist: false,
  // Optional: set path to ffmpeg/avconv if not on PATH
  // e.g. 'C:\\ffmpeg\\bin' or '/usr/local/bin'
  ffmpegLocation: '',
  // If true and ffmpeg is missing, exit instead of falling back to progressive
  // Default false so downloads still work without ffmpeg (at best progressive quality)
  requireFfmpeg: true,
  // Prefer MP4 outputs when possible (selects mp4 video+m4a audio first)
  preferMp4: true,
  // If true, only pick MP4 streams; may drop to <= target height if not available
  strictMp4: false,
  // Optionally force merge container: '' | 'mp4' | 'mkv'
  mergeFormat: 'mp4',
  // Re-encode/remux final video to specific container; ensures audio plays on more devices
  recodeTo: 'mp4',
  // Networking/auth tweaks to reduce 403s
  cookiesFile: '', // path to exported cookies.txt (Netscape format)
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  referer: '', // e.g. 'https://www.youtube.com/'
  addHeaders: [], // e.g. ['Accept-Language: en-US,en;q=0.9']
  forceIpv4: true,
  geoBypass: true,
  geoBypassCountry: '', // e.g. 'US'
};
// -------------------------------------

// Prefer a local ffmpeg at tools/ffmpeg/bin if present
let LOCAL_FFMPEG_BIN = path.join(__dirname, 'tools', 'ffmpeg', 'bin');
if (!fs.existsSync(LOCAL_FFMPEG_BIN)) {
  LOCAL_FFMPEG_BIN = '';
}

function pickPythonCmd() {
  // Prefer python3 on non-Windows, python on Windows
  if (process.platform === 'win32') return 'python';
  return 'python3';
}

function buildArgs(url, opts = {}, ffmpegAvailable = true) {
  const {
    out = '%(title)s.%(ext)s',
    quality = '720p', // 'best' | 'worst' | '720p' | youtube-dl format string
    playlist = false,
    ffmpegLocation = '',
    preferMp4 = CONFIG.preferMp4,
    strictMp4 = CONFIG.strictMp4,
    mergeFormat = CONFIG.mergeFormat,
    recodeTo = CONFIG.recodeTo,
    cookiesFile = CONFIG.cookiesFile,
    userAgent = CONFIG.userAgent,
    referer = CONFIG.referer,
    addHeaders = CONFIG.addHeaders,
    forceIpv4 = CONFIG.forceIpv4,
    geoBypass = CONFIG.geoBypass,
    geoBypassCountry = CONFIG.geoBypassCountry,
  } = opts;

  const mp4ComboAt = (h) => {
    // Prefer MP4 streams (mp4 video + m4a audio), fall back to any video+bestaudio, then progressive ≤ h
    const mp4Merge = `bestvideo[height<=${h}][ext=mp4]+bestaudio[ext=m4a]`;
    const anyMerge = `bestvideo[height<=${h}]+bestaudio`;
    const progMp4 = `best[height<=${h}][ext=mp4]`;
    const progAny = `best[height<=${h}]`;
    if (strictMp4) return `${mp4Merge}/${progMp4}/${progAny}`;
    return `${mp4Merge}/${anyMerge}/${progMp4}/${progAny}`;
  };

  const resolveFormat = (q) => {
    if (!q || typeof q !== 'string') return 'bestvideo*+bestaudio/best';
    const v = q.trim().toLowerCase();
    // If user passes a raw yt-dl format string, forward it
    if (/\+|\[|\]|\//.test(v)) return q; // assume explicit format
    if (v === 'best' || v === 'b' || v === 'highest' || v === 'max') {
      if (ffmpegAvailable) {
        return preferMp4
          ? 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/bestvideo+bestaudio/best'
          : 'bestvideo+bestaudio/best';
      }
      return preferMp4 ? 'best[ext=mp4]/best' : 'best';
    }
    if (v === 'worst' || v === 'w' || v === 'lowest' || v === 'min') {
      return ffmpegAvailable ? 'worstvideo*+worstaudio/worst' : 'worst';
    }
    // 720p/480p style cap
    const m = v.match(/^(\d{3,4})p$/);
    if (m) {
      const h = m[1];
      if (ffmpegAvailable) {
        return preferMp4
          ? mp4ComboAt(h)
          : `bestvideo[height<=${h}]+bestaudio/best[height<=${h}]/best`;
      }
      return preferMp4
        ? `best[height<=${h}][ext=mp4]/best`
        : `best[height<=${h}]`;
    }
    // Fallback to best
    if (ffmpegAvailable) return preferMp4 ? 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/bestvideo+bestaudio/best' : 'bestvideo+bestaudio/best';
    return preferMp4 ? 'best[ext=mp4]/best' : 'best';
  };

  const format = resolveFormat(quality);

  const args = [
    '-m', 'youtube_dl',
    '-f', format,
    // Do not force output format; let youtube-dl/ffmpeg pick best container (avoids quality loss)
    ffmpegLocation ? '--ffmpeg-location' : null, ffmpegLocation || null,
    mergeFormat ? '--merge-output-format' : null, mergeFormat || null,
    (recodeTo && ffmpegAvailable) ? '--recode-video' : null, (recodeTo && ffmpegAvailable) ? recodeTo : null,
    cookiesFile ? '--cookies' : null, cookiesFile || null,
    userAgent ? '--user-agent' : null, userAgent || null,
    referer ? '--referer' : null, referer || null,
    ...([].concat(...addHeaders.map((h) => ['--add-header', h]))),
    forceIpv4 ? '--force-ipv4' : null,
    geoBypass ? '--geo-bypass' : null,
    geoBypassCountry ? '--geo-bypass-country' : null, geoBypassCountry || null,
    out ? '-o' : null, out || null,
    playlist ? null : '--no-playlist',
    url,
  ].filter(Boolean);

  return args;
}

function checkFfmpegAvailable(ffmpegLocation = '') {
  return new Promise((resolve) => {
    const tryCmd = (cmd, cb) => {
      const child = spawn(cmd, ['-version'], { stdio: 'ignore' });
      child.on('error', () => cb(false));
      child.on('exit', (code) => cb(code === 0));
    };

    if (ffmpegLocation) {
      // Try provided location
      const bin = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
      const full = require('path').join(ffmpegLocation, bin);
      tryCmd(full, (ok) => resolve(!!ok));
      return;
    }

    tryCmd(process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg', (ok) => {
      if (ok) return resolve(true);
      // Try avconv as a fallback
      tryCmd(process.platform === 'win32' ? 'avconv.exe' : 'avconv', (ok2) => resolve(!!ok2));
    });
  });
}

function youtubeDownload(url, options = {}) {
  return new Promise((resolve, reject) => {
    if (!url || typeof url !== 'string') {
      return reject(new Error('A video URL string is required'));
    }

    const python = pickPythonCmd();
    const ffmpegLocation = options.ffmpegLocation || CONFIG.ffmpegLocation || LOCAL_FFMPEG_BIN || '';
    const requireFfmpeg = options.requireFfmpeg !== undefined ? options.requireFfmpeg : CONFIG.requireFfmpeg;
    checkFfmpegAvailable(ffmpegLocation).then((ffmpegOk) => {
      if (!ffmpegOk && requireFfmpeg) {
        return reject(new Error('ffmpeg not found. Install ffmpeg or set CONFIG.ffmpegLocation, or set requireFfmpeg=false to allow lower-quality progressive fallback.'));
      }
      const args = buildArgs(url, { ...options, ffmpegLocation }, ffmpegOk);

      // Try using the in-repo module via `python -m youtube_dl`
      const child = spawn(python, args, {
        stdio: 'inherit',
        env: process.env,
      });

      child.on('error', (err) => reject(err));
      child.on('exit', (code) => {
        if (code === 0) return resolve();
        // Fallback: try system `youtube-dl` if available
        if (options._triedSystem) return reject(new Error(`youtube-dl exited with code ${code}`));

        const { _triedSystem, ...rest } = options;
        const built = buildArgs(url, rest, ffmpegOk);
        const formatIndex = built.indexOf('-f');
        const selectedFormat = formatIndex >= 0 ? built[formatIndex + 1] : 'best';
        const sysArgs = [
          '-f', selectedFormat,
          ffmpegLocation ? '--ffmpeg-location' : null, ffmpegLocation || null,
          rest.out ? '-o' : null, rest.out || null,
          rest.playlist ? null : '--no-playlist',
          url,
        ].filter(Boolean);

        const sys = spawn(process.platform === 'win32' ? 'youtube-dl.exe' : 'youtube-dl', sysArgs, {
          stdio: 'inherit',
          env: process.env,
        });
        sys.on('error', (err) => reject(err));
        sys.on('exit', (c) => {
          if (c === 0) resolve();
          else reject(new Error(`youtube-dl (system) exited with code ${c}`));
        });
      });
    });
  });
}

// CLI handler
if (require.main === module) {
  const argv = process.argv.slice(2);

  if (argv.length === 0) {
    // No CLI args: try CONFIG variables
    if (!CONFIG.url) {
      console.error('Set CONFIG.url (and optionally out/quality/playlist) at top of jeff.js');
      console.error('Or use: node jeff.js <url> [--out <template>] [--quality best|worst] [--playlist]');
      process.exit(1);
    }
    youtubeDownload(CONFIG.url, { out: CONFIG.out, quality: CONFIG.quality, playlist: CONFIG.playlist })
      .then(() => process.exit(0))
      .catch((err) => {
        console.error(err.message || String(err));
        process.exit(1);
      });
  } else {
    // CLI mode
    const url = argv[0];
    let out;
    let quality = CONFIG.quality || '720p';
    let playlist = false;
    let cookiesFile = CONFIG.cookiesFile;
    let userAgent = CONFIG.userAgent;
    let referer = CONFIG.referer;
    let addHeaders = CONFIG.addHeaders.slice();
    let forceIpv4 = CONFIG.forceIpv4;
    let geoBypass = CONFIG.geoBypass;
    let geoBypassCountry = CONFIG.geoBypassCountry;

    for (let i = 1; i < argv.length; i++) {
      const a = argv[i];
      if (a === '--out' && argv[i + 1]) { out = argv[++i]; continue; }
      if (a === '--quality' && argv[i + 1]) { quality = argv[++i]; continue; }
      if (a === '--playlist') { playlist = true; continue; }
      if (a === '--cookies' && argv[i + 1]) { cookiesFile = argv[++i]; continue; }
      if (a === '--user-agent' && argv[i + 1]) { userAgent = argv[++i]; continue; }
      if (a === '--referer' && argv[i + 1]) { referer = argv[++i]; continue; }
      if (a === '--add-header' && argv[i + 1]) { addHeaders.push(argv[++i]); continue; }
      if (a === '--force-ipv4') { forceIpv4 = true; continue; }
      if (a === '--no-geo-bypass') { geoBypass = false; continue; }
      if (a === '--geo-bypass-country' && argv[i + 1]) { geoBypassCountry = argv[++i]; continue; }
    }

    youtubeDownload(url, { out, quality, playlist, cookiesFile, userAgent, referer, addHeaders, forceIpv4, geoBypass, geoBypassCountry })
      .then(() => process.exit(0))
      .catch((err) => {
        console.error(err.message || String(err));
        process.exit(1);
      });
  }
}

module.exports = { youtubeDownload };
