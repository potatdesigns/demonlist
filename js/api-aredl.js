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

      scripts/refresh-aredl-cache.mjs now fetches that detail for every
      cached level too (merged onto the same object, plus a `creators`
      array) — see normalizeLevel() below, which uses it directly with
      no extra round trip whenever it's present, and only falls back to
      a live per-level fetch (fetchDemon(), used as fetchExtras() by
      list.js) for a level whose detail happened to be missing from the
      last cache refresh. Before that script cached detail too, *every*
      card needed its own live GET /levels/{id} call from the visitor's
      own browser to fill in a thumbnail/verifier/publisher at all —
      which is what made cards show a black placeholder while pending,
      and occasionally error out if that live call failed.

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
    changelog: (page) => `${CONFIG.AREDL_BASE}/changelog?page=${page}`,
    records: (id, page) => `${CONFIG.AREDL_BASE}/levels/${id}/records?page=${page}&per_page=100`,
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

  /**
   * Dispatches to whichever of the two normalizers fits — `raw.verifications`
   * is only present once scripts/refresh-aredl-cache.mjs has merged
   * GET /levels/{id} detail onto this entry (it attaches a `creators`
   * array from the separate endpoint at the same time), so its presence
   * is exactly the signal that this entry needs no extra round trip.
   * Bare entries (a level whose detail fetch failed on the last cache
   * refresh, or a cache from before this existed) fall back to
   * needsExtras: true, same as every card used to.
   */
  function normalizeLevel(raw) {
    return raw.verifications !== undefined ? normalizeResolvedLevel(raw, raw.creators) : normalizeLevelBase(raw);
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
      demons: slice.map(normalizeLevel),
      total: all.length,
    };
  }

  /** Total level count, for "open rank" bounds and position-based tier coloring. Resolves once the list has loaded at least once. */
  async function getTotalCount() {
    const all = await fetchFullList();
    return all.length;
  }

  // A rank beyond CONFIG.LIST_SIZE isn't in fetchFullList()'s cached/capped
  // top-LIST_SIZE array at all — but level.html#N should still resolve for
  // one (this app doesn't *track* deep legacy levels, but a direct link or
  // Prev/Next stepping off the end of the tracked list shouldn't just dead-
  // end either, the same way an id: route already works for any level via
  // fetchDemonLive()). Lazily fetches AREDL's full, uncapped list — bare
  // fields only, same shape as fetchFromLiveApi() — the *first* time a
  // position past LIST_SIZE is actually requested, then caches it for the
  // rest of the session; ordinary top-LIST_SIZE browsing never triggers
  // this extra request at all.
  let uncappedListCache = null;
  let uncappedListPromise = null;
  function fetchUncappedList() {
    if (uncappedListCache) return Promise.resolve(uncappedListCache);
    if (!uncappedListPromise) {
      uncappedListPromise = (async () => {
        const res = await corsFetchJson(ENDPOINTS.listed());
        if (!res.ok && !res.viaProxy) {
          throw new Error(`AREDL returned ${res.status} for the level list.`);
        }
        const data = await res.json();
        const list = Array.isArray(data) ? data : (data.data || data.levels || []);
        if (!Array.isArray(list)) throw new Error('AREDL returned an unexpected response shape for the level list.');
        uncappedListCache = list.slice().sort((a, b) => a.position - b.position);
        return uncappedListCache;
      })().finally(() => { uncappedListPromise = null; });
    }
    return uncappedListPromise;
  }

  async function findByPosition(position) {
    const all = await fetchFullList();
    const found = all.find(l => l.position === position);
    if (found) return found;
    if (position <= CONFIG.LIST_SIZE) return null; // within the tracked range and genuinely not there — a real "no such rank", not a cap issue
    try {
      const uncapped = await fetchUncappedList();
      return uncapped.find(l => l.position === position) || null;
    } catch {
      return null; // the extra deep-list fetch failing shouldn't break the (already-successful) tracked-range lookup path
    }
  }

  /** Resolves a 1-indexed rank straight to that level's id — the full list is already cached in memory (see fetchFullList above), so this is a plain lookup, no extra round trip within the tracked top LIST_SIZE (see findByPosition() above for what happens past it). Used by the "open rank" box to jump straight into a level's detail page instead of just the page containing it. */
  async function getIdByPosition(position) {
    const found = await findByPosition(position);
    return found ? found.id : null;
  }

  /** Same lookup as getIdByPosition, but returns {id, name} — used for the detail page's Previous/Next preview (js/detail.js), which wants to show what's actually at the adjacent rank, not just link to it blind. Returning null past either end of AREDL's *entire* list is what tells the caller there's no previous/next to show — no separate bounds check needed. */
  async function getByPosition(position) {
    const found = await findByPosition(position);
    return found ? { id: found.id, name: found.name } : null;
  }

  // Some level names carry a parenthetical annotation — "(Solo)" for a
  // solo-verified level, or a creator's name — that's part of the
  // display name (see cardTemplate() in list.js, unaffected by this)
  // but not really part of the *name* someone would search for.
  // Stripped before matching so searching "Deimos" still finds "Deimos
  // (ItsHybrid)", but searching "Solo" doesn't surface every
  // solo-verified level in the tracked list as a false positive.
  function stripParens(name) {
    return name.replace(/\([^)]*\)/g, ' ');
  }

  /** True if an AREDL player (raw shape — a plain string, or an object with global_name/username, straight off raw.publisher / raw.verifications[0].submitted_by / a raw.creators entry) matches a lowercased query. */
  function playerMatches(player, q) {
    if (!player) return false;
    const name = typeof player === 'string' ? player : (player.global_name || player.username || '');
    return name.toLowerCase().includes(q);
  }

  /**
   * Search across the *entire* list, not just whatever page happens to
   * be loaded — the full list is already cached in memory (see
   * fetchFullList above) so this is a plain client-side filter, no
   * extra network round trip beyond the one-time initial fetch. Matches
   * the level name (see stripParens above) or any of publisher/
   * verifier/creators — searching a person's name surfaces every level
   * they're credited on, not just level names containing that text.
   */
  async function searchByName(query, { limit = 200 } = {}) {
    const all = await fetchFullList();
    const q = query.trim().toLowerCase();
    if (!q) return { demons: [], total: 0 };
    const matches = all.filter(raw =>
      stripParens(raw.name).toLowerCase().includes(q)
      || playerMatches(raw.publisher, q)
      || playerMatches((raw.verifications || [])[0]?.submitted_by, q)
      || (Array.isArray(raw.creators) && raw.creators.some(c => playerMatches(c, q)))
    );
    return {
      demons: matches.slice(0, limit).map(normalizeLevel),
      total: matches.length,
    };
  }

  /**
   * Cache-first: the level list is already in memory (see fetchFullList
   * above) with full detail merged in by scripts/refresh-aredl-cache.mjs
   * for the normal case, so this is usually just a lookup — no network
   * call at all. Only falls back to a live GET /levels/{id} (+creators)
   * for a level whose detail is missing from the cache (a transient
   * failure on the last refresh, or a level outside the cached top
   * LEVEL_LIST_SIZE reached via a direct link).
   */
  async function fetchDemon(id) {
    const all = await fetchFullList();
    const cached = all.find(l => l.id === id);
    if (cached && cached.verifications !== undefined) return normalizeResolvedLevel(cached, cached.creators);
    return fetchDemonLive(id);
  }

  async function fetchDemonLive(id) {
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
  // list-page card once it scrolls into view — now almost always an
  // in-memory cache hit (see fetchDemon above) rather than a live call.
  const fetchExtras = fetchDemon;

  /** Every numeric rank a changelog action references, whatever its shape (Placed only has new_position; Raised/Lowered/MovedToLegacy have both; Swapped nests its position under upper_position) — used below to decide whether an entry touched the tracked top CONFIG.LIST_SIZE at all. */
  function changelogPositions(entry) {
    const variant = Object.values(entry.action || {})[0] || {};
    return [variant.new_position, variant.old_position, variant.upper_position].filter(Number.isFinite);
  }

  /**
   * Recent list movement, filtered to changes that touched the top
   * CONFIG.LIST_SIZE — AREDL's full list runs to ~1600 levels, and a
   * change entirely below that cutoff isn't something this site shows a
   * ranking for at all, so it'd just be noise in a "recent changes"
   * panel here. Note AREDL's own `legacy` flag means something
   * different (dropped off AREDL's list entirely, a much lower cutoff
   * than 150) — this app defines "legacy" as anything outside its own
   * top CONFIG.LIST_SIZE, not AREDL's definition.
   *
   * Pages the changelog (20 entries/page in AREDL's response) until
   * either maxResults relevant entries are found or maxPages is
   * exhausted, since most pages are entirely legacy-range noise once
   * the list is calm — page 1 alone isn't a safe assumption.
   */
  async function fetchChangelog({ maxResults = 12, maxPages = 8 } = {}) {
    const results = [];
    for (let page = 1; page <= maxPages && results.length < maxResults; page++) {
      const res = await corsFetchJson(ENDPOINTS.changelog(page));
      if (!res.ok && !res.viaProxy) break;
      const json = await res.json().catch(() => null);
      const entries = Array.isArray(json?.data) ? json.data : [];
      if (!entries.length) break;
      for (const entry of entries) {
        const positions = changelogPositions(entry);
        if (positions.length && Math.min(...positions) <= CONFIG.LIST_SIZE) results.push(entry);
        if (results.length >= maxResults) break;
      }
    }
    return results;
  }

  /**
   * Ids of levels *placed* into the top CONFIG.LIST_SIZE within the
   * last `days` — used to show a "NEW" badge on cards/the detail page.
   * A separate query from fetchChangelog() above rather than filtering
   * its results, since that one caps at maxResults entries regardless
   * of age (right for "recent changes," wrong here — a quiet week
   * shouldn't make a two-week-old placement look new just because
   * nothing else bumped it out of a fixed-size list). Walks the
   * changelog newest-first and stops paging as soon as an entry falls
   * outside the window, rather than a fixed page count, since how many
   * changes happened in the last `days` varies with how active the
   * list's been.
   */
  async function fetchNewLevelIds({ days = 7, maxPages = 10 } = {}) {
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    const ids = new Set();
    outer:
    for (let page = 1; page <= maxPages; page++) {
      const res = await corsFetchJson(ENDPOINTS.changelog(page));
      if (!res.ok && !res.viaProxy) break;
      const json = await res.json().catch(() => null);
      const entries = Array.isArray(json?.data) ? json.data : [];
      if (!entries.length) break;
      for (const entry of entries) {
        const createdAt = new Date(entry.created_at).getTime();
        if (!Number.isFinite(createdAt) || createdAt < cutoff) break outer; // newest-first — nothing further back can still be in range
        const [type, action] = Object.entries(entry.action || {})[0] || [null, {}];
        if (type === 'Placed' && Number.isFinite(action.new_position) && action.new_position <= CONFIG.LIST_SIZE && entry.affected_level?.id) {
          ids.add(entry.affected_level.id);
        }
      }
    }
    return ids;
  }

  /**
   * Every accepted record (raw clear) for a level, oldest-first — who
   * cleared it first reads at the top, same as scrolling down through a
   * history of the level rather than a "latest activity" feed. Public,
   * no auth (GET /levels/{id}/records), confirmed against the open-source
   * backend. Paginated at 100/page; walks up to maxPages (a level with
   * >500 clears is astronomically unlikely within this app's tracked top
   * CONFIG.LIST_SIZE, but capped rather than unbounded regardless).
   */
  async function fetchLevelRecords(id, { maxPages = 5 } = {}) {
    const all = [];
    let page = 1, pages = 1;
    do {
      const res = await corsFetchJson(ENDPOINTS.records(id, page));
      if (!res.ok && !res.viaProxy) throw new Error(`AREDL returned ${res.status} for level records.`);
      const data = await res.json();
      pages = data.pages || 1;
      all.push(...(data.data || []));
      page++;
    } while (page <= pages && page <= maxPages);

    return all
      .map(r => ({
        id: r.id,
        player: normalizePlayer(r.submitted_by),
        videoUrl: r.video_url,
        achievedAt: r.achieved_at,
        mobile: !!r.mobile,
      }))
      .sort((a, b) => new Date(a.achievedAt) - new Date(b.achievedAt));
  }

  return { fetchListed, fetchDemon, fetchExtras, searchByName, getTotalCount, getIdByPosition, getByPosition, fetchChangelog, fetchNewLevelIds, fetchLevelRecords };
})();
