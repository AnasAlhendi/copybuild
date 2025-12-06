'use strict';

const { InfoExtractor } = require('./info_extractor');
const { getText } = require('../../internal/net');

class DailymotionExtractor extends InfoExtractor {
  get IE_DESC() { return 'Dailymotion.com'; }
  suitable(url) { return /dailymotion\.com\/video\//i.test(url); }

  async extract(url, options = {}) {
    const headers = {};
    if (options.userAgent) headers['User-Agent'] = options.userAgent;
    if (options.referer) headers['Referer'] = options.referer;
    const html = await getText(url, { headers, proxy: options.proxy, timeout: (options.timeout||30)*1000, family: options.ipVersion });
    const m = html.match(/"m3u8_url":"([^"]+)"/);
    if (m) {
      const m3u8 = m[1].replace(/\\\//g, '/');
      const title = (html.match(/<meta property="og:title" content="([^"]+)"/i) || [])[1] || 'Dailymotion';
      return { id: url, title, ext: 'mp4', hlsManifestUrl: m3u8 };
    }
    throw new Error('Dailymotion: no playable streams');
  }
}

module.exports = { DailymotionExtractor };

