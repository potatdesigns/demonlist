/* =====================================================================
   POINTERCRATE ADAPTER
   Docs: https://pointercrate.com/documentation/index/
   Every consumer of demon data (list.js, detail.js) talks to the
   normalized shape below, never to raw Pointercrate JSON directly —
   that's what makes it possible to swap in the AREDL adapter.

   Two things confirmed straight from the (open-source) Pointercrate
   backend that the original version of this file got wrong:
     - every route needs a trailing slash: Rocket treats "/listed" and
       "/listed/" as two different routes, so the un-slashed URL this
       file used to build was 404ing.
     - the app registers no CORS fairing at all, so a plain fetch() from
       any origin other than pointercrate.com itself is blocked by the
       browser before the response body is ever readable — that's the
       "Failed to fetch" this file used to throw. corsFetchJson() (see
       utils.js) transparently retries through a CORS proxy when that
       happens.
   Pagination here uses the `after=<position>` query param directly
   (confirmed against pointercrate-demonlist/src/demon/paginate.rs)
   instead of the response's `Link` header, since a proxied response
   can't carry that header through anyway.
   ===================================================================== */

const PointercrateAPI = (() => {

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
      // Prefer a thumbnail derived straight from the verification video —
      // Pointercrate's own `thumbnail` field defaults to that but can be
      // manually overridden by staff to something unrelated, and the ask
      // here is specifically "thumbnail of the verification video".
      thumbnail: youTubeThumbnail(raw.video) || raw.thumbnail || null,
      levelId: raw.level_id ?? null,
      verifier: normalizePlayer(raw.verifier),
      publisher: normalizePlayer(raw.publisher),
      creators: Array.isArray(creatorsRaw) ? creatorsRaw.map(normalizePlayer) : [],
      raw,
    };
  }

  function assertArray(data, context) {
    if (!Array.isArray(data)) {
      throw new Error(`Pointercrate returned an unexpected response shape for ${context} — try again in a moment.`);
    }
    return data;
  }

  /**
   * Fetch a page of the *listed* demons (i.e. currently ranked, sorted
   * by position). `cursorUrl`, when provided, is the position of the
   * last demon on the previous page — passed as Pointercrate's `after`
   * query param to fetch the next page.
   */
  async function fetchListed({ limit = CONFIG.PAGE_SIZE, cursorUrl = null } = {}) {
    const after = cursorUrl ? `&after=${encodeURIComponent(cursorUrl)}` : '';
    const url = `${CONFIG.POINTERCRATE_BASE}/demons/listed/?limit=${limit}${after}`;
    const res = await corsFetchJson(url);
    if (!res.ok && !res.viaProxy) {
      throw new Error(`Pointercrate returned ${res.status} for ${url}`);
    }
    const data = assertArray(await res.json(), 'the demon list');
    const demons = data.map(normalizeDemon);
    const last = demons[demons.length - 1];
    const nextUrl = demons.length === limit && last ? String(last.position) : null;
    return { demons, nextUrl };
  }

  async function fetchDemon(id) {
    const url = `${CONFIG.POINTERCRATE_BASE}/demons/${id}/`;
    const res = await corsFetchJson(url);
    if (!res.ok && !res.viaProxy) {
      throw new Error(`Pointercrate returned ${res.status} for demon ${id}`);
    }
    const data = await res.json();
    // Some deployments wrap the object in { data: {...} } — handle both.
    const raw = data.data || data;
    if (!raw || raw.id === undefined) {
      throw new Error(`Pointercrate returned an unexpected response shape for demon ${id} — try again in a moment.`);
    }
    return normalizeDemon(raw);
  }

  async function searchByName(name) {
    const url = `${CONFIG.POINTERCRATE_BASE}/demons/listed/?name_contains=${encodeURIComponent(name)}&limit=24`;
    const res = await corsFetchJson(url);
    if (!res.ok && !res.viaProxy) throw new Error(`Pointercrate returned ${res.status}`);
    const data = assertArray(await res.json(), 'the search results');
    return data.map(normalizeDemon);
  }

  return { fetchListed, fetchDemon, searchByName };
})();
