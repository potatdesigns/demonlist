/* =====================================================================
   DATA SOURCE ROUTER
   Wraps PointercrateAPI / AredlAPI behind one interface so list.js and
   detail.js don't need to know which backend is active. Cursor format
   differs between the two adapters (a Link-header URL for Pointercrate,
   an offset marker for AREDL) — it's opaque to callers either way.
   ===================================================================== */

const DataSource = (() => {

  function adapterFor(source) {
    return source === 'aredl' ? AredlAPI : PointercrateAPI;
  }

  async function fetchPage(source, cursor) {
    if (source === 'aredl') {
      const offset = typeof cursor === 'string' && cursor.startsWith('__offset__')
        ? parseInt(cursor.replace('__offset__', ''), 10)
        : 0;
      const { demons, nextUrl } = await AredlAPI.fetchListed({ limit: CONFIG.PAGE_SIZE, offset });
      return { demons, nextCursor: nextUrl };
    }
    const { demons, nextUrl } = await PointercrateAPI.fetchListed({
      limit: CONFIG.PAGE_SIZE,
      cursorUrl: cursor || null,
    });
    return { demons, nextCursor: nextUrl };
  }

  async function fetchOne(source, id) {
    return adapterFor(source).fetchDemon(id);
  }

  return { fetchPage, fetchOne };
})();
