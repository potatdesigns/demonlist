/* =====================================================================
   UTILS
   ===================================================================== */

function formatCount(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  if (n < 1000) return String(n);
  if (n < 1_000_000) return (n / 1000).toFixed(n < 10_000 ? 1 : 0) + 'K';
  return (n / 1_000_000).toFixed(n < 10_000_000 ? 1 : 0) + 'M';
}

function extractYouTubeId(url) {
  if (!url) return null;
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtube\.com\/shorts\/|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return null;
}

function youTubeThumbnail(videoUrl) {
  const id = extractYouTubeId(videoUrl);
  if (!id) return null;
  return `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;
}

/**
 * fetch() that falls back to a public CORS proxy (config.js CORS_PROXIES)
 * when the direct request fails outright — the browser-level symptom of a
 * server that sends no Access-Control-Allow-Origin header, which shows up
 * as a bare "Failed to fetch" TypeError with no useful status code.
 *
 * Also treats an HTML error page served with a non-2xx status as a signal
 * to try the proxy (some CDN/bot-protection challenge pages slip through
 * as a "successful" fetch from the browser's point of view).
 *
 * Proxies used here always answer 200 regardless of the upstream status,
 * so `res.viaProxy` is set on the returned Response so callers can decide
 * how much to trust `res.ok` / do their own shape-sanity-check on proxied
 * bodies instead.
 */
async function corsFetchJson(url, { headers = {} } = {}) {
  const reqHeaders = { Accept: 'application/json', ...headers };

  let direct;
  let directErr;
  try {
    direct = await fetch(url, { headers: reqHeaders });
  } catch (e) {
    directErr = e;
  }

  if (direct) {
    const looksLikeBlockedChallenge = !direct.ok && (direct.headers.get('content-type') || '').includes('text/html');
    if (!looksLikeBlockedChallenge) {
      direct.viaProxy = false;
      return direct;
    }
  }

  const proxies = (CONFIG.CORS_PROXIES || []);
  for (const buildProxyUrl of proxies) {
    try {
      const res = await fetch(buildProxyUrl(url), { headers: { Accept: 'application/json' } });
      if (res.ok) {
        res.viaProxy = true;
        return res;
      }
    } catch { /* try the next proxy */ }
  }

  if (direct) { direct.viaProxy = false; return direct; } // return the original blocked/error response as a last resort
  const err = new Error(
    `Couldn't reach the API directly — this is almost always the server not allowing cross-origin browser requests — ` +
    `and the CORS-proxy fallback failed too. Check your connection and try again in a moment.`
  );
  err.cause = directErr;
  throw err;
}

/**
 * Fallback difficulty color for a level's rank position relative to the
 * list's total length, used until (or unless) resolveThumbnailColor()
 * below finds something better from the level's own thumbnail. A full
 * hue sweep — 0deg (red) at position 1 (hardest) the long way round to
 * 270deg (violet) at position = total (easiest), through orange, yellow,
 * green, cyan and blue — so the list actually reads as a spectrum instead
 * of 150 shades of the same pink/magenta family (the previous version
 * stayed within a 90deg red-to-purple wedge deliberately avoiding every
 * other hue, which made the top and bottom of the list look almost the
 * same color). Constant saturation/lightness keeps every stop equally
 * vivid regardless of hue.
 */
function positionColor(position, total) {
  if (!position || !total || total <= 1) return 'hsl(270, 74%, 60%)';
  const t = Math.min(1, Math.max(0, (position - 1) / (total - 1))); // 0 at position 1 (hardest) -> 1 at position=total (easiest)
  const hue = t * 270;
  return `hsl(${hue.toFixed(1)}, 74%, 60%)`;
}

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l * 100];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0));
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h * 60, s * 100, l * 100];
}

/**
 * "Vibrant" dominant color from a loaded, decoded <img> — downscales onto
 * a small canvas, quantizes pixels into coarse RGB buckets, and picks the
 * most common bucket after throwing out near-black/near-white/desaturated
 * pixels (GD gameplay thumbnails are mostly black background and white
 * UI, which would otherwise win almost every vote). The winning bucket is
 * then re-normalized to a fixed saturation/lightness band so a washed-out
 * or over-dark source frame still reads as a clear accent color, the same
 * job positionColor()'s fixed 74%/60% did for the fallback gradient.
 * Returns null (caller falls back to positionColor()) if the image has no
 * vivid pixels at all (rare — e.g. a pure grayscale thumbnail) or the
 * canvas read throws (untainted-canvas edge cases, decode failures).
 */
function dominantColor(img) {
  try {
    const w = 24, h = 14;
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, w, h);
    const { data } = ctx.getImageData(0, 0, w, h);

    const buckets = new Map();
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
      if (a < 128) continue;
      const [, s, l] = rgbToHsl(r, g, b);
      if (l < 10 || l > 90 || s < 18) continue;
      const key = `${r >> 4},${g >> 4},${b >> 4}`; // quantize to 16 steps/channel
      const cur = buckets.get(key) || { r: 0, g: 0, b: 0, n: 0 };
      cur.r += r; cur.g += g; cur.b += b; cur.n++;
      buckets.set(key, cur);
    }
    if (!buckets.size) return null;
    let best = null;
    for (const bucket of buckets.values()) if (!best || bucket.n > best.n) best = bucket;
    const [hue] = rgbToHsl(best.r / best.n, best.g / best.n, best.b / best.n);
    return `hsl(${hue.toFixed(1)}, 74%, 60%)`;
  } catch {
    return null;
  }
}

const THUMB_COLOR_CACHE_KEY = 'gddl_thumb_colors_v1';
let thumbColorCache = null;
function loadThumbColorCache() {
  if (thumbColorCache) return thumbColorCache;
  try { thumbColorCache = JSON.parse(localStorage.getItem(THUMB_COLOR_CACHE_KEY) || '{}'); }
  catch { thumbColorCache = {}; }
  return thumbColorCache;
}
function saveThumbColor(src, color) {
  const cache = loadThumbColorCache();
  cache[src] = color;
  try { localStorage.setItem(THUMB_COLOR_CACHE_KEY, JSON.stringify(cache)); } catch { /* storage full/disabled — extraction just re-runs next visit */ }
}

/**
 * Resolves a level's accent color from its thumbnail's own dominant color
 * (see dominantColor() above) instead of always using the rank-based
 * gradient, so a card's glow actually matches what's in the frame.
 * Cached in localStorage by thumbnail URL — thumbnails don't change once
 * AREDL has a video on file, so repeat visits skip re-decoding every
 * image. Calls back with null (caller keeps its positionColor() value)
 * when there's no real thumbnail yet or extraction isn't possible.
 */
function resolveThumbnailColor(img, callback) {
  const src = img?.src;
  if (!src || src.startsWith('data:')) { callback(null); return; }
  const cache = loadThumbColorCache();
  if (src in cache) { callback(cache[src]); return; }
  const applyAndCache = () => {
    const color = dominantColor(img);
    saveThumbColor(src, color);
    callback(color);
  };
  if (img.complete) { applyAndCache(); return; }
  img.decode().then(applyAndCache).catch(() => { saveThumbColor(src, null); callback(null); });
}

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function debounce(fn, wait) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

/** Join a list of {name} / string creators into a display string. */
function joinNames(list, max = 3) {
  if (!list || list.length === 0) return 'Unknown';
  const names = list.map(c => (typeof c === 'string' ? c : c.name));
  if (names.length <= max) return names.join(', ');
  return `${names.slice(0, max).join(', ')} +${names.length - max}`;
}

/** Companion to joinNames() — the full comma-joined list, but only when joinNames() would actually truncate it (empty string otherwise, so callers can skip setting a redundant title/tooltip). Meant for a `title` attribute on whatever joinNames()'s text renders into, so a "+N" is hoverable to see who's hidden rather than a dead end. */
function namesTitle(list, max = 3) {
  if (!list || list.length <= max) return '';
  return list.map(c => (typeof c === 'string' ? c : c.name)).join(', ');
}
