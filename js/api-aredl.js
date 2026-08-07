/* =====================================================================
   AREDL ADAPTER  (best-effort)

   AREDL's public API lives at https://api.aredl.net/v2/docs but, unlike
   Pointercrate, its full schema is only published in an interactive
   Scalar/OpenAPI viewer rather than plain text — so the field names
   below are a best-effort mapping and are isolated in this one file on
   purpose. If AREDL changes their shape, or if a field below turns out
   to be named differently, this is the only place that needs patching;
   list.js and detail.js only ever see the normalized object.

   To verify/adjust: open https://api.aredl.net/v2/docs in a browser,
   find the "levels" endpoints, and update ENDPOINTS + normalizeLevel().
   ===================================================================== */

const AredlAPI = (() => {

  const ENDPOINTS = {
    listed: () => `${CONFIG.AREDL_BASE}/levels`,
    detail: (id) => `${CONFIG.AREDL_BASE}/levels/${id}`,
  };

  function normalizePlayer(p) {
    if (!p) return null;
    if (typeof p === 'string') return { id: null, name: p };
    return { id: p.id ?? null, name: p.name ?? p.username ?? String(p) };
  }

  function normalizeLevel(raw) {
    const video = raw.verification || raw.video || raw.showcase_video || null;
    const creatorsRaw = raw.creators || raw.publishers || [];
    return {
      source: 'aredl',
      id: raw.id ?? raw.level_id,
      name: raw.name,
      position: raw.position ?? raw.placement ?? raw.rank,
      // AREDL doesn't use a single "requirement %" the way Pointercrate
      // does; approximate a tier from position among ~top 200 so the
      // same color-coding logic in utils.js still applies sensibly.
      requirement: raw.requirement ?? null,
      videoUrl: video,
      thumbnail: raw.thumbnail || youTubeThumbnail(video) || null,
      levelId: raw.level_id ?? raw.gd_id ?? null,
      verifier: normalizePlayer(raw.verifier),
      publisher: normalizePlayer(raw.publisher || (creatorsRaw[0] ?? null)),
      creators: Array.isArray(creatorsRaw) ? creatorsRaw.map(normalizePlayer) : [],
      raw,
    };
  }

  async function fetchListed({ limit = CONFIG.PAGE_SIZE, offset = 0 } = {}) {
    const url = `${ENDPOINTS.listed()}?limit=${limit}&offset=${offset}`;
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) {
      throw new Error(
        `AREDL returned ${res.status}. Its API shape may have changed — ` +
        `check https://api.aredl.net/v2/docs and update js/api-aredl.js.`
      );
    }
    const data = await res.json();
    const list = Array.isArray(data) ? data : (data.data || data.levels || []);
    return {
      demons: list.map(normalizeLevel),
      nextUrl: list.length === limit ? `__offset__${offset + limit}` : null,
    };
  }

  async function fetchDemon(id) {
    const url = ENDPOINTS.detail(id);
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) {
      throw new Error(
        `AREDL returned ${res.status} for level ${id}. Check ` +
        `https://api.aredl.net/v2/docs and update js/api-aredl.js if the shape changed.`
      );
    }
    const data = await res.json();
    return normalizeLevel(data.data || data);
  }

  return { fetchListed, fetchDemon };
})();
