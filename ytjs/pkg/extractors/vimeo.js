'use strict';

const { InfoExtractor } = require('./info_extractor');
const { getText } = require('../../internal/net');

class VimeoExtractor extends InfoExtractor {
  get IE_DESC() { return 'Vimeo.com'; }
  suitable(url) { return /vimeo\.com\/(?:\d+|video\/\d+)/i.test(url); }

  async extract(url, options = {}) {
    const headers = {};
    if (options.userAgent) headers['User-Agent'] = options.userAgent;
    if (options.referer) headers['Referer'] = options.referer;
    const html = await getText(url, { headers, proxy: options.proxy, timeout: (options.timeout||30)*1000, family: options.ipVersion });
    // Find config URL
    const m = html.match(/"config_url":"([^"]+)"/);
    if (!m) throw new Error('Vimeo: config_url not found');
    const cfgUrl = m[1].replace(/\\\//g, '/');
    const cfgText = await getText(cfgUrl, { headers, proxy: options.proxy, timeout: (options.timeout||30)*1000, family: options.ipVersion });
    let cfg;
    try { cfg = JSON.parse(cfgText); } catch (_) { throw new Error('Vimeo: invalid config JSON'); }
    const video = (cfg && cfg.video) || {};
    const title = video && (video.title || 'Vimeo');
    const vd = (cfg && cfg.request && cfg.request.files) || {};
    if (vd && vd.progressive && vd.progressive.length) {
      const streams = vd.progressive.slice().sort((a, b) => (b.height || 0) - (a.height || 0));
      const s = streams[0];
      return { id: String(video.id || url), title, ext: (s.mime && s.mime.includes('mp4')) ? 'mp4' : 'mp4', url: s.url };
    }
    // HLS fallback
    if (vd && vd.hls && vd.hls.cdn_url) {
      return { id: String(video.id || url), title, ext: 'mp4', hlsManifestUrl: vd.hls.cdn_url };
    }
    throw new Error('Vimeo: no playable streams');
  }

  async listFormats(url, options = {}) {
    const headers = {};
    if (options.userAgent) headers['User-Agent'] = options.userAgent;
    if (options.referer) headers['Referer'] = options.referer;
    const html = await getText(url, { headers, proxy: options.proxy, timeout: (options.timeout||30)*1000, family: options.ipVersion });
    const m = html.match(/"config_url":"([^"]+)"/);
    if (!m) throw new Error('Vimeo: config_url not found');
    const cfgUrl = m[1].replace(/\\\//g, '/');
    const cfgText = await getText(cfgUrl, { headers, proxy: options.proxy, timeout: (options.timeout||30)*1000, family: options.ipVersion });
    let cfg; try { cfg = JSON.parse(cfgText); } catch (_) { throw new Error('Vimeo: invalid config'); }
    const vd = (cfg && cfg.request && cfg.request.files) || {};
    const lines = [];
    if (vd.progressive) {
      for (const s of vd.progressive) lines.push(`${s.quality}\t${s.mime}\t${s.width||''}x${s.height||''}\turl`);
    }
    if (vd.hls && vd.hls.cdn_url) lines.push(`hls\tapplication/x-mpegURL\t\tmanifest`);
    return lines;
  }
}

module.exports = { VimeoExtractor };
