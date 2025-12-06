'use strict';

const { YouTubeExtractor } = require('./youtube');
const { VimeoExtractor } = require('./vimeo');
const { DailymotionExtractor } = require('./dailymotion');
const { GenericExtractor } = require('./generic');

function getExtractors() {
  // Order matters: try specific before generic
  return [new YouTubeExtractor(), new VimeoExtractor(), new DailymotionExtractor(), new GenericExtractor()];
}

module.exports = { getExtractors };
