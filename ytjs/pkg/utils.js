'use strict';

const path = require('path');

function urlBasename(u) {
  try {
    const url = new URL(u);
    return path.posix.basename(url.pathname);
  } catch (e) {
    return path.basename(u);
  }
}

function determineExt(u) {
  const base = urlBasename(u);
  const m = /\.([a-z0-9]{1,5})$/i.exec(base);
  return m ? m[1].toLowerCase() : null;
}

function stripExt(name) {
  return name.replace(/\.[^.]+$/, '');
}

function sanitizeFilename(name) {
  let s = String(name || '').replace(/[\0-\x1F<>:"/\\|?*]+/g, '_');
  // Collapse spaces
  s = s.replace(/\s+/g, ' ').trim();
  // Remove trailing dots/spaces (Windows)
  s = s.replace(/[\s.]+$/g, '');
  // Avoid reserved Windows names
  const reserved = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
  if (reserved.test(s)) s = `_${s}`;
  if (!s) s = 'file';
  return s.slice(0, 200);
}

function applyTemplate(tpl, info) {
  return tpl
    .replace(/%\(title\)s/g, sanitizeFilename(info.title || 'video'))
    .replace(/%\(ext\)s/g, info.ext || 'bin')
    .replace(/%\(id\)s/g, info.id || 'unknown')
    .replace(/%\(view_count\)s/g, String(info.viewCount || ''))
    .replace(/%\(uploader\)s/g, sanitizeFilename(info.uploader || ''))
    .replace(/%\(upload_date\)s/g, String(info.uploadDate || ''))
    .replace(/%\(resolution\)s/g, String(info.resolution || ''))
    .replace(/%\(format_id\)s/g, String(info.formatId || ''))
    .replace(/%\(format_note\)s/g, String(info.formatNote || ''))
    .replace(/%\(fps\)s/g, String(info.fps || ''))
    .replace(/%\(acodec\)s/g, String(info.acodec || ''))
    .replace(/%\(vcodec\)s/g, String(info.vcodec || ''));
}

module.exports = {
  urlBasename,
  determineExt,
  stripExt,
  sanitizeFilename,
  applyTemplate,
};
