/* =====================================================================
   DATA SOURCE
   Thin pass-through to AredlAPI, keyed by 1-indexed page number (each
   page is CONFIG.PAGE_SIZE levels) rather than an opaque cursor — the
   whole list is cached in memory client-side (see fetchFullList in
   api-aredl.js), so any page is just a synchronous slice of it.
   ===================================================================== */

const DataSource = (() => {

  async function fetchPage(page) {
    const offset = (Math.max(1, page) - 1) * CONFIG.PAGE_SIZE;
    const { demons, total } = await AredlAPI.fetchListed({ limit: CONFIG.PAGE_SIZE, offset });
    return { demons, total };
  }

  async function fetchOne(id) {
    return AredlAPI.fetchDemon(id);
  }

  return { fetchPage, fetchOne };
})();
