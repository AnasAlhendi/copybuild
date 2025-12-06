'use strict';

const { InfoExtractor } = require('./info_extractor');
const { urlBasename, determineExt, stripExt } = require('../utils');

class GenericExtractor extends InfoExtractor {
  get IE_DESC() { return 'Generic extractor for direct media URLs'; }

  suitable(url) {
    return /\.(mp4|m4a|webm|mp3|ogg|wav|m3u8|mpd)(?:[?#].*)?$/i.test(url);
  }

  async extract(url, _options) {
    const base = urlBasename(url);
    const ext = determineExt(url) || 'bin';
    const title = stripExt(base) || 'media';
    const id = url;
    if (/\.m3u8(?:[?#].*)?$/i.test(url)) {
      return { id, title, ext: 'mp4', hlsManifestUrl: url };
    }
    if (/\.mpd(?:[?#].*)?$/i.test(url)) {
      return { id, title, ext: 'mp4', dashManifestUrl: url };
    }
    return { id, title, ext, url };
  }
}

module.exports = { GenericExtractor };
