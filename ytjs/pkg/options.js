'use strict';

const DEFAULTS = {
  output: '%(title)s.%(ext)s',
  verbose: false,
  listExtractors: false,
  headers: {},
  userAgent: null,
  referer: null,
  config: null,
  forceDirect: false,
  ext: null,
  title: null,
  cookies: null,
  archive: null,
  retries: 3,
  matchTitle: null,
  rejectTitle: null,
  matchFilter: null,
  format: null,
  quality: null,
  maxFilesize: null,
  writeSub: false,
  subLang: null,
  subLangs: null,
  allowAutoSubs: false,
  playlistStart: 1,
  playlistEnd: null,
  playlistItems: null,
  playlistReverse: false,
  writeThumbnail: false,
  writeInfoJson: false,
  convertSubsSrt: false,
  limitRate: null,
  proxy: null,
  embedSubs: false,
  embedThumbnail: false,
  connections: 4
};

function parseArgs(argv) {
  const args = argv.slice(2);
  const options = { ...DEFAULTS };
  const urls = [];
  let exit = null;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    switch (a) {
      case '-h':
      case '--help':
        exit = 'help';
        break;
      case '-v':
      case '--version':
        exit = 'version';
        break;
      case '--list-extractors':
        options.listExtractors = true;
        break;
      case '-o':
      case '--output': {
        const next = args[++i];
        if (!next) throw new Error('Missing value for ' + a);
        options.output = next;
        break;
      }
      case '--verbose':
        options.verbose = true;
        break;
      case '--force-direct':
        options.forceDirect = true;
        break;
      case '--ext': {
        const next = args[++i];
        if (!next) throw new Error('Missing value for --ext');
        options.ext = next;
        break;
      }
      case '--title': {
        const next = args[++i];
        if (!next) throw new Error('Missing value for --title');
        options.title = next;
        break;
      }
      case '--cookies': {
        const next = args[++i];
        if (!next) throw new Error('Missing value for --cookies');
        options.cookies = next;
        break;
      }
      case '--download-archive': {
        const next = args[++i];
        if (!next) throw new Error('Missing value for --download-archive');
        options.archive = next;
        break;
      }
      case '-f':
      case '--format': {
        const next = args[++i];
        if (!next) throw new Error('Missing value for --format');
        options.format = next;
        break;
      }
      case '--quality': {
        const next = args[++i];
        if (!next) throw new Error('Missing value for --quality');
        options.quality = next;
        break;
      }
      case '--max-filesize': {
        const next = args[++i];
        if (!next) throw new Error('Missing value for --max-filesize');
        options.maxFilesize = next;
        break;
      }
      case '-R':
      case '--retries': {
        const next = args[++i];
        if (!next) throw new Error('Missing value for ' + a);
        options.retries = parseInt(next, 10) || 0;
        break;
      }
      case '--write-sub':
        options.writeSub = true;
        break;
      case '--sub-lang': {
        const next = args[++i];
        if (!next) throw new Error('Missing value for --sub-lang');
        options.subLang = next;
        break;
      }
      case '--sub-langs': {
        const next = args[++i];
        if (!next) throw new Error('Missing value for --sub-langs');
        options.subLangs = next;
        break;
      }
      case '--allow-auto-subs':
        options.allowAutoSubs = true;
        break;
      case '--convert-subs': {
        const next = args[++i];
        if (!next) throw new Error('Missing value for --convert-subs');
        options.convertSubsSrt = String(next).toLowerCase() === 'srt';
        break;
      }
      case '--playlist-start': {
        const next = args[++i];
        if (!next) throw new Error('Missing value for --playlist-start');
        options.playlistStart = parseInt(next, 10) || 1;
        break;
      }
      case '--playlist-end': {
        const next = args[++i];
        if (!next) throw new Error('Missing value for --playlist-end');
        options.playlistEnd = parseInt(next, 10) || null;
        break;
      }
      case '--playlist-items': {
        const next = args[++i];
        if (!next) throw new Error('Missing value for --playlist-items');
        options.playlistItems = next;
        break;
      }
      case '--playlist-reverse':
        options.playlistReverse = true;
        break;
      case '--write-thumbnail':
        options.writeThumbnail = true;
        break;
      case '--write-info-json':
        options.writeInfoJson = true;
        break;
      case '--limit-rate': {
        const next = args[++i];
        if (!next) throw new Error('Missing value for --limit-rate');
        options.limitRate = next; // parse in downloader
        break;
      }
      case '--connections': {
        const next = args[++i];
        if (!next) throw new Error('Missing value for --connections');
        options.connections = Math.max(1, parseInt(next, 10) || 1);
        break;
      }
      case '--proxy': {
        const next = args[++i];
        if (!next) throw new Error('Missing value for --proxy');
        options.proxy = next;
        break;
      }
      case '--embed-subs':
        options.embedSubs = true;
        break;
      case '--embed-thumbnail':
        options.embedThumbnail = true;
        break;
      case '--list-formats':
        options.listFormats = true;
        break;
      case '--dump-json':
        options.dumpJson = true;
        break;
      case '--quiet':
        options.quiet = true;
        break;
      case '--print-json':
        options.dumpJson = true;
        break;
      case '--username': {
        const next = args[++i];
        if (!next) throw new Error('Missing value for --username');
        options.username = next;
        break;
      }
      case '--password': {
        const next = args[++i];
        if (!next) throw new Error('Missing value for --password');
        options.password = next;
        break;
      }
      case '--simulate':
        options.simulate = true;
        break;
      case '--skip-download':
        options.skipDownload = true;
        break;
      case '--list-formats':
        options.listFormats = true;
        break;
      case '--simulate':
        options.simulate = true;
        break;
      case '--skip-download':
        options.skipDownload = true;
        break;
      case '--list-formats':
        options.listFormats = true;
        break;
      case '--audio-lang': {
        const next = args[++i];
        if (!next) throw new Error('Missing value for --audio-lang');
        options.audioLang = next;
        break;
      }
      case '--hls-live-max': {
        const next = args[++i];
        if (!next) throw new Error('Missing value for --hls-live-max');
        options.hlsLiveMax = parseInt(next, 10) || 0;
        break;
      }
      case '--timeout': {
        const next = args[++i];
        if (!next) throw new Error('Missing value for --timeout');
        options.timeout = parseInt(next, 10) || 30;
        break;
      }
      case '--ip-version': {
        const next = args[++i];
        if (!next) throw new Error('Missing value for --ip-version');
        const v = parseInt(next, 10);
        if (v !== 4 && v !== 6) throw new Error('--ip-version must be 4 or 6');
        options.ipVersion = v;
        break;
      }
      case '--match-title': {
        const next = args[++i];
        if (!next) throw new Error('Missing value for --match-title');
        options.matchTitle = next;
        break;
      }
      case '--reject-title': {
        const next = args[++i];
        if (!next) throw new Error('Missing value for --reject-title');
        options.rejectTitle = next;
        break;
      }
      case '--match-filter': {
        const next = args[++i];
        if (!next) throw new Error('Missing value for --match-filter');
        options.matchFilter = next;
        break;
      }
      case '--user-agent': {
        const next = args[++i];
        if (!next) throw new Error('Missing value for --user-agent');
        options.userAgent = next;
        break;
      }
      case '--referer': {
        const next = args[++i];
        if (!next) throw new Error('Missing value for --referer');
        options.referer = next;
        break;
      }
      case '--header': {
        const next = args[++i];
        if (!next || !next.includes(':')) throw new Error('Header must be in key:value format');
        const idx = next.indexOf(':');
        const key = next.slice(0, idx).trim();
        const val = next.slice(idx + 1).trim();
        options.headers[key] = val;
        break;
      }
      case '--config': {
        const next = args[++i];
        if (!next) throw new Error('Missing value for --config');
        options.config = next;
        break;
      }
      default:
        if (a.startsWith('-')) throw new Error('Unknown option ' + a);
        urls.push(a);
    }
  }

  // Map simple quality to a format expression if user didn't pass --format
  if (!options.format && options.quality) {
    const q = String(options.quality).toLowerCase();
    const cap = (h) => `best[height<=${h}][ext=mp4]/best[height<=${h}]/best`;
    if (q === 'best') options.format = 'best[ext=mp4]/best';
    else if (q === '1080p' || q === '1080') options.format = cap(1080);
    else if (q === '720p' || q === '720') options.format = cap(720);
    else if (q === '480p' || q === '480') options.format = cap(480);
    else if (q === '360p' || q === '360') options.format = cap(360);
    else if (q === 'audio' || q === 'm4a') options.format = 'bestaudio[ext=m4a]/bestaudio';
    else options.format = 'best[ext=mp4]/best';
  }

  return { options, urls, exit };
}

module.exports = { parseArgs, DEFAULTS };
