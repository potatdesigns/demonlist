/* =====================================================================
   UTILS
   ===================================================================== */

function formatCount(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  if (n < 1000) return String(n);
  if (n < 1_000_000) return (n / 1000).toFixed(n < 10_000 ? 1 : 0) + 'K';
  return (n / 1_000_000).toFixed(n < 10_000_000 ? 1 : 0) + 'M';
}

/** "3h ago" / "2d ago" style relative time, for the home page's recent-changes panel. Falls back to a plain date past a month out — nobody needs "changelog" precision on something from three months ago. */
function timeAgo(isoString) {
  const then = new Date(isoString).getTime();
  if (!Number.isFinite(then)) return '';
  const seconds = Math.max(0, (Date.now() - then) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = seconds / 60;
  if (minutes < 60) return `${Math.floor(minutes)}m ago`;
  const hours = minutes / 60;
  if (hours < 24) return `${Math.floor(hours)}h ago`;
  const days = hours / 24;
  if (days < 30) return `${Math.floor(days)}d ago`;
  return new Date(then).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
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

/** Same video, higher resolution (480x360 vs. mqdefault's 320x180) — always present for a real video (unlike maxresdefault, which YouTube only generates for some), so no placeholder-detection dance needed. Used where a thumbnail is shown larger/more prominently than a list card (the home page's spotlight cards) and mqdefault would visibly soften. */
function youTubeThumbnailHQ(videoUrl) {
  const id = extractYouTubeId(videoUrl);
  if (!id) return null;
  return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
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
 * Dominant color from a loaded, decoded <img> — downscales onto a small
 * canvas, quantizes pixels into coarse RGB buckets, and scores each
 * bucket by population *and* saturation (a saturated bucket outweighs an
 * equally-sized gray one, so real color still wins over background noise)
 * rather than raw frequency alone. Only true near-black/near-white pixels
 * are thrown out (background void / blown-out UI chrome, not "the
 * level's color"); everything else — including genuinely gray or muted
 * footage — stays a candidate, so a level that really is mostly gray
 * comes back gray rather than an invented vivid color. The winner's own
 * saturation/lightness are kept, just clamped into a band that stays
 * legible against the site's dark surfaces (a near-black or near-white
 * winner would otherwise vanish or blow out as a border/glow color).
 * Returns null (caller falls back to positionColor()) only if every
 * pixel was outside the near-black/near-white cutoffs, or the canvas
 * read throws (untainted-canvas edge cases, decode failures).
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
      const [, , l] = rgbToHsl(r, g, b);
      if (l < 8 || l > 92) continue;
      const key = `${r >> 4},${g >> 4},${b >> 4}`; // quantize to 16 steps/channel
      const cur = buckets.get(key) || { r: 0, g: 0, b: 0, n: 0 };
      cur.r += r; cur.g += g; cur.b += b; cur.n++;
      buckets.set(key, cur);
    }
    if (!buckets.size) return null;

    let best = null, bestScore = -1;
    for (const bucket of buckets.values()) {
      const [, s, l] = rgbToHsl(bucket.r / bucket.n, bucket.g / bucket.n, bucket.b / bucket.n);
      // Strongly favor saturated, moderately bright buckets over merely-large
      // ones — a small patch of vivid color should beat a big wash of dull
      // background. Population is sqrt-damped rather than dropped entirely,
      // so a single stray pixel still can't outscore a real area of color.
      // This only ranks buckets that actually exist in the frame, so it
      // never invents color: a level whose footage really is gray
      // throughout still comes back gray — every candidate scores equally
      // low on vividness, so brightness/population settle the tie instead.
      const vividness = Math.pow(s / 100, 1.3);
      const brightness = Math.max(0, 1 - Math.abs(l - 58) / 58); // peaks near l=58, tapers toward the (already-filtered) extremes
      const score = Math.sqrt(bucket.n) * (0.15 + 0.85 * vividness) * (0.4 + 0.6 * brightness);
      if (score > bestScore) { bestScore = score; best = bucket; }
    }
    const [hue, sat, light] = rgbToHsl(best.r / best.n, best.g / best.n, best.b / best.n);
    const clampedSat = Math.max(15, Math.min(85, sat));
    const clampedLight = Math.max(30, Math.min(68, light));
    return `hsl(${hue.toFixed(1)}, ${clampedSat.toFixed(0)}%, ${clampedLight.toFixed(0)}%)`;
  } catch {
    return null;
  }
}

const THUMB_COLOR_CACHE_KEY = 'gddl_thumb_colors_v3'; // v3: dominantColor() now weights vividness/brightness much more heavily in bucket scoring — bumped so every level recalculates instead of serving stale v2 colors
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

/** Synchronous cache read, for a first-paint color instead of waiting on the card to scroll into view and hydrate — a repeat visitor's already-cached levels should never flash the gradient fallback first. undefined means "not cached yet" (still worth trying resolveThumbnailColor); null means "tried, no vivid color found" (don't retry). */
function getCachedThumbColor(src) {
  if (!src) return undefined;
  return loadThumbColorCache()[src];
}

/**
 * Resolves a level's accent color from its thumbnail's own dominant color
 * (see dominantColor() above) instead of always using the rank-based
 * gradient, so a card's glow actually matches what's in the frame.
 * Cached in localStorage, keyed by cacheKey (falls back to img.src) —
 * thumbnails don't change once AREDL has a video on file, so repeat
 * visits skip re-decoding every image. Pass an explicit cacheKey when the
 * actual <img> being sampled isn't the canonical thumbnail URL (e.g.
 * detail.js samples a higher-res maxresdefault/hqdefault probe for its
 * background, but caches under the same mqdefault URL js/list.js's cards
 * use — see youTubeThumbnail() — so the two pages share one cache entry
 * per level instead of each maintaining its own). Calls back with null
 * (caller keeps its positionColor() value) when there's no real
 * thumbnail yet or extraction isn't possible.
 */
function resolveThumbnailColor(img, callback, cacheKey) {
  const key = cacheKey || img?.src;
  if (!key || key.startsWith('data:')) { callback(null); return; }
  const cache = loadThumbColorCache();
  if (key in cache) { callback(cache[key]); return; }
  const applyAndCache = () => {
    const color = dominantColor(img);
    saveThumbColor(key, color);
    callback(color);
  };
  if (img.complete) { applyAndCache(); return; }
  img.decode().then(applyAndCache).catch(() => { saveThumbColor(key, null); callback(null); });
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
