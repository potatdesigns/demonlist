/* =====================================================================
   AREDL ADAPTER
   Confirmed directly against the open-source backend
   (github.com/All-Rated-Extreme-Demon-List/aredl-backend-v2) and live
   responses from api.aredl.net, since the field names aren't published
   as plain-text docs the way Pointercrate's are — see src/aredl/levels/
   {model,routes}.rs, src/aredl/levels/records/model.rs and
   src/aredl/levels/creators/{model,routes}.rs in that repo.

   Two things the previous version of this file got wrong:

   1) GET /levels (the list) only returns bare-bones entries — id, name,
      position, points, legacy, level_id, two_player, tags, description,
      song, edel_enjoyment, gddl_tier, nlw_tier. No video, no thumbnail,
      no verifier, no creators, and `publisher` is just a `publisher_id`
      UUID, not a resolved player. All of that only exists on
      GET /levels/{id} (verification video + submitter live under
      `verifications[0]`, publisher is resolved) and the separate
      GET /levels/{id}/creators endpoint.

      Fetching per-level detail for all ~1600 levels up front isn't
      reasonable, so list cards start with the bare fields and get
      hydrated with video/thumbnail/verifier/publisher lazily as they
      scroll into view — see fetchExtras() below and list.js.

   2) GET /levels accepts `limit`/`offset` query params but silently
      ignores them and always returns the full list. Pagination here is
      done client-side: fetch the full list once (cached in memory for
      the session) and slice it.

   AREDL's CORS headers are already correct (confirmed: it reflects
   Access-Control-Allow-Origin per-origin), so no proxy fallback is
   needed here — corsFetchJson() is still used for resilience against
   transient network hiccups, but it'll almost always take the direct
   path.

   This app only tracks the top CONFIG.LIST_SIZE (150) of AREDL's ~1600
   levels — see the comment on CONFIG.LIST_SIZE in config.js for why and
   where that cap is applied. fetchFullList() below still fetches/sorts
   AREDL's response the same way; the cap is a `.slice(0, CONFIG.LIST_SIZE)`
   at the end of both fetchFromSnapshot() and fetchFromLiveApi().
   ===================================================================== */

const AredlAPI = (() => {

  const ENDPOINTS = {
    listed: () => `${CONFIG.AREDL_BASE}/levels`,
    detail: (id) => `${CONFIG.AREDL_BASE}/levels/${id}`,
    creators: (id) => `${CONFIG.AREDL_BASE}/levels/${id}/creators`,
  };

  /** AREDL players are { id, username, global_name } — global_name is the freely-set display name. */
  function normalizePlayer(u) {
    if (!u) return null;
    if (typeof u === 'string') return { id: null, name: u };
    return { id: u.id ?? null, name: u.global_name || u.username || String(u) };
  }

  // Bare list entry — video/verifier/thumbnail/publisher/creators aren't
  // available until fetchExtras() resolves for this card.
  function normalizeLevelBase(raw) {
    return {
      source: 'aredl',
      id: raw.id,
      name: raw.name,
      position: raw.position,
      videoUrl: null,
      thumbnail: null,
      levelId: raw.level_id ?? null,
      verifier: null,
      publisher: null,
      creators: [],
      needsExtras: true,
      raw,
    };
  }

  // Full detail (GET /levels/{id} + GET /levels/{id}/creators combined).
  function normalizeResolvedLevel(raw, creators) {
    const verification = (raw.verifications || [])[0] || null;
    const videoUrl = verification?.video_url || null;
    return {
      source: 'aredl',
      id: raw.id,
      name: raw.name,
      position: raw.position,
      videoUrl,
      thumbnail: youTubeThumbnail(videoUrl),
      levelId: raw.level_id ?? null,
      verifier: normalizePlayer(verification?.submitted_by),
      publisher: normalizePlayer(raw.publisher),
      creators: Array.isArray(creators) ? creators.map(normalizePlayer) : [],
      needsExtras: false,
      raw,
    };
  }

  // The list endpoint ignores limit/offset and always returns everything
  // (confirmed live: passing limit=3 still returns all ~1600 levels), and
  // every visitor re-fetching that same ~1600-entry list on every page
  // load is wasteful — so this reads the periodically-refreshed static
  // snapshot at CONFIG.AREDL_CACHE_URL first (see scripts/refresh-aredl-cache.mjs
  // + .github/workflows/refresh-aredl-cache.yml, hourly), and only falls
  // back to a live AREDL call if that snapshot is missing or fails to
  // load (e.g. before the workflow's first run). Either way, the result
  // is cached in memory for the rest of the session and paginated client-side.
  let fullListCache = null;
  let fullListPromise = null;
  function fetchFullList() {
    if (fullListCache) return Promise.resolve(fullListCache);
    if (!fullListPromise) {
      fullListPromise = (async () => {
        const snapshot = await fetchFromSnapshot();
        fullListCache = snapshot || await fetchFromLiveApi();
        return fullListCache;
      })().finally(() => { fullListPromise = null; });
    }
    return fullListPromise;
  }

  async function fetchFromSnapshot() {
    try {
      const res = await fetch(CONFIG.AREDL_CACHE_URL, { cache: 'no-cache' });
      if (!res.ok) return null;
      const data = await res.json();
      const list = Array.isArray(data?.levels) ? data.levels : null;
      return list && list.length ? list.slice().sort((a, b) => a.position - b.position).slice(0, CONFIG.LIST_SIZE) : null;
    } catch {
      return null; // missing file, bad JSON, whatever — fall back to the live API
    }
  }

  async function fetchFromLiveApi() {
    const res = await corsFetchJson(ENDPOINTS.listed());
    if (!res.ok && !res.viaProxy) {
      throw new Error(
        `AREDL returned ${res.status} for the level list. Its API shape may have changed — ` +
        `check https://api.aredl.net/v2/docs and update js/api-aredl.js.`
      );
    }
    const data = await res.json();
    const list = Array.isArray(data) ? data : (data.data || data.levels || []);
    if (!Array.isArray(list)) {
      throw new Error('AREDL returned an unexpected response shape for the level list — try again in a moment.');
    }
    // Same top-CONFIG.LIST_SIZE cap the snapshot is built with (see
    // scripts/refresh-aredl-cache.mjs) — this path only runs if the
    // snapshot is missing/unreachable, and should never show more than
    // the snapshot would.
    return list.slice().sort((a, b) => a.position - b.position).slice(0, CONFIG.LIST_SIZE);
  }

  async function fetchListed({ limit = CONFIG.PAGE_SIZE, offset = 0 } = {}) {
    const all = await fetchFullList();
    const slice = all.slice(offset, offset + limit);
    return {
      demons: slice.map(normalizeLevelBase),
      total: all.length,
    };
  }

  /** Total level count, for "jump to rank" bounds and position-based tier coloring. Resolves once the list has loaded at least once. */
  async function getTotalCount() {
    const all = await fetchFullList();
    return all.length;
  }

  /**
   * Search across the *entire* list by name, not just whatever page
   * happens to be loaded — the full list is already cached in memory
   * (see fetchFullList above) so this is a plain client-side filter, no
   * extra network round trip beyond the one-time initial fetch.
   */
  async function searchByName(query, { limit = 200 } = {}) {
    const all = await fetchFullList();
    const q = query.trim().toLowerCase();
    if (!q) return { demons: [], total: 0 };
    const matches = all.filter(raw => raw.name.toLowerCase().includes(q));
    return {
      demons: matches.slice(0, limit).map(normalizeLevelBase),
      total: matches.length,
    };
  }

  async function fetchDemon(id) {
    const [detailRes, creatorsRes] = await Promise.all([
      corsFetchJson(ENDPOINTS.detail(id)),
      corsFetchJson(ENDPOINTS.creators(id)).catch(() => null),
    ]);
    if (!detailRes.ok && !detailRes.viaProxy) {
      throw new Error(
        `AREDL returned ${detailRes.status} for level ${id}. Check ` +
        `https://api.aredl.net/v2/docs and update js/api-aredl.js if the shape changed.`
      );
    }
    const data = await detailRes.json();
    const raw = data.data || data;
    if (!raw || raw.id === undefined) {
      throw new Error(`AREDL returned an unexpected response shape for level ${id} — try again in a moment.`);
    }
    let creators = [];
    if (creatorsRes && (creatorsRes.ok || creatorsRes.viaProxy)) {
      const creatorsData = await creatorsRes.json().catch(() => null);
      if (Array.isArray(creatorsData)) creators = creatorsData;
    }
    return normalizeResolvedLevel(raw, creators);
  }

  // Lazily fills in video/thumbnail/verifier/publisher/creators for a
  // list-page card once it scrolls into view — see list.js.
  const fetchExtras = fetchDemon;

  return { fetchListed, fetchDemon, fetchExtras, searchByName, getTotalCount };
})();
