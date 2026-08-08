/* =====================================================================
   SHARED YOUTUBE CACHE (client-side reader)

   Reads data/yt-cache.json — a showcase/verifier-view-count cache built
   by scripts/refresh-yt-cache.mjs and committed to the repo by
   .github/workflows/refresh-yt-cache.yml on a schedule. This is the
   *primary* source for view counts and showcase videos: it works for
   every visitor with zero personal API usage, since one shared,
   staggered, server-side job populates it for everyone instead of each
   visitor's own key re-doing the same expensive search.lookups.

   A visitor's personal key (js/youtube.js) is only consulted as an
   on-demand fallback for a level this cache hasn't reached yet — see
   hydrateCards()/applyStatsAndShowcase() in list.js and detail.js.
   ===================================================================== */

const SharedYtCache = (() => {
  let cache = null;
  let loadPromise = null;

  function readMirror() {
    try { return JSON.parse(localStorage.getItem(CONFIG.STORAGE.SHARED_YT_CACHE) || 'null'); }
    catch { return null; }
  }
  function writeMirror(data) {
    try { localStorage.setItem(CONFIG.STORAGE.SHARED_YT_CACHE, JSON.stringify({ fetchedAt: Date.now(), data })); }
    catch { /* storage full/unavailable — just skip the mirror, not fatal */ }
  }

  /** Fetch+cache data/yt-cache.json (a localStorage mirror avoids re-fetching it on every page nav within the TTL). */
  function load() {
    if (cache) return Promise.resolve(cache);
    if (loadPromise) return loadPromise;

    loadPromise = (async () => {
      const mirror = readMirror();
      if (mirror && Date.now() - mirror.fetchedAt < CONFIG.SHARED_YT_CACHE_TTL_MS) {
        cache = mirror.data;
        return cache;
      }
      try {
        const res = await fetch(CONFIG.SHARED_YT_CACHE_URL, { cache: 'no-cache' });
        if (!res.ok) throw new Error(`shared cache fetch failed: ${res.status}`);
        const data = await res.json();
        cache = data && typeof data === 'object' ? data : { levels: {} };
        writeMirror(cache);
      } catch (e) {
        // Not fatal — this just means every card falls back to the personal-key
        // path (or "Add key") as if the shared cache were empty. Prefer a stale
        // local mirror over nothing if we have one.
        cache = mirror?.data || { levels: {} };
      }
      return cache;
    })();

    return loadPromise;
  }

  /** { verifier: stats|null, showcase: stats|null } if this level has been processed, else undefined if the staggered refresh hasn't reached it yet. */
  async function getEntry(levelId) {
    const data = await load();
    return data.levels ? data.levels[levelId] : undefined;
  }

  return { load, getEntry };
})();
