/* =====================================================================
   CONFIG — endpoints, storage keys, tunables
   ===================================================================== */

const CONFIG = {
  // Pointercrate: public, no key required for reads. Every route needs a
  // trailing slash (Rocket treats "/listed" and "/listed/" as different
  // routes) and the app sends no CORS headers of its own, so cross-origin
  // browser fetch()es need the corsFetchJson() fallback in utils.js.
  // Docs: https://pointercrate.com/documentation/index/
  POINTERCRATE_BASE: 'https://pointercrate.com/api/v2',

  // AREDL: public API, docs at https://api.aredl.net/v2/docs. Confirmed
  // against the open-source backend (github.com/All-Rated-Extreme-Demon-List/aredl-backend-v2):
  // GET /levels returns bare-bones entries (no video/verifier/creators —
  // those only exist on GET /levels/{id} and GET /levels/{id}/creators),
  // and /levels ignores limit/offset entirely, always returning the full
  // list. api-aredl.js paginates that list client-side and lazily fetches
  // per-level detail for cards as they scroll into view. AREDL's CORS
  // headers are already correct, so no proxy fallback is needed there.
  AREDL_BASE: 'https://api.aredl.net/v2/api/aredl',

  PAGE_SIZE: 24,

  // Public passthrough CORS proxies, tried in order, used only when a
  // direct fetch() fails outright (network/CORS block) — see
  // corsFetchJson() in utils.js. These proxies always answer with HTTP
  // 200 regardless of the upstream status, so callers must sanity-check
  // the parsed body rather than trust res.ok when viaProxy is true.
  CORS_PROXIES: [
    (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  ],

  // localStorage keys
  STORAGE: {
    SOURCE: 'gddl_source',           // 'pointercrate' | 'aredl'
    YT_KEY: 'gddl_yt_api_key',
    YT_CACHE: 'gddl_yt_cache_v1',    // { [cacheKey]: { data, ts } }
    YT_QUOTA_RESET_AT: 'gddl_yt_quota_reset_at', // { search: msTimestamp, videos: msTimestamp }, set per-endpoint once YouTube reports a quota error
  },

  YT_CACHE_TTL_MS: 1000 * 60 * 60 * 6, // 6 hours

  // YouTube quota protection (see js/youtube.js):
  //  - search.list costs 100 units, videos.list costs 1 — the search calls
  //    in findBestShowcase() are what actually burns a 10,000/day quota,
  //    so those stay minimal-queries-first and results are cached hard.
  //  - requests are funneled through a small concurrency-limited, spaced
  //    queue so a fast scroll through many cards can't fire a burst that
  //    trips YouTube's short-window abuse detection.
  YT_MAX_CONCURRENT: 2,
  YT_MIN_INTERVAL_MS: 150,

  // Channels known for high-production showcase/completion videos.
  // Used to bias the "best showcase" search toward reliable sources
  // before falling back to a plain view-count sort across all results.
  SHOWCASE_CHANNELS: [
    'Nexus', 'Neiro', 'Requi', 'ThatSlurpo', 'iamgd10', 'Bezt',
    'Bagage GD', 'Chevron GD', 'Dorami', 'Silica GD', 'zenithGD',
  ],
};

function getSource() {
  return localStorage.getItem(CONFIG.STORAGE.SOURCE) || 'pointercrate';
}
function setSource(src) {
  localStorage.setItem(CONFIG.STORAGE.SOURCE, src);
}
