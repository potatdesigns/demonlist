/* =====================================================================
   QUEUE PAGE CONTROLLER

   Shows the actual persisted showcase-discovery queue (cache.queue in
   data/yt-cache.json, see scripts/refresh-yt-cache.mjs's runDiscover())
   in its real stored order — not a fresh client-side re-sort. That queue
   is built once (null-showcase levels first, then ascending by showcase
   view count) and then *drains* as the discover workflow actually
   processes levels, refilling from scratch once empty — so this list
   should visibly shrink between runs and jump back to ~150 on refill,
   rather than always showing the same full list. Purely read-only/
   informational — no trigger lives here, see js/cache-admin-ui.js for
   the one remaining (per-level) refresh control, which also moves that
   level to the front of this same queue.
   ===================================================================== */

(() => {
  const listEl = document.getElementById('queue-list');
  const stateBanner = document.getElementById('state-banner');

  function showBanner(msg, isError = false) {
    stateBanner.innerHTML = msg;
    stateBanner.className = 'state-banner' + (isError ? ' error' : '');
    stateBanner.style.display = 'block';
  }

  function rowTemplate(demon, queuePos, viewCount, index) {
    const status = viewCount === null
      ? `<span class="queue-status null">no showcase yet</span>`
      : `<span class="queue-status">${formatCount(viewCount)} views</span>`;
    return `
      <a class="queue-row" href="level.html#${demon.position}" style="--i: ${index}">
        <span class="queue-pos">${queuePos}</span>
        <span class="queue-rank">#${demon.position}</span>
        <span class="queue-name">${escapeHtml(demon.name)}</span>
        ${status}
      </a>
    `;
  }

  async function load() {
    listEl.innerHTML = skeletonRows(20);
    try {
      const [{ demons, total }, ytCache] = await Promise.all([
        AredlAPI.fetchListed({ limit: CONFIG.LIST_SIZE, offset: 0 }),
        SharedYtCache.load(),
      ]);

      const showcaseViews = (d) => ytCache.levels?.[d.id]?.showcase?.viewCount ?? null;
      const demonsById = new Map(demons.map(d => [d.id, d]));

      // A cache written before the persisted queue existed won't have
      // cache.queue yet — fall back to computing the same starting order
      // client-side, purely so this page isn't blank in the meantime.
      // Once the next discover run writes a real cache.queue, this
      // branch stops being taken.
      const hasPersistedQueue = Array.isArray(ytCache.queue);
      const queue = hasPersistedQueue
        ? ytCache.queue.map(id => demonsById.get(id)).filter(Boolean)
        : (() => {
            const withoutShowcase = demons.filter(d => showcaseViews(d) === null);
            const byShowcaseViews = demons.filter(d => showcaseViews(d) !== null).sort((a, b) => showcaseViews(a) - showcaseViews(b));
            return [...withoutShowcase, ...byShowcaseViews];
          })();

      if (queue.length === 0) {
        listEl.innerHTML = `<div class="empty-state">Queue's empty — every tracked level was checked this cycle. It refills automatically once the discover workflow runs again.</div>`;
      } else {
        listEl.innerHTML = queue.map((d, i) => rowTemplate(d, i + 1, showcaseViews(d), i)).join('');
      }

      showBanner(hasPersistedQueue
        ? `${queue.length} of ${total} levels still need a check this cycle — shrinks as the discover workflow runs, refills once it hits zero.`
        : `${queue.length} of ${total} levels have no showcase on file yet — those go first, then ascending by showcase views. (No persisted queue in the cache yet — showing a freshly computed starting order until the next discover run writes one.)`);
    } catch (err) {
      console.error(err);
      showBanner(`Couldn't load the queue: ${escapeHtml(err.message)}`, true);
      listEl.innerHTML = '';
    }
  }

  function skeletonRows(n) {
    return Array.from({ length: n }).map(() => `<div class="queue-row skeleton-row"><div class="skeleton" style="height:14px;width:100%;"></div></div>`).join('');
  }

  load();
})();
