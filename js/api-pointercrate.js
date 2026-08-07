/* =====================================================================
   POINTERCRATE ADAPTER
   Docs: https://pointercrate.com/documentation/demons/
   Every consumer of demon data (list.js, detail.js) talks to the
   normalized shape below, never to raw Pointercrate JSON directly —
   that's what makes it possible to swap in the AREDL adapter.
   ===================================================================== */

const PointercrateAPI = (() => {

  /** Parse a `Link` response header (RFC 5988) into { rel: url }. */
  function parseLinkHeader(headerVal) {
    const out = {};
    if (!headerVal) return out;
    for (const part of headerVal.split(',')) {
      const match = part.match(/<([^>]+)>;\s*rel="([^"]+)"/);
      if (match) out[match[2]] = match[1];
    }
    return out;
  }

  function normalizePlayer(p) {
    if (!p) return null;
    if (typeof p === 'string') return { id: null, name: p };
    return { id: p.id ?? null, name: p.name ?? String(p) };
  }

  function normalizeDemon(raw) {
    const creatorsRaw = raw.creators || raw.creator || [];
    return {
      source: 'pointercrate',
      id: raw.id,
      name: raw.name,
      position: raw.position,
      requirement: raw.requirement ?? null,
      videoUrl: raw.video || null,
      thumbnail: raw.thumbnail || youTubeThumbnail(raw.video) || null,
      levelId: raw.level_id ?? null,
      verifier: normalizePlayer(raw.verifier),
      publisher: normalizePlayer(raw.publisher),
      creators: Array.isArray(creatorsRaw) ? creatorsRaw.map(normalizePlayer) : [],
      raw,
    };
  }

  /**
   * Fetch a page of the *listed* demons (i.e. currently ranked, sorted
   * by position). `cursorUrl`, when provided, is a full URL taken from
   * a previous page's `next` link — pass it straight through to follow
   * Pointercrate's own pagination rather than re-deriving offsets.
   */
  async function fetchListed({ limit = CONFIG.PAGE_SIZE, cursorUrl = null } = {}) {
    const url = cursorUrl || `${CONFIG.POINTERCRATE_BASE}/demons/listed?limit=${limit}`;
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) {
      throw new Error(`Pointercrate returned ${res.status} for ${url}`);
    }
    const data = await res.json();
    const links = parseLinkHeader(res.headers.get('Link'));
    return {
      demons: data.map(normalizeDemon),
      nextUrl: links.next || null,
    };
  }

  async function fetchDemon(id) {
    const url = `${CONFIG.POINTERCRATE_BASE}/demons/${id}/`;
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) {
      throw new Error(`Pointercrate returned ${res.status} for demon ${id}`);
    }
    const data = await res.json();
    // Some deployments wrap the object in { data: {...} } — handle both.
    return normalizeDemon(data.data || data);
  }

  async function searchByName(name) {
    const url = `${CONFIG.POINTERCRATE_BASE}/demons/listed?name_contains=${encodeURIComponent(name)}&limit=24`;
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`Pointercrate returned ${res.status}`);
    const data = await res.json();
    return data.map(normalizeDemon);
  }

  return { fetchListed, fetchDemon, searchByName };
})();
