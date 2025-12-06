'use strict';

const { InfoExtractor } = require('./info_extractor');
const { getText } = require('../../internal/net');
const { decipher } = require('../../internal/youtube/sig');
const { extractWithPython } = require('../../internal/youtube/fallback_py');

function parseJSONFrom(html, marker) {
  const i = html.indexOf(marker);
  if (i === -1) return null;
  const start = i + marker.length;
  // Find the matching closing brace for the JSON object starting at first '{'
  let j = html.indexOf('{', start);
  if (j === -1) return null;
  let depth = 0;
  for (let k = j; k < html.length; k++) {
    const ch = html[k];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        const json = html.slice(j, k + 1);
        try { return JSON.parse(json); } catch (_) { return null; }
      }
    }
  }
  return null;
}

function parsePlayerResponseAnywhere(html) {
  const key = 'ytInitialPlayerResponse';
  let i = html.indexOf(key);
  if (i === -1) return null;
  // Move to after key and possible separators
  let j = html.indexOf('{', i);
  if (j === -1) return null;
  let depth = 0;
  for (let k = j; k < html.length; k++) {
    const ch = html[k];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        const json = html.slice(j, k + 1);
        try { return JSON.parse(json); } catch (_) { return null; }
      }
    }
  }
  return null;
}

async function fetchPlayerResponseByApi(id, options, headers) {
  try {
    const url = `https://www.youtube.com/get_video_info?video_id=${encodeURIComponent(id)}&el=detailpage`;
    const txt = await getText(url, { headers, proxy: options.proxy, timeout: (options.timeout||30)*1000, family: options.ipVersion });
    const params = new (require('url').URLSearchParams)(txt);
    const pr = params.get('player_response');
    if (pr) return JSON.parse(pr);
  } catch (_) {}
  return null;
}

function pickBestFormat(player, formatSpec) {
  const sd = player && player.streamingData;
  if (!sd) return null;
  const formats = ([]).concat(sd.formats || [], sd.adaptiveFormats || []);
  // Prefer progressive formats with direct URL
  const withUrl = formats.filter((f) => f && (f.url || f.signatureCipher || f.cipher));

  // Minimal format selector
  const select = (list) => list.sort((a, b) => (b.height || 0) - (a.height || 0) || (b.bitrate || 0) - (a.bitrate || 0))[0];
  const filterBy = (list, pred) => list.filter(pred);
  // Expanded: parse a simple format chain
  const { parseFormatExpr } = require('../format');
  const chain = parseFormatExpr(formatSpec);
  const matches = (f, filters) => {
    if (!filters) return true;
    if (filters.itag && parseInt(f.itag || 0, 10) !== filters.itag) return false;
    if (filters.heightLe && (f.height || 0) > filters.heightLe) return false;
    if (filters.ext && !String(f.mimeType || '').includes(filters.ext)) return false;
    if (filters.vcodec && !String(f.codecs || f.mimeType || '').includes(filters.vcodec)) return false;
    if (filters.acodec && !String(f.codecs || f.mimeType || '').includes(filters.acodec)) return false;
    if (filters.fpsLe && (f.fps || 0) > filters.fpsLe) return false;
    if (filters.brLe) {
      const br = f.bitrate || f.averageBitrate || 0;
      if (br > filters.brLe * 1000) return false; // kbps
    }
    return true;
  };
  for (const step of chain) {
    if (step.type === 'join') {
      const vids = filterBy(withUrl, (f) => /^video\//.test(String(f.mimeType || '')) && matches(f, step.filters));
      const auds = filterBy(withUrl, (f) => /^audio\//.test(String(f.mimeType || '')) && matches(f, step.filters));
      const v = select(vids);
      const a = select(auds);
      if (v && a) return { join: true, video: v, audio: a };
      continue;
    }
    if (step.type === 'worst') {
      const asc = (list) => list.sort((a, b) => (a.height || 0) - (b.height || 0) || (a.bitrate || 0) - (b.bitrate || 0))[0];
      let candidates = withUrl.filter((f) => !!f.url && matches(f, step.filters));
      if (candidates.length) return asc(candidates);
    }
    // best/single/auto
    let candidates = withUrl.filter((f) => !!f.url && /^video\//.test(String(f.mimeType || '')) && matches(f, step.filters));
    if (!candidates.length) candidates = withUrl.filter((f) => !!f.url && matches(f, step.filters));
    if (candidates.length) return select(candidates);
  }
  // If only signatureCipher present, we cannot decipher yet
  return { needsSig: true, format: withUrl[0] || null };
}

function extractVideoId(url) {
  try {
    const u = new URL(url);
    if (u.host.includes('youtu.be')) return u.pathname.slice(1);
    if (u.searchParams.has('v')) return u.searchParams.get('v');
  } catch (_) {}
  // Fallback try simple regex
  const m = url.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
  return m ? m[1] : null;
}

function extractCaptions(player, allowAuto = false) {
  const cap = player && player.captions && player.captions.playerCaptionsTracklistRenderer;
  let tracks = [];
  if (cap && Array.isArray(cap.captionTracks)) {
    tracks = tracks.concat(cap.captionTracks.map((t) => ({ url: t.baseUrl, lang: t.languageCode, name: t.name && (t.name.simpleText || t.name.runs && t.name.runs[0] && t.name.runs[0].text) })));
  }
  if (allowAuto && cap && Array.isArray(cap.audioTracks) && Array.isArray(cap.captionTracks)) {
    // Some responses list autoCaptions differently; attempt to include if present
    const auto = cap.autoCaptions || [];
    for (const group of auto) {
      if (group && Array.isArray(group.tracks)) {
        tracks = tracks.concat(group.tracks.map((t) => ({ url: t.baseUrl, lang: t.languageCode, name: (t.kind || 'auto') })));
      }
    }
  }
  return tracks;
}

class YouTubeExtractor extends InfoExtractor {
  get IE_DESC() { return 'YouTube.com'; }

  suitable(url) {
    return /(^https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\//i.test(url);
  }

  async extract(url, options = {}) {
    const id = extractVideoId(url);
    const watchUrl = id ? `https://www.youtube.com/watch?v=${id}` : url;
    const headers = {};
    // Default to a modern Chrome UA if not provided
    headers['User-Agent'] = options.userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
    if (!options.headers || !options.headers['Accept-Language']) headers['Accept-Language'] = 'en-US,en;q=0.9';
    if (options.userAgent) headers['User-Agent'] = options.userAgent;
    if (options.referer) headers['Referer'] = options.referer;
    const html = await getText(watchUrl, { headers, proxy: options.proxy, timeout: (options.timeout||30)*1000, family: options.ipVersion, cacheTTL: 0, cookieJar: options.cookies });

    let playerResp = parseJSONFrom(html, 'ytInitialPlayerResponse = ')
      || parseJSONFrom(html, 'var ytInitialPlayerResponse = ')
      || parsePlayerResponseAnywhere(html);
    if (!playerResp && id) {
      playerResp = await fetchPlayerResponseByApi(id, options, headers);
    }
    if (!playerResp) throw new Error('YouTube: player response not found');

    const videoDetails = playerResp.videoDetails || {};
    const captions = extractCaptions(playerResp, options.allowAutoSubs);
    // Thumbnails
    let thumbs = [];
    if (videoDetails && videoDetails.thumbnail && Array.isArray(videoDetails.thumbnail.thumbnails)) {
      thumbs = videoDetails.thumbnail.thumbnails;
    }
    const title = videoDetails.title || 'YouTube Video';
    const uploader = videoDetails.author || '';
    const uploadDate = (videoDetails.publishDate || '').replace(/-/g, '');
    const sd = playerResp && playerResp.streamingData || {};
    // If HLS/DASH manifests are present, return those
    if (sd.hlsManifestUrl) {
      return {
        id: (playerResp.videoDetails && playerResp.videoDetails.videoId) || id || watchUrl,
        title: (playerResp.videoDetails && playerResp.videoDetails.title) || 'YouTube Video',
        viewCount: videoDetails.viewCount ? parseInt(videoDetails.viewCount, 10) : null,
        ext: 'mp4',
        hlsManifestUrl: sd.hlsManifestUrl
      };
    }
    if (sd.dashManifestUrl) {
      return {
        id: (playerResp.videoDetails && playerResp.videoDetails.videoId) || id || watchUrl,
        title: (playerResp.videoDetails && playerResp.videoDetails.title) || 'YouTube Video',
        viewCount: videoDetails.viewCount ? parseInt(videoDetails.viewCount, 10) : null,
        ext: 'mp4',
        dashManifestUrl: sd.dashManifestUrl
      };
    }

    const chosen = pickBestFormat(playerResp, options.format);
    if (!chosen) throw new Error('YouTube: no formats available');
    let finalUrl;
    let fmt = chosen;
    if (fmt.join) {
      // Separate video+audio selection
      const pick = async (f) => {
        if (f.url) return f.url;
        const sc = f.signatureCipher || f.cipher;
        if (sc) {
          const params = Object.fromEntries(sc.split('&').map(kv => kv.split('=').map(decodeURIComponent)));
          const s = params.s; const sp = params.sp || 'signature'; const urlBase = params.url;
          if (s && urlBase) {
            try {
              const sig = await decipher(html, watchUrl, s, { proxy: options.proxy, timeout: (options.timeout||30)*1000, family: options.ipVersion, cookieJar: options.cookies });
              const joiner = urlBase.includes('?') ? '&' : '?';
              return `${urlBase}${joiner}${sp}=${encodeURIComponent(sig)}`;
            } catch (e) {
              // Fallback to python extractor
              const py = await extractWithPython(watchUrl, options);
              if (Array.isArray(py.requested_formats) && py.requested_formats.length >= 2) {
                // best video+audio chosen by youtube-dl
                const v = py.requested_formats.find(r => /video\//.test(String(r.mime_type||''))) || py.requested_formats[0];
                const a = py.requested_formats.find(r => /audio\//.test(String(r.mime_type||''))) || py.requested_formats[1];
                if (f === fmt.video) return v && v.url;
                if (f === fmt.audio) return a && a.url;
              }
              throw e;
            }
          }
        }
        return null;
      };
      const vUrl = await pick(fmt.video);
      const aUrl = await pick(fmt.audio);
      const mimeV = String(fmt.video.mimeType || '');
      const vext = mimeV.includes('webm') ? 'webm' : 'mp4';
      const aext = 'm4a';
      return { id: videoDetails.videoId || id || watchUrl, title, uploader, uploadDate, viewCount: videoDetails.viewCount ? parseInt(videoDetails.viewCount, 10) : null, ext: vext, videoUrl: vUrl, audioUrl: aUrl, vext, aext };
    }
    if (chosen.needsSig && chosen.format) {
      fmt = chosen.format;
    }
    if (fmt.signatureCipher || fmt.cipher) {
      const sc = fmt.signatureCipher || fmt.cipher; // querystring-like
      const params = Object.fromEntries(sc.split('&').map(kv => kv.split('=').map(decodeURIComponent)));
      const s = params.s;
      const sp = params.sp || 'signature';
      const urlBase = params.url;
      if (s && urlBase) {
        try {
          const sig = await decipher(html, watchUrl, s, { proxy: options.proxy, timeout: (options.timeout||30)*1000, family: options.ipVersion, cookieJar: options.cookies });
          const joiner = urlBase.includes('?') ? '&' : '?';
          finalUrl = `${urlBase}${joiner}${sp}=${encodeURIComponent(sig)}`;
        } catch (e) {
          // Fallback to python extractor
          const py = await extractWithPython(watchUrl, options);
          if (py && py.url) {
            finalUrl = py.url;
            const mt = String(py.ext || py.format || py.format_note || '');
            if (/webm/.test(mt)) ext = 'webm';
          } else if (Array.isArray(py.requested_formats) && py.requested_formats.length) {
            const av = py.requested_formats.sort((a,b)=>((b.height||0)-(a.height||0))||((b.tbr||0)-(a.tbr||0)))[0];
            finalUrl = av && av.url;
          } else {
            throw e;
          }
        }
      }
    }
    if (!finalUrl && fmt && fmt.url) finalUrl = fmt.url;

    const mime = String(fmt && fmt.mimeType || '');
    let ext = 'mp4';
    if (mime.includes('webm')) ext = 'webm';
    else if (mime.includes('3gpp')) ext = '3gp';

    // If chosen is adaptive video, try to also pick audio
    const isVideoOnly = mime.startsWith('video/') && !fmt.audioQuality;
    if (isVideoOnly) {
      const formats = ([]).concat(sd.formats || [], sd.adaptiveFormats || []);
      const audio = formats
        .filter((f) => f && String(f.mimeType || '').startsWith('audio/') && (f.url || f.signatureCipher || f.cipher))
        .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0];
      let audioUrl = audio && audio.url;
      if (!audioUrl && audio && (audio.signatureCipher || audio.cipher)) {
        const sc = audio.signatureCipher || audio.cipher;
        const params = Object.fromEntries(sc.split('&').map(kv => kv.split('=').map(decodeURIComponent)));
        const s = params.s; const sp = params.sp || 'signature'; const urlBase = params.url;
        if (s && urlBase) {
          try {
            const sig = await decipher(html, watchUrl, s, { proxy: options.proxy, timeout: (options.timeout||30)*1000, family: options.ipVersion, cookieJar: options.cookies });
            const joiner = urlBase.includes('?') ? '&' : '?';
            audioUrl = `${urlBase}${joiner}${sp}=${encodeURIComponent(sig)}`;
          } catch (e) {
            // Fallback to python to get audio URL
            const py = await extractWithPython(watchUrl, options);
            if (Array.isArray(py.requested_formats)) {
              const a = py.requested_formats.find(r => /audio\//.test(String(r.mime_type||'')));
              audioUrl = a && a.url || audioUrl;
            }
          }
        }
      }
      return { id: videoDetails.videoId || id || watchUrl, title, viewCount: videoDetails.viewCount ? parseInt(videoDetails.viewCount, 10) : null, ext, videoUrl: finalUrl, audioUrl, vext: ext, aext: 'm4a', subtitles: captions, thumbnails: thumbs, info: playerResp };
    }

    return { id: videoDetails.videoId || id || watchUrl, title, uploader, uploadDate, viewCount: videoDetails.viewCount ? parseInt(videoDetails.viewCount, 10) : null, ext, url: finalUrl, subtitles: captions, thumbnails: thumbs, info: playerResp };
  }

  async listFormats(url, options = {}) {
    const id = extractVideoId(url);
    const watchUrl = id ? `https://www.youtube.com/watch?v=${id}` : url;
    const headers = {};
    if (options.userAgent) headers['User-Agent'] = options.userAgent;
    if (options.referer) headers['Referer'] = options.referer;
    const html = await getText(watchUrl, { headers, proxy: options.proxy, timeout: (options.timeout||30)*1000, family: options.ipVersion });
    const playerResp = parseJSONFrom(html, 'ytInitialPlayerResponse = ') || parseJSONFrom(html, 'var ytInitialPlayerResponse = ');
    if (!playerResp) throw new Error('YouTube: player response not found');
    const sd = playerResp.streamingData || {};
    const vd = playerResp.videoDetails || {};
    const duration = parseInt(vd.lengthSeconds || '0', 10) || 0;
    const formats = ([]).concat(sd.formats || [], sd.adaptiveFormats || []);
    const lines = formats.map((f) => {
      const mt = String(f.mimeType || '');
      const itag = f.itag || '';
      const height = f.height || '';
      const fps = f.fps || '';
      const br = f.bitrate || f.averageBitrate || 0;
      const approx = duration ? Math.round((br * duration) / 8 / (1024 * 1024)) : '';
      const note = String(mt).startsWith('audio/') ? 'audio' : (String(mt).startsWith('video/') && !f.audioQuality ? 'video' : 'av');
      const codecs = (mt.split('; codecs=')[1] || '').replace(/[\"']/g, '');
      const hasUrl = f.url ? 'url' : (f.signatureCipher || f.cipher) ? 'sig' : '';
      return `${itag}\t${mt}\t${height}p@${fps}\t${Math.round(br/1000)}kbps\t~${approx}MiB\t${codecs}\t${note}\t${hasUrl}`;
    });
    return lines;
  }
}

module.exports = { YouTubeExtractor };

