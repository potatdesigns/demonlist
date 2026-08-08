/* =====================================================================
   SHARED YOUTUBE CACHE (client-side reader)

   Reads data/yt-cache.json — a showcase/verifier-view-count cache built
   by scripts/refresh-yt-cache.mjs and committed to the repo by
   .github/workflows/refresh-yt-cache.yml + refresh-yt-views.yml. This is
   the *only* source for view counts and showcase videos: it works for
   every visitor with zero personal API usage, since one shared,
   staggered, server-side job populates it for everyone instead of each
   visitor doing their own lookups. A level the crawl hasn't reached yet
   just shows "Not cached yet" (see list.js/detail.js) — there's no
   personal-key fallback.
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

  /**
   * Fetch data/yt-cache.json fresh on every page load — `cache: 'no-cache'`
   * still makes this cheap when nothing changed (the browser does a
   * conditional revalidation and gets a 304 rather than re-downloading),
   * but it never serves data that's actually stale the way a time-based
   * TTL would. The localStorage mirror exists only as an offline/error
   * fallback (see the catch below), not a shortcut that skips the network.
   */
  function load() {
    if (cache) return Promise.resolve(cache);
    if (loadPromise) return loadPromise;

    loadPromise = (async () => {
      try {
        const res = await fetch(CONFIG.SHARED_YT_CACHE_URL, { cache: 'no-cache' });
        if (!res.ok) throw new Error(`shared cache fetch failed: ${res.status}`);
        const data = await res.json();
        cache = data && typeof data === 'object' ? data : { levels: {} };
        writeMirror(cache);
      } catch (e) {
        // Network/parse failure — fall back to a stale local mirror if we
        // have one (better than nothing), otherwise treat it as empty.
        cache = readMirror()?.data || { levels: {} };
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
