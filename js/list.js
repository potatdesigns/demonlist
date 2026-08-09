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
  const filterToggleBtn = document.getElementById('filter-toggle');
  const filterPanel = document.getElementById('filter-panel');
  const filterBadge = document.getElementById('filter-badge');
  const verifierMinInput = document.getElementById('filter-verifier-min');
  const verifierMaxInput = document.getElementById('filter-verifier-max');
  const showcaseMinInput = document.getElementById('filter-showcase-min');
  const showcaseMaxInput = document.getElementById('filter-showcase-max');
  const filterClearBtn = document.getElementById('filter-clear');
  const sortSelect = document.getElementById('sort-select');
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

  // Not persisted in the URL like page/query (see writeUrlState) —
  // these are session-local refinements on top of whatever view you're
  // already on, not a "view" of their own worth bookmarking/sharing.
  const filters = { verifierMin: null, verifierMax: null, showcaseMin: null, showcaseMax: null };
  function filtersActive() {
    return filters.verifierMin !== null || filters.verifierMax !== null || filters.showcaseMin !== null || filters.showcaseMax !== null;
  }
  function activeFilterCount() {
    return [filters.verifierMin, filters.verifierMax, filters.showcaseMin, filters.showcaseMax].filter(v => v !== null).length;
  }

  // '' (default, position order) | 'verifier-desc' | 'verifier-asc' | 'showcase-desc' | 'showcase-asc'
  // — same session-local, not-in-the-URL treatment as `filters` above,
  // and the same reason: it's a lens on the current view, not a view of
  // its own. Sorting by either video's view count doesn't correspond to
  // any fixed rank order, so it's mutually exclusive with Main/Extended
  // (see customViewActive()) the same way search/filters already are.
  let sortMode = '';
  function sortActive() { return sortMode !== ''; }
  const SORT_LABELS = {
    'verifier-desc': 'verifier views, high to low',
    'verifier-asc': 'verifier views, low to high',
    'showcase-desc': 'showcase views, high to low',
    'showcase-asc': 'showcase views, low to high',
  };
  /** True whenever the grid shows something other than a plain Main/Extended page — search, a filter, or a sort — see load()'s branch on this. */
  function customViewActive() { return !!filterQuery || filtersActive() || sortActive(); }

  searchInput.addEventListener('input', debounce((e) => {
    filterQuery = e.target.value.trim();
    writeUrlState(true);
    load();
  }, 350));

  /** Opens a rank straight into its detail page — not just the list page containing it — since that's what you actually want when you type a specific rank in. Detail-page URLs are the rank itself (see cardTemplate()'s detailUrl), so this is just a bounds-checked redirect, no lookup needed. */
  jumpForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const pos = parseInt(jumpInput.value, 10);
    if (!Number.isFinite(pos) || pos <= 0) return;
    if (totalCount && pos > totalCount) {
      showBanner(`No level at rank #${pos} (list runs 1–${totalCount}).`, true);
      return;
    }
    window.location.href = `level.html#${pos}`;
  });

  // Main/Extended sit right in the hero at the top of the page — you're
  // already looking at where the grid is about to change, so scrolling
  // is just noise. Prev/Next/the page-jump form live at the *bottom* of
  // the grid instead, where staying put would leave you looking at the
  // tail end of a new page — those keep the scroll.
  filterMainBtn.addEventListener('click', () => goToPage(1, { scroll: false }));
  filterExtendedBtn.addEventListener('click', () => goToPage(2, { scroll: false }));

  filterToggleBtn.addEventListener('click', () => {
    const open = filterPanel.classList.toggle('open');
    filterToggleBtn.setAttribute('aria-expanded', String(open));
  });
  document.addEventListener('click', (e) => {
    if (!filterPanel.classList.contains('open')) return;
    if (e.target === filterToggleBtn || filterToggleBtn.contains(e.target) || filterPanel.contains(e.target)) return;
    closeFilterPanel();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && filterPanel.classList.contains('open')) closeFilterPanel();
  });
  function closeFilterPanel() {
    filterPanel.classList.remove('open');
    filterToggleBtn.setAttribute('aria-expanded', 'false');
  }

  function parseViewsInput(input) {
    const n = parseInt(input.value, 10);
    return Number.isFinite(n) && n >= 0 ? n : null;
  }
  function syncFilterUI() {
    filterToggleBtn.classList.toggle('active', filtersActive());
    const count = activeFilterCount();
    filterBadge.textContent = String(count);
    filterBadge.style.display = count ? '' : 'none';
  }
  function applyFiltersFromUI() {
    filters.verifierMin = parseViewsInput(verifierMinInput);
    filters.verifierMax = parseViewsInput(verifierMaxInput);
    filters.showcaseMin = parseViewsInput(showcaseMinInput);
    filters.showcaseMax = parseViewsInput(showcaseMaxInput);
    syncFilterUI();
    load();
  }
  /** Scoped to the filter panel only — the "Clear filters" button clears the range filters, not the separate sort dropdown (see clearSort()/resetRefinements() below for the broader reset used on navigation). */
  function clearFilters() {
    filters.verifierMin = null;
    filters.verifierMax = null;
    filters.showcaseMin = null;
    filters.showcaseMax = null;
    verifierMinInput.value = '';
    verifierMaxInput.value = '';
    showcaseMinInput.value = '';
    showcaseMaxInput.value = '';
    syncFilterUI();
  }
  const debouncedApplyFilters = debounce(applyFiltersFromUI, 350);
  verifierMinInput.addEventListener('input', debouncedApplyFilters);
  verifierMaxInput.addEventListener('input', debouncedApplyFilters);
  showcaseMinInput.addEventListener('input', debouncedApplyFilters);
  showcaseMaxInput.addEventListener('input', debouncedApplyFilters);
  filterClearBtn.addEventListener('click', () => { clearFilters(); load(); });

  function clearSort() { sortMode = ''; sortSelect.value = ''; }
  sortSelect.addEventListener('change', () => { sortMode = sortSelect.value; load(); });

  /** Used when navigating to a different page/search (Main/Extended chips, the M/E shortcuts, back/forward) — filters and sort are both a lens on top of whatever you're looking at, not part of that navigable state, so moving to a different view drops them rather than silently keeping a stale, invisible-looking refinement applied underneath it. */
  function resetRefinements() { clearFilters(); clearSort(); }

  pagerPrevBtn.addEventListener('click', () => goToPage(currentPage - 1));
  pagerNextBtn.addEventListener('click', () => goToPage(currentPage + 1));
  pagerPageForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const page = parseInt(pagerPageInput.value, 10);
    if (Number.isFinite(page)) goToPage(page);
  });

  function goToPage(page, { scroll = true } = {}) {
    currentPage = Math.max(1, totalPages ? Math.min(page, totalPages) : page);
    filterQuery = '';
    searchInput.value = '';
    jumpInput.value = '';
    resetRefinements();
    writeUrlState(true);
    load();
    if (scroll) gridEl.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  }

  /**
   * Reflects which page/filter is showing in the URL — as a *hash*
   * fragment (`#main`, `#extended`, `#q=...`, `#page=N`), not a query
   * string. True path-based URLs (`/main`, `/1`) still aren't safely
   * doable without knowing this site's actual host (would need a
   * GitHub-Pages-style 404-fallback rewrite, which not every static host
   * supports the same way, and which breaks plain `python -m
   * http.server` local dev entirely) — but a hash needs *no* server
   * involvement at all: the browser never sends it in the request, so
   * `index.html#main` loads exactly like `index.html` on literally any
   * host, and JS just reads `location.hash` once it's there. That's also
   * why `level.html#42` (see cardTemplate()'s detailUrl) doesn't have a
   * question mark either, and why queue.html doesn't have a fragment at
   * all — it has no state to encode (it's not a filtered view of
   * something else the way main/extended/a rank are), so there's nothing
   * to put after a `#`. `push` controls whether this creates a new
   * browser-history entry (user-initiated navigation) or just normalizes
   * the current one (initial load, popstate) — see readUrlState()'s
   * callers.
   */
  function writeUrlState(push) {
    const hash = filterQuery ? `q=${encodeURIComponent(filterQuery)}`
      : currentPage === 1 ? 'main'
      : currentPage === 2 ? 'extended'
      : `page=${currentPage}`;

    const url = `${window.location.pathname}#${hash}`;
    const state = { page: currentPage, query: filterQuery };
    if (push) history.pushState(state, '', url);
    else history.replaceState(state, '', url);
  }

  function readUrlState() {
    const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const q = params.get('q');
    if (q) return { page: 1, query: q };
    if (params.has('extended')) return { page: 2, query: '' };
    if (params.has('main')) return { page: 1, query: '' };
    const page = parseInt(params.get('page'), 10);
    if (Number.isFinite(page) && page > 0) return { page, query: '' };
    return { page: 1, query: '' };
  }

  /** Browser back/forward — re-sync state from the URL without pushing another history entry (that's what got us here). */
  function syncFromUrl() {
    const state = readUrlState();
    currentPage = state.page;
    filterQuery = state.query;
    searchInput.value = filterQuery;
    jumpInput.value = '';
    resetRefinements();
    load();
  }
  window.addEventListener('popstate', syncFromUrl);
  // popstate alone only fires for back/forward and pushState/replaceState
  // (which is all the buttons above ever do) — not for someone editing
  // the hash directly in the address bar, or a raw `#extended`-style
  // link, which the browser treats as a same-document navigation that
  // fires *this* instead.
  window.addEventListener('hashchange', syncFromUrl);

  function updateControlsUI() {
    const customView = customViewActive();
    filterMainBtn.classList.toggle('active', !customView && currentPage === 1);
    filterExtendedBtn.classList.toggle('active', !customView && currentPage === 2);
    updateDocumentTitle();

    if (customView) {
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

  function updateDocumentTitle() {
    if (filterQuery) document.title = `Demonlist | Search: ${filterQuery}`;
    else if (filtersActive()) document.title = 'Demonlist | Filtered';
    else if (sortActive()) document.title = 'Demonlist | Sorted';
    else if (currentPage === 1) document.title = 'Demonlist | Main';
    else if (currentPage === 2) document.title = 'Demonlist | Extended';
    else document.title = `Demonlist | Page ${currentPage}`;
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

  function cardTemplate(demon, index) {
    const tierColor = positionColor(demon.position, totalCount);
    const thumb = demon.thumbnail || 'data:image/svg+xml;utf8,' + encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="100%" height="100%" fill="#12151f"/></svg>`
    );
    const detailUrl = `level.html#${demon.position}`;
    const byNames = joinNames(demon.creators.length ? demon.creators : [demon.publisher].filter(Boolean));
    const publisherLabel = demon.publisher?.name || (demon.needsExtras ? '…' : 'Unknown');

    return `
      <article class="demon-card"
        style="--tier-color: ${tierColor}; --i: ${index}"
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
    gridEl.innerHTML = demons.map((d, i) => cardTemplate(d, i)).join('');
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

  /** Human-readable pieces of whatever's currently filled in the filter panel, for the banner and empty-state text. */
  function filterDescriptionParts() {
    const parts = [];
    if (filters.verifierMin !== null) parts.push(`verifier views ≥ ${filters.verifierMin.toLocaleString()}`);
    if (filters.verifierMax !== null) parts.push(`verifier views ≤ ${filters.verifierMax.toLocaleString()}`);
    if (filters.showcaseMin !== null) parts.push(`showcase views ≥ ${filters.showcaseMin.toLocaleString()}`);
    if (filters.showcaseMax !== null) parts.push(`showcase views ≤ ${filters.showcaseMax.toLocaleString()}`);
    return parts;
  }

  /** Combined description of whatever's making this a custom (non-paginated) view, for the banner and empty-state text. */
  function customViewDescription() {
    const bits = [];
    if (filterQuery) bits.push(`matching “${escapeHtml(filterQuery)}”`);
    const filterParts = filterDescriptionParts();
    if (filterParts.length) bits.push(`filtered by ${escapeHtml(filterParts.join(', '))}`);
    if (sortActive()) bits.push(`sorted by ${SORT_LABELS[sortMode]}`);
    return bits.join(', ');
  }

  function passesFilters(entry) {
    if (filters.verifierMin !== null && !(entry?.verifier?.viewCount >= filters.verifierMin)) return false;
    if (filters.verifierMax !== null && !(entry?.verifier?.viewCount <= filters.verifierMax)) return false;
    if (filters.showcaseMin !== null && !(entry?.showcase?.viewCount >= filters.showcaseMin)) return false;
    if (filters.showcaseMax !== null && !(entry?.showcase?.viewCount <= filters.showcaseMax)) return false;
    return true;
  }

  /** Sorts by whichever video + direction sortMode names, missing values last regardless of direction — "unknown" isn't meaningfully high or low, so it shouldn't win either end of the sort. */
  function sortCandidates(list, entryById) {
    const [field, dir] = sortMode.split('-'); // field: 'verifier' | 'showcase', dir: 'asc' | 'desc'
    const viewsOf = (d) => entryById.get(d.id)?.[field]?.viewCount;
    return list.slice().sort((a, b) => {
      const av = viewsOf(a), bv = viewsOf(b);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return dir === 'asc' ? av - bv : bv - av;
    });
  }

  // --- data loading ---
  async function load() {
    if (loading) return;
    loading = true;

    try {
      let demons;
      if (customViewActive()) {
        // Search, the filter panel, and the sort dropdown all need the
        // *entire* tracked list to work against, not just whatever page
        // was loaded — AredlAPI already holds it in memory (see
        // fetchFullList in api-aredl.js), so none of these cost an
        // extra round trip.
        let candidates = filterQuery
          ? (await AredlAPI.searchByName(filterQuery)).demons
          : (await AredlAPI.fetchListed({ limit: CONFIG.LIST_SIZE, offset: 0 })).demons;

        if (filtersActive() || sortActive()) {
          // Filtering and sorting both need the shared view-count cache,
          // not just AREDL's own fields — SharedYtCache.load() fetches
          // data/yt-cache.json once and caches it in memory (see
          // js/shared-cache.js), so getEntry() below is a plain
          // in-memory lookup after the first call on the page, not a
          // fresh network round trip per candidate level. Fetched once
          // here and shared between the filter and sort passes rather
          // than each doing its own pass over the cache.
          const entries = await Promise.all(candidates.map(d => SharedYtCache.getEntry(d.id)));
          const entryById = new Map(candidates.map((d, i) => [d.id, entries[i]]));
          if (filtersActive()) candidates = candidates.filter(d => passesFilters(entryById.get(d.id)));
          if (sortActive()) candidates = sortCandidates(candidates, entryById);
        }
        demons = candidates;
      } else {
        const page = await DataSource.fetchPage(currentPage);
        demons = page.demons;
        if (page.total) {
          totalCount = page.total;
          totalPages = Math.max(1, Math.ceil(totalCount / CONFIG.PAGE_SIZE));
        }
      }

      if (demons.length === 0) {
        const desc = customViewDescription();
        gridEl.innerHTML = `<div class="empty-state">No levels found${desc ? ` ${desc}` : ''}.</div>`;
      } else {
        renderCards(demons);
      }

      if (customViewActive()) {
        const desc = customViewDescription();
        showBanner(`${demons.length} level${demons.length === 1 ? '' : 's'}${desc ? ` ${desc}` : ''}.`);
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
    const state = readUrlState();
    currentPage = state.page;
    filterQuery = state.query;
    searchInput.value = filterQuery;
    writeUrlState(false); // normalize e.g. a bare index.html into index.html#main, without an extra history entry

    gridEl.innerHTML = skeletonCards(CONFIG.PAGE_SIZE);
    hideBanner();
    load();
  }

  initialLoad();
})();
