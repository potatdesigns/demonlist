/* =====================================================================
   YOUTUBE
   Handles two jobs:
     1) getVideoStats()   — view count / title / channel for a known video
     2) findBestShowcase()— search YouTube for the level and pick the
                             highest-viewed showcase, biased toward known
                             showcase channels (config.js)

   Requires a personal YouTube Data API v3 key (free from Google Cloud
   Console) entered via the header's "YouTube key" button — it's stored
   only in this browser's localStorage and sent directly from the
   browser to Google, never through a third party.
   ===================================================================== */

const YouTube = (() => {

  function getKey() { return localStorage.getItem(CONFIG.STORAGE.YT_KEY) || ''; }
  function setKey(k) { localStorage.setItem(CONFIG.STORAGE.YT_KEY, (k || '').trim()); }
  function hasKey() { return !!getKey(); }

  function loadCache() {
    try { return JSON.parse(localStorage.getItem(CONFIG.STORAGE.YT_CACHE) || '{}'); }
    catch { return {}; }
  }
  function saveCache(c) {
    try { localStorage.setItem(CONFIG.STORAGE.YT_CACHE, JSON.stringify(c)); } catch { /* storage full/unavailable */ }
  }
  function cacheGet(key) {
    const entry = loadCache()[key];
    if (!entry) return undefined;
    if (Date.now() - entry.ts > CONFIG.YT_CACHE_TTL_MS) return undefined;
    return entry.data;
  }
  function cacheSet(key, data) {
    const c = loadCache();
    c[key] = { data, ts: Date.now() };
    saveCache(c);
  }

  async function ytFetch(endpoint, params) {
    const key = getKey();
    if (!key) {
      const err = new Error('No YouTube API key set.');
      err.code = 'NO_KEY';
      throw err;
    }
    const url = new URL(`https://www.googleapis.com/youtube/v3/${endpoint}`);
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
    url.searchParams.set('key', key);
    const res = await fetch(url.toString());
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const err = new Error(body?.error?.message || `YouTube API error ${res.status}`);
      err.code = res.status;
      throw err;
    }
    return res.json();
  }

  /** Look up view count / title / channel for a specific known video (e.g. the verification upload). */
  async function getVideoStats(videoUrlOrId) {
    const id = (videoUrlOrId && videoUrlOrId.length === 11 && !videoUrlOrId.includes('/'))
      ? videoUrlOrId
      : extractYouTubeId(videoUrlOrId);
    if (!id) return null;

    const cacheKey = `video:${id}`;
    const cached = cacheGet(cacheKey);
    if (cached !== undefined) return cached;

    const data = await ytFetch('videos', { part: 'snippet,statistics', id });
    const item = data.items?.[0];
    if (!item) { cacheSet(cacheKey, null); return null; }

    const result = {
      id,
      url: `https://www.youtube.com/watch?v=${id}`,
      title: item.snippet.title,
      channel: item.snippet.channelTitle,
      viewCount: parseInt(item.statistics.viewCount || '0', 10),
    };
    cacheSet(cacheKey, result);
    return result;
  }

  /**
   * Find the most-viewed showcase video for a level. Strategy:
   *  - search a couple of query variants ("<name> GD showcase", "<name> Geometry Dash")
   *  - drop results whose title looks like a raw verification/completion upload
   *  - if any result comes from a known showcase channel, restrict to those
   *  - otherwise fall back to the highest view count across all results
   */
  async function findBestShowcase(levelName) {
    const cacheKey = `showcase:${levelName.toLowerCase()}`;
    const cached = cacheGet(cacheKey);
    if (cached !== undefined) return cached;

    const queries = [`${levelName} GD showcase`, `${levelName} Geometry Dash`];
    const seen = new Map();

    for (const q of queries) {
      try {
        const data = await ytFetch('search', {
          part: 'snippet', q, type: 'video', maxResults: '10', order: 'viewCount',
        });
        for (const item of data.items || []) {
          const vid = item.id?.videoId;
          if (!vid || seen.has(vid)) continue;
          seen.set(vid, { id: vid, title: item.snippet.title, channel: item.snippet.channelTitle });
        }
      } catch (e) {
        if (e.code === 'NO_KEY') throw e; // no point retrying without a key
        // otherwise: one query failing shouldn't kill the whole search
      }
    }

    if (seen.size === 0) { cacheSet(cacheKey, null); return null; }

    const ids = [...seen.keys()].slice(0, 40);
    const statsData = await ytFetch('videos', { part: 'statistics,snippet', id: ids.join(',') });

    let candidates = (statsData.items || []).map(item => ({
      id: item.id,
      url: `https://www.youtube.com/watch?v=${item.id}`,
      title: item.snippet.title,
      channel: item.snippet.channelTitle,
      viewCount: parseInt(item.statistics.viewCount || '0', 10),
    }));

    // The verifier's own completion upload is shown separately as the
    // "verifier" video — de-prioritize obvious duplicates of it here.
    candidates = candidates.filter(c => !/\bverification\b/i.test(c.title));
    if (candidates.length === 0) { cacheSet(cacheKey, null); return null; }

    const known = candidates.filter(c =>
      CONFIG.SHOWCASE_CHANNELS.some(ch => c.channel.toLowerCase().includes(ch.toLowerCase()))
    );
    const pool = known.length ? known : candidates;
    pool.sort((a, b) => b.viewCount - a.viewCount);

    const best = pool[0];
    cacheSet(cacheKey, best);
    return best;
  }

  return { getKey, setKey, hasKey, getVideoStats, findBestShowcase };
})();
