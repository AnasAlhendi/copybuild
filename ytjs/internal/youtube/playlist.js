'use strict';

const { getText } = require('../net');

function parseJSONFrom(html, marker) {
  const i = html.indexOf(marker);
  if (i === -1) return null;
  const start = i + marker.length;
  let j = html.indexOf('{', start);
  if (j === -1) return null;
  let depth = 0;
  for (let k = j; k < html.length; k++) {
    const ch = html[k];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(html.slice(j, k + 1)); } catch (_) { return null; }
      }
    }
  }
  return null;
}

async function expandPlaylist(url, headers = {}) {
  const html = await getText(url, { headers });
  const data = parseJSONFrom(html, 'var ytInitialData = ')
    || parseJSONFrom(html, 'ytInitialData = ');
  if (!data) return [];
  const ids = new Set();
  const stack = [data];
  while (stack.length) {
    const v = stack.pop();
    if (!v || typeof v !== 'object') continue;
    if (v.playlistVideoRenderer && v.playlistVideoRenderer.videoId) {
      ids.add(v.playlistVideoRenderer.videoId);
    }
    for (const k of Object.keys(v)) stack.push(v[k]);
  }
  return Array.from(ids).map((id) => `https://www.youtube.com/watch?v=${id}`);
}

module.exports = { expandPlaylist };

