/* =====================================================================
   DATA SOURCE
   Thin pass-through to AredlAPI. Kept as its own module (rather than
   having list.js/detail.js call AredlAPI directly) so the rest of the
   app doesn't need to change shape if another list source is ever added
   back — cursor format (an `__offset__N` marker) is opaque to callers
   either way.
   ===================================================================== */

const DataSource = (() => {

  async function fetchPage(cursor) {
    const offset = typeof cursor === 'string' && cursor.startsWith('__offset__')
      ? parseInt(cursor.replace('__offset__', ''), 10)
      : 0;
    const { demons, nextUrl, total } = await AredlAPI.fetchListed({ limit: CONFIG.PAGE_SIZE, offset });
    return { demons, nextCursor: nextUrl, total, offset };
  }

  async function fetchOne(id) {
    return AredlAPI.fetchDemon(id);
  }

  return { fetchPage, fetchOne };
})();
