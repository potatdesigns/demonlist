/* =====================================================================
   RECORDS INDEX (client-side reader)

   Reads data/records-index.json — every accepted record across the
   tracked top CONFIG.LIST_SIZE, indexed by AREDL player id, built by
   scripts/refresh-records-index.mjs (see that file's header for why
   this has to be precomputed instead of queried live: AREDL only
   exposes records per-*level* publicly, never per-*player*). Same
   load-once-fetch-fresh-every-page-load shape as PositionHistory in
   js/position-history.js, including the localStorage mirror as an
   offline/error fallback only.

   Read by js/aredl-sync.js (matching a typed AREDL username to mark
   completions) and js/list.js (showing what a searched-for name has
   completed, alongside what they've created/verified).
   ===================================================================== */

const RecordsIndex = (() => {
  let cache = null;
  let loadPromise = null;

  function readMirror() {
    try { return JSON.parse(localStorage.getItem(CONFIG.STORAGE.RECORDS_INDEX) || 'null'); }
    catch { return null; }
  }
  function writeMirror(data) {
    try { localStorage.setItem(CONFIG.STORAGE.RECORDS_INDEX, JSON.stringify({ fetchedAt: Date.now(), data })); }
    catch { /* storage full/unavailable — just skip the mirror, not fatal */ }
  }

  function load() {
    if (cache) return Promise.resolve(cache);
    if (loadPromise) return loadPromise;

    loadPromise = (async () => {
      try {
        const res = await fetch(CONFIG.RECORDS_INDEX_URL, { cache: 'no-cache' });
        if (!res.ok) throw new Error(`records index fetch failed: ${res.status}`);
        const data = await res.json();
        cache = data && typeof data === 'object' ? data : { players: {} };
        writeMirror(cache);
      } catch (e) {
        cache = readMirror()?.data || { players: {} };
      }
      return cache;
    })();

    return loadPromise;
  }

  /** Case-insensitive exact match on a player's display name — the only identifier a visitor can be expected to type in without an actual account login (see js/aredl-sync.js). Returns { id, name, levels: [{levelId, levelName, position, achievedAt, videoUrl}, ...] } or null if nobody in the index matches. */
  async function findPlayerByName(name) {
    const data = await load();
    const q = name.trim().toLowerCase();
    if (!q) return null;
    for (const [id, player] of Object.entries(data.players || {})) {
      if (player.name.toLowerCase() === q) return { id, ...player };
    }
    return null;
  }

  return { load, findPlayerByName };
})();
