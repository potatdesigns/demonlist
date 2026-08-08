/* =====================================================================
   LIST PAGE CONTROLLER
   ===================================================================== */

(() => {
  const gridEl = document.getElementById('demon-grid');
  const loadMoreRow = document.getElementById('load-more-row');
  const loadMoreBtn = document.getElementById('load-more-btn');
  const searchInput = document.getElementById('search-input');
  const jumpForm = document.getElementById('jump-form');
  const jumpInput = document.getElementById('jump-input');
  const rangeChipsEl = document.getElementById('range-chips');
  const stateBanner = document.getElementById('state-banner');
  const headerActions = document.getElementById('header-actions');

  let cursor = null;
  let allLoaded = [];       // demons loaded so far, in order
  let filterQuery = '';
  let loading = false;
  let totalCount = 0;       // known once the first page (or the total-count lookup) resolves

  YtKeyUI.mountKeyButton(headerActions, () => {
    // key just saved — (re)try loading counts for cards already on screen
    // that came up empty ("Add key"/N/A) the first time around
    const stale = [...gridEl.querySelectorAll('.demon-card')].filter(c => c.querySelector('.stat-value.na'));
    if (stale.length) hydrateCards(stale);
    observeAllCards(); // and observe anything not yet seen, as before
  });

  searchInput.addEventListener('input', debounce((e) => {
    filterQuery = e.target.value.trim();
    setActiveChip(null);
    resetAndLoad();
  }, 350));

  jumpForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const pos = parseInt(jumpInput.value, 10);
    if (Number.isFinite(pos) && pos > 0) jumpToPosition(pos);
  });

  // --- quick range chips: static, round breakpoints tuned for AREDL's
  // current list size (~1600); ranges beyond the real total are simply
  // skipped, so this doesn't need retuning if the list grows.
  const RANGE_BREAKPOINTS = [1, 51, 151, 301, 601, 1001];
  function renderRangeChips(total) {
    if (!total || rangeChipsEl.childElementCount) return;
    const ranges = RANGE_BREAKPOINTS
      .filter(start => start <= total)
      .map((start, i, arr) => [start, i + 1 < arr.length ? arr[i + 1] - 1 : total]);
    rangeChipsEl.innerHTML = ranges.map(([start, end]) =>
      `<button type="button" class="range-chip" data-start="${start}">#${start}${end > start ? `–${end}` : ''}</button>`
    ).join('');
  }
  rangeChipsEl.addEventListener('click', (e) => {
    const btn = e.target.closest('.range-chip');
    if (!btn) return;
    setActiveChip(btn);
    jumpToPosition(parseInt(btn.dataset.start, 10));
  });
  function setActiveChip(btn) {
    rangeChipsEl.querySelectorAll('.range-chip').forEach(c => c.classList.toggle('active', c === btn));
  }

  function jumpToPosition(pos) {
    const clamped = totalCount ? Math.max(1, Math.min(pos, totalCount)) : Math.max(1, pos);
    filterQuery = '';
    searchInput.value = '';
    jumpInput.value = clamped > 1 ? String(clamped) : '';
    startLoadingFrom(clamped > 1 ? `__offset__${clamped - 1}` : null);
    gridEl.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  }

  AredlAPI.getTotalCount().then(total => {
    totalCount = total;
    renderRangeChips(total);
    jumpInput.max = String(total);
    jumpInput.placeholder = `Jump to rank (1–${total})`;
    searchInput.placeholder = `Search all ${total} levels by name…`;
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

  function renderCards(demons, { append }) {
    const html = demons.map(cardTemplate).join('');
    if (append) gridEl.insertAdjacentHTML('beforeend', html);
    else gridEl.innerHTML = html;
    observeAllCards();
  }

  // --- lazy hydration, only for cards currently visible ---
  // Each IntersectionObserver callback can report several cards becoming
  // visible in one batch (e.g. the initial page render, or a fast scroll)
  // — that batch is hydrated together so verifier-video stats can be
  // fetched as a single videos.list call instead of one per card (see
  // hydrateCards() below, and CONFIG.YT_* in config.js for why this
  // matters for quota).
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

  function markNeedsKey(card) {
    const verifierStat = card.querySelector('[data-role="verifier-stat"]');
    const showcaseStat = card.querySelector('[data-role="showcase-stat"]');
    [verifierStat, showcaseStat].forEach(el => {
      const val = el.querySelector('.stat-value');
      val.textContent = 'Not cached yet';
      val.classList.remove('loading');
      val.classList.add('na');
      el.style.cursor = 'pointer';
      el.title = 'Not in the shared cache yet — click to check live with your own YouTube API key';
      el.addEventListener('click', () => YtKeyUI.openModal(() => hydrateCards([card])), { once: true });
    });
  }

  function clearNeedsKeyAffordance(card) {
    card.querySelectorAll('[data-role="verifier-stat"], [data-role="showcase-stat"]').forEach(el => {
      el.style.cursor = '';
      el.removeAttribute('title');
    });
  }

  /** Write one view-count value into a verifier/showcase stat block and stash the raw number on it for updateLeader(). */
  function setStatValue(statEl, viewCount) {
    const val = statEl.querySelector('.stat-value');
    const has = viewCount !== null && viewCount !== undefined;
    val.textContent = has ? formatCount(viewCount) : 'N/A';
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

  /** Live personal-key lookup for a card the shared cache hasn't reached yet — only ever called for that gap, never as the default path. */
  async function applyStatsAndShowcase(card, verifierStats) {
    const verifierStat = card.querySelector('[data-role="verifier-stat"]');
    const showcaseStat = card.querySelector('[data-role="showcase-stat"]');
    const name = card.dataset.name;
    const levelId = card.dataset.levelId || null;

    setStatValue(verifierStat, verifierStats?.viewCount ?? null);

    let sViews = null;
    try {
      const showcase = name ? await YouTube.findBestShowcase(name, levelId) : null;
      sViews = showcase?.viewCount ?? null;
    } catch { /* leave sViews null — surfaced as N/A below */ }
    setStatValue(showcaseStat, sViews);

    updateLeader(card);
  }

  /**
   * Hydrate a batch of cards that just became visible:
   *  1) AREDL extras (own API, no YouTube quota cost either way)
   *  2) the shared cache (data/yt-cache.json via SharedYtCache) — free,
   *     works for every visitor, no quota touched at all
   *  3) only for cards the shared cache hasn't reached yet: a personal-key
   *     live lookup, batched into one videos.list call for the whole gap
   */
  async function hydrateCards(cards) {
    await Promise.all(cards.map(hydrateAredlExtrasIfNeeded));

    const sharedEntries = await Promise.all(cards.map(c => SharedYtCache.getEntry(c.dataset.id)));
    const gapCards = [];
    cards.forEach((card, i) => {
      const entry = sharedEntries[i];
      if (entry) {
        setStatValue(card.querySelector('[data-role="verifier-stat"]'), entry.verifier?.viewCount ?? null);
        setStatValue(card.querySelector('[data-role="showcase-stat"]'), entry.showcase?.viewCount ?? null);
        updateLeader(card);
      } else {
        gapCards.push(card);
      }
    });

    if (gapCards.length === 0) return;

    if (!YouTube.hasKey()) {
      gapCards.forEach(markNeedsKey);
      return;
    }

    gapCards.forEach(clearNeedsKeyAffordance);

    const videoUrls = gapCards.map(c => c.dataset.video || null);
    let statsResults;
    try {
      statsResults = await YouTube.getVideoStatsBatch(videoUrls);
    } catch (e) {
      statsResults = gapCards.map(() => null);
    }

    await Promise.all(gapCards.map((card, i) => applyStatsAndShowcase(card, statsResults[i])));
  }

  // --- data loading ---
  async function loadPage(isFirstPage) {
    if (loading) return;
    loading = true;
    loadMoreBtn.disabled = true;
    loadMoreBtn.textContent = 'Loading…';

    try {
      let demons, nextCursor, matchCount = null;
      if (filterQuery) {
        // full-list search — AredlAPI already holds the whole list in
        // memory (see fetchFullList in api-aredl.js), so this filters
        // across all ~1600 levels, not just whatever page was loaded.
        const result = await AredlAPI.searchByName(filterQuery);
        demons = result.demons;
        matchCount = result.total;
        nextCursor = null;
      } else {
        const page = await DataSource.fetchPage(cursor);
        demons = page.demons;
        nextCursor = page.nextCursor;
        if (page.total) totalCount = page.total;
      }

      cursor = nextCursor;
      allLoaded = allLoaded.concat(demons);

      if (isFirstPage && demons.length === 0) {
        gridEl.innerHTML = `<div class="empty-state">No levels found${filterQuery ? ` for “${escapeHtml(filterQuery)}”` : ''}.</div>`;
      } else {
        renderCards(demons, { append: !isFirstPage });
      }

      if (matchCount !== null && matchCount > demons.length) {
        showBanner(`Showing the first ${demons.length} of ${matchCount} matches for “${escapeHtml(filterQuery)}” — narrow your search to see the rest.`);
      } else {
        hideBanner();
      }
      loadMoreRow.style.display = cursor ? 'flex' : 'none';
    } catch (err) {
      console.error(err);
      showBanner(
        `Couldn't load the list from <strong>AREDL</strong>: ${escapeHtml(err.message)}` +
        ` — its API shape may differ from what <code>js/api-aredl.js</code> expects; see the notes at the top of that file.`,
        true
      );
      if (allLoaded.length === 0) gridEl.innerHTML = '';
      loadMoreRow.style.display = 'none';
    } finally {
      loading = false;
      loadMoreBtn.disabled = false;
      loadMoreBtn.textContent = 'Load more';
    }
  }

  function startLoadingFrom(initialCursor) {
    cursor = initialCursor;
    allLoaded = [];
    gridEl.innerHTML = skeletonCards(8);
    hideBanner();
    loadPage(true);
  }

  function resetAndLoad() { startLoadingFrom(null); }

  loadMoreBtn.addEventListener('click', () => loadPage(false));

  resetAndLoad();
})();
