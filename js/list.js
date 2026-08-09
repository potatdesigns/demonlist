/* =====================================================================
   LIST PAGE CONTROLLER
   ===================================================================== */

(() => {
  const gridEl = document.getElementById('demon-grid');
  const searchInput = document.getElementById('search-input');
  const jumpForm = document.getElementById('jump-form');
  const jumpInput = document.getElementById('jump-input');
  const filterMainBtn = document.getElementById('filter-main');
  const filterExtendedBtn = document.getElementById('filter-extended');
  const stateBanner = document.getElementById('state-banner');
  const pagerRow = document.getElementById('pager-row');
  const pagerPrevBtn = document.getElementById('pager-prev');
  const pagerNextBtn = document.getElementById('pager-next');
  const pagerPageForm = document.getElementById('pager-page-form');
  const pagerPageInput = document.getElementById('pager-page-input');
  const pagerTotalPagesEl = document.getElementById('pager-total-pages');

  let currentPage = 1;
  let totalCount = 0;
  let totalPages = 1;
  let filterQuery = '';
  let loading = false;
  let opening = false;

  CacheAdminUI.mountQueueRefreshButton(document.getElementById('header-actions'));

  searchInput.addEventListener('input', debounce((e) => {
    filterQuery = e.target.value.trim();
    load();
  }, 350));

  /** Opens a rank straight into its detail page — not just the list page containing it — since that's what you actually want when you type a specific rank in. */
  jumpForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (opening) return;
    const pos = parseInt(jumpInput.value, 10);
    if (!Number.isFinite(pos) || pos <= 0) return;

    opening = true;
    jumpInput.disabled = true;
    try {
      const id = await AredlAPI.getIdByPosition(pos);
      if (id) {
        window.location.href = `level.html?id=${encodeURIComponent(id)}`;
      } else {
        showBanner(`No level at rank #${pos}${totalCount ? ` (list runs 1–${totalCount})` : ''}.`, true);
      }
    } catch (err) {
      showBanner(`Couldn't open rank #${pos}: ${escapeHtml(err.message)}`, true);
    } finally {
      opening = false;
      jumpInput.disabled = false;
    }
  });

  filterMainBtn.addEventListener('click', () => goToPage(1));
  filterExtendedBtn.addEventListener('click', () => goToPage(2));

  pagerPrevBtn.addEventListener('click', () => goToPage(currentPage - 1));
  pagerNextBtn.addEventListener('click', () => goToPage(currentPage + 1));
  pagerPageForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const page = parseInt(pagerPageInput.value, 10);
    if (Number.isFinite(page)) goToPage(page);
  });

  function goToPage(page) {
    currentPage = Math.max(1, totalPages ? Math.min(page, totalPages) : page);
    filterQuery = '';
    searchInput.value = '';
    jumpInput.value = '';
    load();
    gridEl.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  }

  function updateControlsUI() {
    filterMainBtn.classList.toggle('active', !filterQuery && currentPage === 1);
    filterExtendedBtn.classList.toggle('active', !filterQuery && currentPage === 2);

    if (filterQuery) {
      pagerRow.style.display = 'none';
      return;
    }
    pagerRow.style.display = totalPages > 1 ? 'flex' : 'none';
    pagerPrevBtn.disabled = currentPage <= 1;
    pagerNextBtn.disabled = currentPage >= totalPages;
    pagerPageInput.value = currentPage;
    pagerPageInput.max = String(totalPages);
    pagerTotalPagesEl.textContent = totalPages;
  }

  AredlAPI.getTotalCount().then(total => {
    totalCount = total;
    totalPages = Math.max(1, Math.ceil(total / CONFIG.PAGE_SIZE));
    searchInput.placeholder = `Search all ${total} levels by name…`;
    updateControlsUI();
  }).catch(() => { /* the main load below will surface the real error */ });

  function showBanner(msg, isError = false) {
    stateBanner.innerHTML = msg;
    stateBanner.className = 'state-banner' + (isError ? ' error' : '');
    stateBanner.style.display = 'block';
  }
  function hideBanner() { stateBanner.style.display = 'none'; }

  function skeletonCards(n) {
    return Array.from({ length: n }).map(() => `
      <div class="demon-card skeleton-card" aria-hidden="true">
        <div class="skeleton card-thumb-wrap"></div>
        <div class="sk-line skeleton w60"></div>
        <div class="sk-line skeleton w40"></div>
      </div>
    `).join('');
  }

  function cardTemplate(demon) {
    const tier = tierFromPosition(demon.position, totalCount);
    const thumb = demon.thumbnail || 'data:image/svg+xml;utf8,' + encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="100%" height="100%" fill="#12151f"/></svg>`
    );
    const detailUrl = `level.html?id=${encodeURIComponent(demon.id)}`;
    const byNames = joinNames(demon.creators.length ? demon.creators : [demon.publisher].filter(Boolean));
    const publisherLabel = demon.publisher?.name || (demon.needsExtras ? '…' : 'Unknown');

    return `
      <article class="demon-card"
        style="--tier-color: ${tierColorVar(tier)}"
        data-id="${escapeHtml(String(demon.id))}"
        data-source="${escapeHtml(demon.source)}"
        data-needs-extras="${demon.needsExtras ? '1' : '0'}"
        data-video="${escapeHtml(demon.videoUrl || '')}"
        data-name="${escapeHtml(demon.name)}"
        data-level-id="${demon.levelId ?? ''}">
        <a class="card-link" href="${detailUrl}">
          <div class="card-thumb-wrap">
            <img src="${thumb}" alt="${escapeHtml(demon.name)} thumbnail" loading="lazy" onerror="this.style.opacity=0">
            <span class="card-rank">#${demon.position ?? '?'}</span>
          </div>
          <div class="card-body">
            <div class="card-title">${escapeHtml(demon.name)}</div>
            <div class="card-meta">
              <span><strong>By</strong> <span data-role="by-names">${escapeHtml(byNames)}</span></span>
              <span><strong>Published by</strong> <span data-role="publisher-name">${escapeHtml(publisherLabel)}</span></span>
              <span><strong>Verified by</strong> <span data-role="verifier-name">${escapeHtml(demon.verifier?.name || (demon.needsExtras ? '…' : 'Unknown'))}</span></span>
            </div>
          </div>
        </a>
        <div class="card-body" style="padding-top:0;">
          <div class="view-compare">
            <div class="view-stat verifier" data-role="verifier-stat">
              <span class="dot"></span>
              <span class="stat-text"><span class="stat-label">Verifier vid</span><span class="stat-value loading">···</span></span>
            </div>
            <div class="view-stat showcase" data-role="showcase-stat">
              <span class="dot"></span>
              <span class="stat-text"><span class="stat-label">Top showcase</span><span class="stat-value loading">···</span></span>
            </div>
          </div>
        </div>
      </article>
    `;
  }

  function renderCards(demons) {
    gridEl.innerHTML = demons.map(cardTemplate).join('');
    observeAllCards();
  }

  // --- lazy hydration, only for cards currently visible ---
  // Each IntersectionObserver callback can report several cards becoming
  // visible in one batch — that batch is hydrated together (see
  // hydrateCards() below).
  let observer = null;
  function observeAllCards() {
    if (!observer) {
      observer = new IntersectionObserver((entries) => {
        const targets = entries.filter(e => e.isIntersecting).map(e => e.target);
        targets.forEach(t => observer.unobserve(t));
        if (targets.length) hydrateCards(targets);
      }, { rootMargin: '200px' });
    }
    gridEl.querySelectorAll('.demon-card:not([data-observed])').forEach(card => {
      card.setAttribute('data-observed', '1');
      observer.observe(card);
    });
  }

  /** Resolve AREDL's verification video/thumbnail/verifier/creators for a card that only has bare list fields so far. */
  async function hydrateAredlExtrasIfNeeded(card) {
    if (card.dataset.source !== 'aredl' || card.dataset.needsExtras !== '1') return;
    try {
      const demon = await AredlAPI.fetchExtras(card.dataset.id);
      card.dataset.needsExtras = '0';
      card.dataset.video = demon.videoUrl || '';

      const img = card.querySelector('.card-thumb-wrap img');
      if (img && demon.thumbnail) { img.src = demon.thumbnail; img.style.opacity = ''; }

      const byEl = card.querySelector('[data-role="by-names"]');
      if (byEl) {
        const names = demon.creators.length ? demon.creators : [demon.publisher].filter(Boolean);
        byEl.textContent = joinNames(names);
      }

      const publisherEl = card.querySelector('[data-role="publisher-name"]');
      if (publisherEl) publisherEl.textContent = demon.publisher?.name || 'Unknown';

      const verifierEl = card.querySelector('[data-role="verifier-name"]');
      if (verifierEl) verifierEl.textContent = demon.verifier?.name || 'Unknown';
    } catch (e) {
      card.dataset.needsExtras = '0'; // don't retry forever on failure
      card.querySelectorAll('[data-role="publisher-name"], [data-role="verifier-name"]').forEach(el => {
        if (el.textContent === '…') el.textContent = 'Unknown';
      });
    }
  }

  /** Write one view-count value into a verifier/showcase stat block. */
  function setStatValue(statEl, viewCount) {
    const val = statEl.querySelector('.stat-value');
    const has = viewCount !== null && viewCount !== undefined;
    val.textContent = has ? formatCount(viewCount) : 'Not cached yet';
    val.classList.remove('loading');
    val.classList.toggle('na', !has);
    statEl.dataset.views = has ? String(viewCount) : '';
  }

  /** Highlight whichever of a card's two stat blocks has the higher view count, once both are known. */
  function updateLeader(card) {
    const verifierStat = card.querySelector('[data-role="verifier-stat"]');
    const showcaseStat = card.querySelector('[data-role="showcase-stat"]');
    const v = parseInt(verifierStat.dataset.views, 10);
    const s = parseInt(showcaseStat.dataset.views, 10);
    verifierStat.classList.remove('leader');
    showcaseStat.classList.remove('leader');
    if (Number.isFinite(v) && Number.isFinite(s)) {
      if (v > s) verifierStat.classList.add('leader');
      else if (s > v) showcaseStat.classList.add('leader');
    }
  }

  /**
   * Hydrate a batch of cards that just became visible:
   *  1) AREDL extras (video/thumbnail/verifier/publisher/creators)
   *  2) the shared cache (data/yt-cache.json via SharedYtCache) for view
   *     counts / showcase — the only source for those; there's no
   *     personal-key live fallback anymore, so a level the shared cache
   *     hasn't reached yet just shows "Not cached yet".
   */
  async function hydrateCards(cards) {
    await Promise.all(cards.map(hydrateAredlExtrasIfNeeded));

    const sharedEntries = await Promise.all(cards.map(c => SharedYtCache.getEntry(c.dataset.id)));
    cards.forEach((card, i) => {
      const entry = sharedEntries[i];
      setStatValue(card.querySelector('[data-role="verifier-stat"]'), entry?.verifier?.viewCount ?? null);
      setStatValue(card.querySelector('[data-role="showcase-stat"]'), entry?.showcase?.viewCount ?? null);
      updateLeader(card);
    });
  }

  // --- data loading ---
  async function load() {
    if (loading) return;
    loading = true;

    try {
      let demons, matchCount = null;
      if (filterQuery) {
        // full-list search — AredlAPI already holds the whole list in
        // memory (see fetchFullList in api-aredl.js), so this filters
        // across all ~1600 levels, not just whatever page was loaded.
        const result = await AredlAPI.searchByName(filterQuery);
        demons = result.demons;
        matchCount = result.total;
      } else {
        const page = await DataSource.fetchPage(currentPage);
        demons = page.demons;
        if (page.total) {
          totalCount = page.total;
          totalPages = Math.max(1, Math.ceil(totalCount / CONFIG.PAGE_SIZE));
        }
      }

      if (demons.length === 0) {
        gridEl.innerHTML = `<div class="empty-state">No levels found${filterQuery ? ` for “${escapeHtml(filterQuery)}”` : ''}.</div>`;
      } else {
        renderCards(demons);
      }

      if (matchCount !== null && matchCount > demons.length) {
        showBanner(`Showing the first ${demons.length} of ${matchCount} matches for “${escapeHtml(filterQuery)}” — narrow your search to see the rest.`);
      } else {
        hideBanner();
      }
      updateControlsUI();
    } catch (err) {
      console.error(err);
      showBanner(
        `Couldn't load the list from <strong>AREDL</strong>: ${escapeHtml(err.message)}` +
        ` — its API shape may differ from what <code>js/api-aredl.js</code> expects; see the notes at the top of that file.`,
        true
      );
      gridEl.innerHTML = '';
      pagerRow.style.display = 'none';
    } finally {
      loading = false;
    }
  }

  function initialLoad() {
    gridEl.innerHTML = skeletonCards(CONFIG.PAGE_SIZE);
    hideBanner();
    load();
  }

  initialLoad();
})();
