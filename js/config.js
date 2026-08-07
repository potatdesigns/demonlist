/* =====================================================================
   CONFIG — endpoints, storage keys, tunables
   ===================================================================== */

const CONFIG = {
  // Pointercrate: confirmed, stable, public, no key required.
  // Docs: https://pointercrate.com/documentation/demons/
  POINTERCRATE_BASE: 'https://pointercrate.com/api/v2',

  // AREDL: public API, docs at https://api.aredl.net/v2/docs
  // The exact JSON shape isn't fully published outside their live Scalar
  // docs, so this adapter is best-effort — see js/api-aredl.js for notes
  // and a single spot to patch field names if the site's response shape
  // differs from what's assumed here.
  AREDL_BASE: 'https://api.aredl.net/v2/api/aredl',

  PAGE_SIZE: 24,

  // localStorage keys
  STORAGE: {
    SOURCE: 'gddl_source',           // 'pointercrate' | 'aredl'
    YT_KEY: 'gddl_yt_api_key',
    YT_CACHE: 'gddl_yt_cache_v1',    // { [cacheKey]: { data, ts } }
  },

  YT_CACHE_TTL_MS: 1000 * 60 * 60 * 6, // 6 hours

  // Channels known for high-production showcase/completion videos.
  // Used to bias the "best showcase" search toward reliable sources
  // before falling back to a plain view-count sort across all results.
  SHOWCASE_CHANNELS: [
    'Nexus', 'Neiro', 'Requi', 'ThatSlurpo', 'iamgd10', 'Bezt',
    'Bagage GD', 'Chevron GD', 'Dorami', 'Silica GD', 'zenithGD',
  ],
};

function getSource() {
  return localStorage.getItem(CONFIG.STORAGE.SOURCE) || 'pointercrate';
}
function setSource(src) {
  localStorage.setItem(CONFIG.STORAGE.SOURCE, src);
}
