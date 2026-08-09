/* =====================================================================
   UTILS
   ===================================================================== */

function qs(param) {
  return new URLSearchParams(window.location.search).get(param);
}

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
 * Continuous difficulty color for a level's rank position relative to the
 * list's total length — bright red at position 1 (hardest) sweeping down
 * to bright purple at position = total (easiest), rather than sorting
 * positions into a handful of discrete buckets (see git history for why
 * that approach fell short — it front-loaded all the visual variety into
 * the first ~15% of the list). 11 evenly-spaced key points (~every 15
 * positions across 150) walk the hue wheel from 360deg (red) down to
 * 270deg (purple) — the *short* way, through pink/magenta, deliberately
 * never crossing orange/yellow/green/cyan/blue, so the sweep reads as one
 * deliberate red-to-purple gradient rather than looping around toward
 * blue and back.
 */
const POSITION_COLOR_STOPS = ['#942efa', '#b22efa', '#d12efa', '#ef2efa', '#fa2ee5', '#fa2ec7', '#fa2ea8', '#fa2e8a', '#fa2e6b', '#fa2e4d', '#fa2e2e'];

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgbToHex(rgb) {
  return '#' + rgb.map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
}

function positionColor(position, total) {
  if (!position || !total || total <= 1) return POSITION_COLOR_STOPS[POSITION_COLOR_STOPS.length - 1];
  const t = 1 - (position - 1) / (total - 1); // 1 at position 1 (hardest) -> 0 at position=total (easiest)
  const scaled = Math.min(1, Math.max(0, t)) * (POSITION_COLOR_STOPS.length - 1);
  const i = Math.min(POSITION_COLOR_STOPS.length - 2, Math.floor(scaled));
  const localT = scaled - i;
  const a = hexToRgb(POSITION_COLOR_STOPS[i]);
  const b = hexToRgb(POSITION_COLOR_STOPS[i + 1]);
  return rgbToHex(a.map((v, k) => v + (b[k] - v) * localT));
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
