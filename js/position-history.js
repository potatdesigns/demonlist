/* =====================================================================
   POSITION HISTORY (client-side reader)

   Reads data/position-history.json — a per-level log of past position
   changes, built by scripts/refresh-aredl-cache.mjs and committed by
   .github/workflows/refresh-aredl-cache.yml (hourly, alongside
   data/aredl-cache.json itself). One { date, position } entry per
   actual change, not one per refresh — see that script for why. Same
   load-once-fetch-fresh-every-page-load shape as SharedYtCache in
   js/shared-cache.js, including the localStorage mirror as an offline/
   error fallback only, never a shortcut that skips the network.
   ===================================================================== */

const PositionHistory = (() => {
  let cache = null;
  let loadPromise = null;

  function readMirror() {
    try { return JSON.parse(localStorage.getItem(CONFIG.STORAGE.POSITION_HISTORY) || 'null'); }
    catch { return null; }
  }
  function writeMirror(data) {
    try { localStorage.setItem(CONFIG.STORAGE.POSITION_HISTORY, JSON.stringify({ fetchedAt: Date.now(), data })); }
    catch { /* storage full/unavailable — just skip the mirror, not fatal */ }
  }

  function load() {
    if (cache) return Promise.resolve(cache);
    if (loadPromise) return loadPromise;

    loadPromise = (async () => {
      try {
        const res = await fetch(CONFIG.POSITION_HISTORY_URL, { cache: 'no-cache' });
        if (!res.ok) throw new Error(`position history fetch failed: ${res.status}`);
        const data = await res.json();
        cache = data && typeof data === 'object' ? data : { history: {} };
        writeMirror(cache);
      } catch (e) {
        cache = readMirror()?.data || { history: {} };
      }
      return cache;
    })();

    return loadPromise;
  }

  /** [{ date, position, reason }, ...] oldest-first for this level, or [] if it has no recorded changes yet (new to the cache, or never moved since it started being tracked). */
  async function getEntries(levelId) {
    const data = await load();
    return (data.history && data.history[levelId]) || [];
  }

  /** The full { levelId: [{date,position,reason}, ...] } map — used by features that scan across every tracked level at once (On This Day, the Time Machine page) rather than looking up one level at a time. */
  async function getAllHistory() {
    const data = await load();
    return data.history || {};
  }

  /**
   * { levelId: name } for every level that's ever had a history entry —
   * see scripts/backfill-position-history.mjs / refresh-aredl-cache.mjs's
   * `names` output. Needed because data/aredl-cache.json only carries
   * detail for the *current* top LEVEL_LIST_SIZE; a level that has since
   * dropped out has no name available anywhere else in the site's caches.
   */
  async function getNames() {
    const data = await load();
    return data.names || {};
  }

  return { load, getEntries, getAllHistory, getNames };
})();
