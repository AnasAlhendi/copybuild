#!/usr/bin/env node
'use strict';

const { parseArgs } = require('../../pkg/options');
const { YoutubeDL } = require('../../pkg/youtubedl');
const pkg = require('../../package.json');

function printHelp() {
  const help = `
ytdl-js ${pkg.version}

Usage: ytdl-js [OPTIONS] URL [URL...]

Options:
  -h, --help               Show this help and exit
  -v, --version            Show version and exit
      --list-extractors    List available extractors
  -o, --output TEMPLATE    Output template (default: %(title)s.%(ext)s)
  -f, --format STR         Format selection (best, worst, bestvideo+bestaudio, caps)
      --config FILE        Load options/URLs from JS config
      --list-formats       List available formats for the URL
      --force-direct       Treat URL as direct media (no site parsing)
      --ext EXT            Force output extension (use with --force-direct)
      --title TITLE        Force title (use with --force-direct)
      --quality Q          Simple quality selector: best|1080p|720p|480p|360p|audio
      --user-agent UA      Set HTTP User-Agent
      --referer URL        Set HTTP Referer
      --cookies FILE       Load cookies from Netscape cookie.txt
      --header K:V         Add custom HTTP header (repeatable)
  -R, --retries N          Number of retries per download (default 3)
      --max-filesize SIZE  Skip or pick formats under SIZE (e.g., 50M, 700M)
      --download-archive F Skip IDs present in file; append new IDs
      --match-title REGEX  Only download titles matching
      --reject-title REGEX Skip titles matching
      --write-sub          Download subtitles (YouTube)
      --sub-lang LANG      Subtitle language (e.g., en)
      --sub-langs L1,L2    Multiple subtitle languages
      --allow-auto-subs    Allow auto-generated subtitles
      --convert-subs srt   Convert VTT subtitles to SRT
      --playlist-start N   Playlist start index (1-based)
      --playlist-end N     Playlist end index (inclusive)
      --playlist-items S   Comma/range list (e.g., 1,3,5-7)
      --playlist-reverse   Reverse playlist order before slicing
      --write-thumbnail    Download best thumbnail
      --write-info-json    Write info JSON next to media
      --limit-rate RATE    Limit download rate (e.g., 500K, 4M)
      --connections N      Parallel connections per file (default 4)
      --proxy URL          HTTP proxy (http://host:port) for HTTP requests
      --timeout SEC        Socket timeout in seconds
      --ip-version N       Prefer IP version (4 or 6)
      --embed-subs         Mux subtitles into output (MKV)
      --audio-lang LANG    Preferred audio language (DASH selection)
      --hls-live-max N     For live playlists, maximum segments to download (0=all)
      --embed-thumbnail    Embed thumbnail into output (MKV)
      --verbose            Enable verbose logging

Notes:
  This is a JS implementation inspired by youtube-dl with YouTube support.
`;
  process.stdout.write(help);
}

async function main(argv) {
  const { options, urls, exit } = parseArgs(argv);
  if (exit === 'version') {
    process.stdout.write(pkg.version + '\n');
    return 0;
  }
  if (exit === 'help') {
    printHelp();
    return 0;
  }

  // Merge OS-parity config (~/.ytdljs/config.js, XDG/AppData)
  try {
    const os = require('os');
    const path = require('path');
    const fs = require('fs');
    const candidates = [];
    const home = os.homedir() || '.';
    candidates.push(path.join(home, '.ytdljs', 'config.js'));
    const xdg = process.env.XDG_CONFIG_HOME || path.join(home, '.config');
    candidates.push(path.join(xdg, 'ytdl-js', 'config.js'));
    const appData = process.env.APPDATA;
    if (appData) candidates.push(path.join(appData, 'ytdl-js', 'config.js'));
    for (const cfgPath of candidates) {
      if (!fs.existsSync(cfgPath)) continue;
      let g = require(cfgPath);
      if (g && typeof g === 'function') g = g();
      if (g && typeof g === 'object') {
        options.output = options.output || g.output || g.out;
        options.userAgent = options.userAgent || g.userAgent || g.ua;
        options.referer = options.referer || g.referer;
        options.headers = { ...(g.headers||{}), ...(options.headers||{}) };
        for (const k of ['cookies','archive','retries','format','writeSub','subLang','convertSubsSrt','writeThumbnail','writeInfoJson','limitRate','proxy','timeout','ipVersion','embedSubs','dumpJson','quiet']) {
          if (options[k] === undefined && g[k] !== undefined) options[k] = g[k];
        }
      }
    }
  } catch (_) {}

  // Load config file if provided
  let urlsToUse = urls;
  if (options.config) {
    const path = require('path');
    const fs = require('fs');
    const cfgPath = path.resolve(process.cwd(), options.config);
    if (!fs.existsSync(cfgPath)) {
      process.stderr.write('ERROR: config not found: ' + cfgPath + '\n');
      return 1;
    }
    let cfg = require(cfgPath);
    if (cfg && typeof cfg === 'function') cfg = cfg();
    if (typeof cfg === 'string') {
      urlsToUse = [cfg];
    } else if (Array.isArray(cfg)) {
      // Array of URLs or jobs
      if (cfg.length && typeof cfg[0] === 'string') urlsToUse = cfg;
      // If array of job objects, we'll handle below by mapping
    } else if (cfg && typeof cfg === 'object') {
      // Merge top-level options if not overridden via CLI
      options.output = options.output || cfg.output || cfg.out;
      options.userAgent = options.userAgent || cfg.userAgent || cfg.ua;
      options.referer = options.referer || cfg.referer;
      if (cfg.headers && typeof cfg.headers === 'object') {
        options.headers = { ...cfg.headers, ...options.headers };
      }
      if (Array.isArray(cfg.addHeaders)) {
        for (const h of cfg.addHeaders) {
          if (typeof h === 'string' && h.includes(':')) {
            const i = h.indexOf(':');
            options.headers[h.slice(0, i).trim()] = h.slice(i + 1).trim();
          }
        }
      }
      if (cfg.verbose === true && options.verbose !== true) options.verbose = true;
      if (cfg.url && !urlsToUse.length) urlsToUse = [cfg.url];
      if (Array.isArray(cfg.urls) && !urlsToUse.length) urlsToUse = cfg.urls;
      // Support array of job objects: [{ url, output, headers, ... }]
      if (!urlsToUse.length && Array.isArray(cfg.jobs)) {
        urlsToUse = cfg.jobs;
      }
    }
  }

  const ydl = new YoutubeDL(options);

  if (options.listExtractors) {
    const list = ydl.listExtractors();
    for (const ie of list) {
      process.stdout.write(ie.name + (ie.working === false ? ' (BROKEN)' : '') + '\n');
    }
    return 0;
  }

  if (!urlsToUse.length) {
    printHelp();
    return 1;
  }

  try {
    if (Array.isArray(urlsToUse) && urlsToUse.length && typeof urlsToUse[0] === 'object') {
      // Treat as job objects
      for (const job of urlsToUse) {
        const perJob = new YoutubeDL({ ...options, ...job });
        try { await perJob.download([job.url]); }
        catch (e) { if (!options.quiet) process.stderr.write((e && e.message) + '\n'); process.exitCode = 1; }
      }
    } else {
      try { await ydl.download(urlsToUse); }
      catch (e) { if (!options.quiet) process.stderr.write((e && e.message) + '\n'); process.exitCode = 1; }
    }
    return process.exitCode || 0;
  } catch (err) {
    if (options.dumpJson) {
      process.stdout.write(JSON.stringify({ error: err && err.message || String(err) }) + '\n');
    } else if (!options.quiet) {
      process.stderr.write('ERROR: ' + (err && err.message || String(err)) + '\n');
    }
    return err && err.code ? err.code : 1;
  }
}

if (require.main === module) {
  main(process.argv).then((code) => process.exit(code));
}

module.exports = { main };
