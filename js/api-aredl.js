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
      // AREDL ranks by position/points rather than a Pointercrate-style
      // requirement %, so there's nothing meaningful to put here.
      requirement: null,
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
      requirement: null,
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
  // (confirmed live: passing limit=3 still returns all ~1600 levels), so
  // fetch it once, cache it for the session, and paginate client-side.
  let fullListCache = null;
  let fullListPromise = null;
  function fetchFullList() {
    if (fullListCache) return Promise.resolve(fullListCache);
    if (!fullListPromise) {
      fullListPromise = (async () => {
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
        fullListCache = list.slice().sort((a, b) => a.position - b.position);
        return fullListCache;
      })().finally(() => { fullListPromise = null; });
    }
    return fullListPromise;
  }

  async function fetchListed({ limit = CONFIG.PAGE_SIZE, offset = 0 } = {}) {
    const all = await fetchFullList();
    const slice = all.slice(offset, offset + limit);
    return {
      demons: slice.map(normalizeLevelBase),
      nextUrl: offset + limit < all.length ? `__offset__${offset + limit}` : null,
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

  return { fetchListed, fetchDemon, fetchExtras };
})();
