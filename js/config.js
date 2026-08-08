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
  // headers are correct, so no proxy fallback is needed for it.
  AREDL_BASE: 'https://api.aredl.net/v2/api/aredl',

  // One page = 5 columns x 15 rows at desktop width (see css/list.css) —
  // Main List (#1-75) and Extended List (#76-150) each land exactly on
  // page 1 / page 2, which is what the two list-filter buttons jump to.
  PAGE_SIZE: 75,

  // Public passthrough CORS proxies, tried in order, used only when a
  // direct fetch() fails outright (network/CORS block) — see
  // corsFetchJson() in utils.js. These proxies always answer with HTTP
  // 200 regardless of the upstream status, so callers must sanity-check
  // the parsed body rather than trust res.ok when viaProxy is true.
  CORS_PROXIES: [
    (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  ],

  // The shared, precomputed showcase/view-count cache committed to this
  // repo by .github/workflows/refresh-yt-cache.yml + refresh-yt-views.yml
  // (see scripts/refresh-yt-cache.mjs, which is where the YouTube-quota-
  // related tunables now live — this site itself makes no client-side
  // YouTube API calls at all). A relative path so it resolves next to
  // wherever index.html is served from (GitHub Pages, a fork, a local
  // `python -m http.server`, etc.) without needing an absolute origin baked in.
  // Fetched fresh every page load (see js/shared-cache.js) — no client-side
  // TTL, since that was exactly what caused stale data to stick around.
  SHARED_YT_CACHE_URL: 'data/yt-cache.json',

  // Same idea, but for AREDL's own level list — see scripts/refresh-aredl-cache.mjs
  // + .github/workflows/refresh-aredl-cache.yml (hourly, no key needed).
  // AredlAPI.fetchFullList() reads this first and only falls back to a
  // live AREDL call if the snapshot is missing or fails to load.
  AREDL_CACHE_URL: 'data/aredl-cache.json',

  // Repo this site is deployed from — used only to build a link to the
  // GitHub Actions "run workflow" page (see the header's cache-refresh
  // button in list.js/detail.js). Update this if you fork the project.
  GITHUB_REPO: 'potatdesigns/demonlist',

  // localStorage keys
  STORAGE: {
    SHARED_YT_CACHE: 'gddl_shared_yt_cache_v1', // local mirror of data/yt-cache.json, { fetchedAt, data }
  },
};
