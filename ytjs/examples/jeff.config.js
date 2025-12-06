// Example config for ytdl-js inspired by repo root jeff.js

module.exports = {
  // One URL or multiple URLs
  // url: 'https://example.com/video.mp4',
  urls: [
    'https://example.com/video.mp4',
  ],

  // Output template (same placeholders as youtube-dl style)
  output: '%(title)s.%(ext)s',

  // Networking
  userAgent: 'Mozilla/5.0',
  referer: '',
  headers: {
    // 'Accept-Language': 'en-US,en;q=0.9',
  },

  // Logging
  verbose: true,

  // Advanced: array of job objects if you want per-URL overrides
  // jobs: [
  //   { url: 'https://example.com/video.mp4', output: 'out/%(title)s.%(ext)s', headers: { 'X-Token': 'abc' } },
  // ],
};

