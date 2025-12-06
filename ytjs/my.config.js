// Edit this file with your links and options.
// Run with:
//   node ytjs/cmd/ytdl-js/index.js --config ytjs/my.config.js

module.exports = {
  // Try with youtube-dl test video (replace with your link later)
  url: 'https://www.youtube.com/watch?v=X9p19n0vOJs',

  // Output template (common placeholders)
  // %(title)s, %(ext)s, %(id)s, %(uploader)s, %(upload_date)s, %(view_count)s
  output: 'downloads/%(uploader)s/%(upload_date)s - %(title)s [%(id)s].%(ext)s',

  // Simple quality selector (sets --format internally if provided)
  quality: '480p',
  // Or explicit format selection (overrides quality)
  // format: 'best[ext=mp4]/18/bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/best',

  // Subtitles and embedding
  writeSub: false,
  subLang: 'en',
  // subLangs: 'en,es',
  allowAutoSubs: true,
  convertSubsSrt: true,
  embedSubs: false,          // set true to mux subs into output
  embedThumbnail: false,     // set true to embed thumbnail (MKV)

  // Write sidecars
  writeThumbnail: false,
  writeInfoJson: true,

  // Networking
  userAgent: 'Mozilla/5.0',
  referer: '',
  headers: {
    // 'Accept-Language': 'en-US,en;q=0.9',
  },
  // HTTP proxy or SOCKS5
  // proxy: 'http://127.0.0.1:8080',
  // proxy: 'socks5://user:pass@127.0.0.1:1080',
  timeout: 30,
  ipVersion: 4,
  // Parallel connections per file for speed
  connections: 6,
  // Remove rate cap for maximum speed
  limitRate: null,
  // Cookies (Netscape cookies.txt)
  cookies: 'ytjs/cookies.txt',

  // Playlists
  playlistStart: 1,
  playlistEnd: null,
  // playlistItems: '1,3,5-7',
  playlistReverse: false,

  // Live HLS follow limit (0 = all)
  hlsLiveMax: 0,

  // Retries / archive
  retries: 10,
  // archive: 'downloads.archive',

  // Filters (match/reject/match-filter)
  // matchTitle: '.*',
  // rejectTitle: 'trailer',
  // matchFilter: "view_count > 1000 & uploader = 'Test Channel'",

  // Diagnostics
  verbose: true,
  quiet: false,
  dumpJson: false,
};
