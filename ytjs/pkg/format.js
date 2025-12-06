'use strict';

function parseBracketFilters(spec) {
  const filters = {};
  const mAll = spec.match(/\[[^\]]+\]/g) || [];
  for (const block of mAll) {
    const inner = block.slice(1, -1);
    const parts = inner.split(/\s*,\s*|\s*&\s*/);
    for (const p of parts) {
      const m1 = p.match(/^(height|fps|br)\s*<=\s*([0-9]+)/);
      if (m1) { const k = m1[1]; const v = parseInt(m1[2], 10); if (k === 'height') filters.heightLe = v; else if (k === 'fps') filters.fpsLe = v; else if (k === 'br') filters.brLe = v; continue; }
      const m2 = p.match(/^(ext|vcodec|acodec|container)\s*=\s*([a-zA-Z0-9._-]+)/);
      if (m2) { const k = m2[1]; const v = m2[2]; if (k === 'container' || k === 'ext') filters.ext = v; else if (k === 'vcodec') filters.vcodec = v; else if (k === 'acodec') filters.acodec = v; continue; }
      const m3 = p.match(/^itag\s*=\s*([0-9]+)/);
      if (m3) { filters.itag = parseInt(m3[1], 10); continue; }
    }
  }
  return filters;
}

function parseFilters(spec) {
  const filters = {};
  const mH = spec.match(/height<=([0-9]+)/);
  if (mH) filters.heightLe = parseInt(mH[1], 10);
  const mExt = spec.match(/ext=(mp4|webm|3gp|m4a)/);
  if (mExt) filters.ext = mExt[1];
  const mV = spec.match(/vcodec=([a-zA-Z0-9._-]+)/);
  if (mV) filters.vcodec = mV[1];
  const mA = spec.match(/acodec=([a-zA-Z0-9._-]+)/);
  if (mA) filters.acodec = mA[1];
  const mFps = spec.match(/fps<=([0-9]+)/);
  if (mFps) filters.fpsLe = parseInt(mFps[1], 10);
  const mBr = spec.match(/br<=([0-9]+)/);
  if (mBr) filters.brLe = parseInt(mBr[1], 10);
  const mItag = spec.match(/itag=([0-9]+)/);
  if (mItag) filters.itag = parseInt(mItag[1], 10);
  // Merge bracket filters
  const bracketed = parseBracketFilters(spec);
  Object.assign(filters, bracketed);
  return filters;
}

function parseFormatExpr(expr) {
  if (!expr) return [{ type: 'auto' }];
  const parts = String(expr).split('/').map((p) => p.trim()).filter(Boolean);
  const chain = [];
  for (const p of parts) {
    if (p.includes('+')) {
      const [v, a] = p.split('+');
      chain.push({ type: 'join', video: v, audio: a, filters: parseFilters(p) });
    } else if (p === 'best' || p === 'worst') {
      chain.push({ type: p });
    } else {
      chain.push({ type: 'single', spec: p, filters: parseFilters(p) });
    }
  }
  return chain.length ? chain : [{ type: 'auto' }];
}

module.exports = { parseFormatExpr };
