/* =====================================================================
   YOUTUBE
   Handles three jobs:
     1) getVideoStats() / getVideoStatsBatch() — view count / title /
        channel for known videos (verification uploads)
     2) findBestShowcase()  — search YouTube for the level and pick the
        highest-viewed showcase that's actually *of that level*, biased
        toward known showcase channels (config.js)
     3) quota protection    — everything above funnels through a small
        concurrency-limited queue and a quota-exceeded circuit breaker so
        a burst of visible cards can't blow through YouTube's daily quota
        or trip its abuse detection.

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

  // --- quota-exceeded circuit breaker -----------------------------------
  // Once YouTube reports a quota error for an endpoint, every further call
  // to *that same endpoint* fails identically until the daily reset — so
  // stop asking and fail fast with one clear message instead of hammering
  // the API (and the UI) with repeat errors for the rest of the session.
  //
  // Tracked per-endpoint ('search' vs 'videos'), not globally: confirmed
  // live that YouTube meters these as separate daily budgets — search.list
  // defaults to a much smaller sub-limit than the project's overall quota
  // and commonly runs out first, while videos.list (view counts) keeps
  // working fine. A global breaker would wrongly kill view counts too.
  function quotaState() {
    try { return JSON.parse(localStorage.getItem(CONFIG.STORAGE.YT_QUOTA_RESET_AT) || '{}'); }
    catch { return {}; }
  }
  function quotaResetAt(endpoint) {
    const v = quotaState()[endpoint];
    return Number.isFinite(v) ? v : 0;
  }
  function isQuotaExhausted(endpoint) { return Date.now() < quotaResetAt(endpoint); }
  function markQuotaExhausted(endpoint) {
    // YouTube quota resets at midnight Pacific time; approximate with "24h from now"
    // since figuring the exact Pacific offset client-side isn't worth the complexity.
    const state = quotaState();
    state[endpoint] = Date.now() + 1000 * 60 * 60 * 24;
    try { localStorage.setItem(CONFIG.STORAGE.YT_QUOTA_RESET_AT, JSON.stringify(state)); } catch { /* storage unavailable */ }
  }

  // --- small concurrency-limited, spaced request queue -------------------
  // Smooths out bursts (e.g. fast-scrolling past a dozen cards at once)
  // instead of firing every request the instant it's ready. Both the
  // concurrency slot and the dispatch-time spacing are reserved eagerly
  // (synchronously, at schedule time) rather than computed when a timer
  // happens to fire — that's what keeps a burst of enqueue() calls from
  // scheduling several redundant timers that would all fire together and
  // blow past YT_MIN_INTERVAL_MS.
  let active = 0;
  let nextSlotAt = 0;
  const queue = [];
  function pump() {
    if (active >= CONFIG.YT_MAX_CONCURRENT || queue.length === 0) return;
    const now = Date.now();
    const dispatchAt = Math.max(now, nextSlotAt);
    nextSlotAt = dispatchAt + CONFIG.YT_MIN_INTERVAL_MS;
    const job = queue.shift();
    active++;
    setTimeout(() => {
      job().finally(() => { active--; pump(); });
    }, dispatchAt - now);
    pump(); // reserve another slot immediately if still under the concurrency cap
  }
  function enqueue(job) {
    return new Promise((resolve, reject) => {
      queue.push(() => job().then(resolve, reject));
      pump();
    });
  }

  async function rawYtFetch(endpoint, params) {
    const key = getKey();
    if (!key) {
      const err = new Error('No YouTube API key set.');
      err.code = 'NO_KEY';
      throw err;
    }
    if (isQuotaExhausted(endpoint)) {
      const err = new Error(
        endpoint === 'search'
          ? "Today's YouTube search quota is used up — showcase discovery will resume tomorrow (view counts are a separate quota and keep working)."
          : "Today's YouTube API quota is used up — this will resume tomorrow."
      );
      err.code = 'QUOTA_EXCEEDED';
      throw err;
    }
    const url = new URL(`https://www.googleapis.com/youtube/v3/${endpoint}`);
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
    url.searchParams.set('key', key);
    const res = await fetch(url.toString());
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const reason = body?.error?.errors?.[0]?.reason || '';
      // Google uses several reason strings for "you're out of budget for today"
      // depending on which quota tripped (project-wide daily cap vs. a specific
      // per-day metric, e.g. search.list defaulting to a much lower sub-limit
      // than the account's overall quota) — quotaExceeded/dailyLimitExceeded/
      // rateLimitExceeded have all been observed live for this exact case.
      const isQuotaError = /quota|dailylimit|ratelimit/i.test(reason);
      if (isQuotaError) {
        markQuotaExhausted(endpoint);
        const err = new Error(body?.error?.message || `YouTube ${endpoint} quota is used up for today.`);
        err.code = 'QUOTA_EXCEEDED';
        throw err;
      }
      const err = new Error(body?.error?.message || `YouTube API error ${res.status}`);
      err.code = reason || res.status;
      throw err;
    }
    return res.json();
  }

  /** Queued, throttled wrapper around the raw fetch — use this everywhere instead of calling rawYtFetch directly. */
  function ytFetch(endpoint, params) {
    return enqueue(() => rawYtFetch(endpoint, params));
  }

  function statsFromItem(item) {
    return {
      id: item.id,
      url: `https://www.youtube.com/watch?v=${item.id}`,
      title: item.snippet.title,
      description: item.snippet.description || '',
      channel: item.snippet.channelTitle,
      viewCount: parseInt(item.statistics.viewCount || '0', 10),
    };
  }

  /** Look up view count / title / channel for a specific known video (e.g. the verification upload). */
  async function getVideoStats(videoUrlOrId) {
    const results = await getVideoStatsBatch([videoUrlOrId]);
    return results[0] ?? null;
  }

  /**
   * Batched version of getVideoStats — videos.list accepts up to 50 ids
   * per call for the *same* 1-unit quota cost as looking up a single id,
   * so batching many visible cards' verifier videos into one call is a
   * straight quota win over calling this once per card. Returns results
   * in the same order as the input, with `null` for ids that had no hit
   * or were already cached.
   */
  async function getVideoStatsBatch(videoUrlsOrIds) {
    const ids = videoUrlsOrIds.map(v => {
      if (!v) return null;
      return (v.length === 11 && !v.includes('/')) ? v : extractYouTubeId(v);
    });

    const results = new Array(ids.length).fill(null);
    const toFetch = new Set();

    ids.forEach((id, i) => {
      if (!id) return;
      const cached = cacheGet(`video:${id}`);
      if (cached !== undefined) results[i] = cached;
      else toFetch.add(id);
    });

    const idList = [...toFetch];
    for (let i = 0; i < idList.length; i += 50) {
      const chunk = idList.slice(i, i + 50);
      const data = await ytFetch('videos', { part: 'snippet,statistics', id: chunk.join(',') });
      const found = new Map((data.items || []).map(item => [item.id, statsFromItem(item)]));
      for (const id of chunk) {
        const stats = found.get(id) || null;
        cacheSet(`video:${id}`, stats);
      }
    }

    return ids.map(id => {
      if (!id) return null;
      const cached = cacheGet(`video:${id}`);
      return cached !== undefined ? cached : null;
    });
  }

  /** Normalize a level name into lowercase word tokens (len > 2) for matching against candidate titles. */
  function significantWords(name) {
    return (name || '')
      .toLowerCase()
      .replace(/\(.*?\)/g, ' ') // drop "(2P)"/"(Solo)"-style qualifiers
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .split(' ')
      .filter(w => w.length > 2);
  }

  /**
   * Whether a candidate video is plausibly *of this specific level* —
   * required before it's even considered as a showcase, so a generic
   * high-view video that merely shares the "Geometry Dash" query term
   * can't win just by being popular. Requires every significant word of
   * the level name to appear in the title, OR the numeric GD level ID to
   * appear in the title/description (showcases of lesser-known levels
   * often cite the ID for lookup purposes).
   */
  function matchesLevel(candidate, levelName, levelId) {
    const words = significantWords(levelName);
    const haystack = candidate.title.toLowerCase();
    const nameMatches = words.length > 0 && words.every(w => haystack.includes(w));
    if (nameMatches) return true;
    if (levelId) {
      const idStr = String(levelId);
      if (haystack.includes(idStr) || (candidate.description || '').includes(idStr)) return true;
    }
    return false;
  }

  /**
   * Find the most-viewed showcase video that's actually *of this level*.
   * Strategy:
   *  - start with a single, specific query to keep the (expensive,
   *    100-quota-unit) search.list cost down; only escalate to broader
   *    query variants if the first one turns up no same-level match
   *  - require matchesLevel() — title/ID match against the specific
   *    level, not just a keyword coincidence — before a candidate is
   *    eligible at all
   *  - drop results whose title looks like a raw verification/completion
   *    upload (that's shown separately as the "verifier" video)
   *  - if any remaining candidate comes from a known showcase channel,
   *    restrict to those; otherwise fall back to the highest view count
   *    among same-level matches
   */
  async function findBestShowcase(levelName, levelId) {
    const cacheKey = `showcase:${levelName.toLowerCase()}:${levelId || ''}`;
    const cached = cacheGet(cacheKey);
    if (cached !== undefined) return cached;

    const queryTiers = [
      [`"${levelName}" Geometry Dash showcase`],
      [`${levelName} GD showcase`, `${levelName} Geometry Dash`],
    ];

    let matched = [];
    for (const tier of queryTiers) {
      const seen = new Map();
      for (const q of tier) {
        try {
          const data = await ytFetch('search', {
            part: 'snippet', q, type: 'video', maxResults: '10', order: 'viewCount',
          });
          for (const item of data.items || []) {
            const vid = item.id?.videoId;
            if (!vid || seen.has(vid)) continue;
            seen.set(vid, {
              id: vid,
              title: item.snippet.title,
              description: item.snippet.description || '',
              channel: item.snippet.channelTitle,
            });
          }
        } catch (e) {
          if (e.code === 'NO_KEY' || e.code === 'QUOTA_EXCEEDED') throw e; // no point retrying without a key or quota
          // otherwise: one query failing shouldn't kill the whole search
        }
      }

      if (seen.size === 0) continue;

      const ids = [...seen.keys()].slice(0, 40);
      const statsData = await ytFetch('videos', { part: 'statistics,snippet', id: ids.join(',') });
      const candidates = (statsData.items || []).map(statsFromItem);

      matched = candidates
        .filter(c => !/\bverification\b/i.test(c.title))
        .filter(c => matchesLevel(c, levelName, levelId));

      if (matched.length > 0) break; // found same-level matches — no need for the broader (costlier) tier
    }

    if (matched.length === 0) { cacheSet(cacheKey, null); return null; }

    const known = matched.filter(c =>
      CONFIG.SHOWCASE_CHANNELS.some(ch => c.channel.toLowerCase().includes(ch.toLowerCase()))
    );
    const pool = known.length ? known : matched;
    pool.sort((a, b) => b.viewCount - a.viewCount);

    const best = pool[0];
    cacheSet(cacheKey, best);
    return best;
  }

  return {
    getKey, setKey, hasKey,
    isQuotaExhausted,
    getVideoStats, getVideoStatsBatch,
    findBestShowcase,
  };
})();
