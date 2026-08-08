/* =====================================================================
   CONFIG — endpoints, storage keys, tunables
   ===================================================================== */

const CONFIG = {
  // AREDL: public API, docs at https://api.aredl.net/v2/docs. Confirmed
  // against the open-source backend (github.com/All-Rated-Extreme-Demon-List/aredl-backend-v2):
  // GET /levels returns bare-bones entries (no video/verifier/creators —
  // those only exist on GET /levels/{id} and GET /levels/{id}/creators),
  // and /levels ignores limit/offset entirely, always returning the full
  // list. api-aredl.js paginates that list client-side and lazily fetches
  // per-level detail for cards as they scroll into view. AREDL's CORS
  // headers are correct, so no proxy fallback is needed for it (unlike
  // Pointercrate, which this app no longer talks to).
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

  // The shared, precomputed showcase/view-count cache committed to this
  // repo by .github/workflows/refresh-yt-cache.yml (see scripts/refresh-yt-cache.mjs).
  // A relative path so it resolves next to wherever index.html is served
  // from (GitHub Pages, a fork, a local `python -m http.server`, etc.)
  // without needing an absolute origin baked in.
  SHARED_YT_CACHE_URL: 'data/yt-cache.json',
  SHARED_YT_CACHE_TTL_MS: 1000 * 60 * 60, // re-fetch the file at most once an hour per visitor

  // localStorage keys
  STORAGE: {
    YT_KEY: 'gddl_yt_api_key',
    YT_CACHE: 'gddl_yt_cache_v1',              // { [cacheKey]: { data, ts } } — personal-key on-demand lookups
    YT_QUOTA_RESET_AT: 'gddl_yt_quota_reset_at', // { search: msTimestamp, videos: msTimestamp }, set per-endpoint once YouTube reports a quota error
    SHARED_YT_CACHE: 'gddl_shared_yt_cache_v1', // local mirror of data/yt-cache.json, { fetchedAt, byId }
  },

  YT_CACHE_TTL_MS: 1000 * 60 * 60 * 6, // 6 hours — personal on-demand lookups only; the shared cache has its own TTL above

  // YouTube quota protection (see js/youtube.js) for the *personal-key*
  // fallback path — the shared cache (above) is what keeps everyday
  // browsing from touching YouTube's API at all. The fallback only fires
  // for a level the shared cache hasn't reached yet (new, or not due for
  // its staggered refresh — see scripts/refresh-yt-cache.mjs), and only
  // for visitors who've added their own key.
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
