'use strict';

class InfoExtractor {
  constructor() {
    this._WORKING = true;
  }

  get IE_NAME() { return this.constructor.name; }
  get IE_DESC() { return this.IE_NAME; }

  suitable(_url) { return false; }

  async extract(_url, _options) {
    throw new Error('Not implemented');
  }
}

module.exports = { InfoExtractor };

