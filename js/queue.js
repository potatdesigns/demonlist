/* =====================================================================
   QUEUE PAGE CONTROLLER

   Shows the current showcase-discovery priority queue as a plain,
   scannable list — mirrors the exact ordering logic in
   scripts/refresh-yt-cache.mjs's runDiscover(): levels with no showcase
   on file yet go first, then the rest ordered by ascending showcase view
   count (see the README's "Shared showcase/view-count cache" section for
   why). Purely read-only/informational — no trigger lives here, see
   js/cache-admin-ui.js for the one remaining (per-level) refresh control.
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
      <a class="queue-row" href="level.html?${demon.position}" style="--i: ${index}">
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
      const withoutShowcase = demons.filter(d => showcaseViews(d) === null);
      const byShowcaseViews = demons.filter(d => showcaseViews(d) !== null).sort((a, b) => showcaseViews(a) - showcaseViews(b));
      const queue = [...withoutShowcase, ...byShowcaseViews];

      listEl.innerHTML = queue.map((d, i) => rowTemplate(d, i + 1, showcaseViews(d), i)).join('');
      showBanner(`${withoutShowcase.length} of ${total} levels have no showcase on file yet — those go first, then ascending by showcase views.`);
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
