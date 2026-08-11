/* =====================================================================
   CONFIG — endpoints, storage keys, tunables
   ===================================================================== */

// Repo this site is deployed from, and the branch its scheduled cache-
// refresh workflows commit to — deliberately NOT `main`. See README's
// "Cache branch" section: keeping the every-30-min/hourly/daily bot
// commits off `main` means a human's `git push` there never gets
// rejected by "remote contains work you do not have" from a cache
// refresh that landed in between. Update GITHUB_REPO if you fork the
// project; CACHE_BRANCH only needs to change if you rename the branch.
const GITHUB_REPO = 'potatdesigns/demonlist';
const CACHE_BRANCH = 'cache';
function rawCacheUrl(pathFromRepoRoot) {
  // raw.githubusercontent.com caches for ~5 minutes (Cache-Control:
  // max-age=300) — negligible next to how often these files actually
  // refresh (30 min / hourly / daily).
  return `https://raw.githubusercontent.com/${GITHUB_REPO}/${CACHE_BRANCH}/${pathFromRepoRoot}`;
}

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

  // Only the top LIST_SIZE positions (by AREDL's own ranking) are fetched,
  // cached, and displayed at all — AREDL's live list is much longer
  // (~1600 rated extreme demons and growing), but this app only tracks
  // the current top slice, sized to land exactly on the classic Main
  // List (1-75) + Extended List (76-150) split PAGE_SIZE's comment above
  // describes. Applied at the source: scripts/refresh-aredl-cache.mjs
  // only writes the top LIST_SIZE levels to data/aredl-cache.json, and
  // scripts/refresh-yt-cache.mjs prunes data/yt-cache.json to match
  // (dropping levels that fall out of the top LIST_SIZE as positions
  // shift) — so the "1600 levels" management burden this was added to
  // avoid never actually lands in either cache file, not just hidden
  // client-side. AredlAPI.fetchFromLiveApi()'s fallback path (used only
  // if the snapshot is missing) also slices to this, so the live-API
  // fallback can't show more than the cached snapshot ever would.
  LIST_SIZE: 150,

  // Public passthrough CORS proxies, tried in order, used only when a
  // direct fetch() fails outright (network/CORS block) — see
  // corsFetchJson() in utils.js. These proxies always answer with HTTP
  // 200 regardless of the upstream status, so callers must sanity-check
  // the parsed body rather than trust res.ok when viaProxy is true.
  CORS_PROXIES: [
    (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  ],

  // The shared, precomputed showcase/view-count cache committed to the
  // `cache` branch (not `main`, see above) by
  // .github/workflows/refresh-yt-cache.yml + refresh-yt-views.yml (see
  // scripts/refresh-yt-cache.mjs, which is where the YouTube-quota-
  // related tunables now live — this site itself makes no client-side
  // YouTube API calls at all). Fetched fresh every page load (see
  // js/shared-cache.js) — no client-side TTL, since that was exactly
  // what caused stale data to stick around.
  SHARED_YT_CACHE_URL: rawCacheUrl('data/yt-cache.json'),

  // Same idea, but for AREDL's own level list — see scripts/refresh-aredl-cache.mjs
  // + .github/workflows/refresh-aredl-cache.yml (hourly, no key needed).
  // AredlAPI.fetchFullList() reads this first and only falls back to a
  // live AREDL call if the snapshot is missing or fails to load.
  AREDL_CACHE_URL: rawCacheUrl('data/aredl-cache.json'),

  // Per-level position-change log, written by the same script/workflow
  // as AREDL_CACHE_URL above — see PositionHistory in js/position-history.js,
  // read by the detail page.
  POSITION_HISTORY_URL: rawCacheUrl('data/position-history.json'),

  // Used to build a fallback link to the GitHub Actions "run workflow"
  // page (see js/cache-admin-ui.js) for whenever TRIGGER_WORKER_URL
  // below isn't set.
  GITHUB_REPO,

  // Cloudflare Worker that lets any visitor actually trigger a cache
  // refresh (site-wide queue run, or a single level) without needing a
  // GitHub sign-in — the Worker holds the GitHub token and rate-limits
  // requests server-side; nothing privileged lives in this file. See
  // worker/ + README's "One-click refresh trigger" section to deploy
  // one. Left blank until you do: js/cache-admin-ui.js falls back to
  // the old copy-the-id-and-open-GitHub flow (which still needs repo
  // write access to actually run) whenever this is empty, so the
  // refresh buttons work in degraded form even before you set this.
  TRIGGER_WORKER_URL: 'https://demonlist-cache-trigger.lukeguo87-470.workers.dev',

  // localStorage keys
  STORAGE: {
    SHARED_YT_CACHE: 'gddl_shared_yt_cache_v1', // local mirror of data/yt-cache.json, { fetchedAt, data }
    POSITION_HISTORY: 'gddl_position_history_v1', // local mirror of data/position-history.json, { fetchedAt, data }
    SETTINGS: 'gddl_settings_v1', // js/settings.js — theme, motion, etc.; see Settings.DEFAULTS there
    ROULETTE_RUN: 'gddl_roulette_run_v1', // js/roulette.js — the in-progress (or last-finished) Extreme Demon Roulette run, so a reload mid-run doesn't lose progress
  },
};
