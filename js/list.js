/* =====================================================================
   LIST PAGE CONTROLLER
   ===================================================================== */

(() => {
  const gridEl = document.getElementById('demon-grid');
  const loadMoreRow = document.getElementById('load-more-row');
  const loadMoreBtn = document.getElementById('load-more-btn');
  const searchInput = document.getElementById('search-input');
  const stateBanner = document.getElementById('state-banner');
  const sourceButtons = document.querySelectorAll('.source-toggle button');
  const headerActions = document.getElementById('header-actions');

  let currentSource = getSource();
  let cursor = null;
  let allLoaded = [];       // demons loaded so far, in order
  let filterQuery = '';
  let loading = false;

  YtKeyUI.mountKeyButton(headerActions, () => {
    // key just saved — (re)try loading counts for cards already on screen
    // that came up empty ("Add key"/N/A) the first time around
    const stale = [...gridEl.querySelectorAll('.demon-card')].filter(c => c.querySelector('.stat-value.na'));
    if (stale.length) hydrateCards(stale);
    observeAllCards(); // and observe anything not yet seen, as before
  });

  sourceButtons.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.source === currentSource);
    btn.addEventListener('click', () => {
      if (btn.dataset.source === currentSource) return;
      currentSource = btn.dataset.source;
      setSource(currentSource);
      sourceButtons.forEach(b => b.classList.toggle('active', b === btn));
      resetAndLoad();
    });
  });

  searchInput.addEventListener('input', debounce((e) => {
    filterQuery = e.target.value.trim();
    resetAndLoad();
  }, 350));

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
    const tier = tierFromRequirement(demon.requirement);
    const thumb = demon.thumbnail || 'data:image/svg+xml;utf8,' + encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="100%" height="100%" fill="#12151f"/></svg>`
    );
    const detailUrl = `level.html?source=${demon.source}&id=${encodeURIComponent(demon.id)}`;
    const reqLabel = demon.requirement !== null ? `${demon.requirement}%` : '—';
    const byNames = joinNames(demon.creators.length ? demon.creators : [demon.publisher].filter(Boolean));

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
              <span><strong>Verified by</strong> <span data-role="verifier-name">${escapeHtml(demon.verifier?.name || (demon.needsExtras ? '…' : 'Unknown'))}</span> <span class="mono" style="color:var(--text-dim)">· req ${reqLabel}</span></span>
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

      const verifierEl = card.querySelector('[data-role="verifier-name"]');
      if (verifierEl) verifierEl.textContent = demon.verifier?.name || 'Unknown';
    } catch (e) {
      card.dataset.needsExtras = '0'; // don't retry forever on failure
      const verifierEl = card.querySelector('[data-role="verifier-name"]');
      if (verifierEl && verifierEl.textContent === '…') verifierEl.textContent = 'Unknown';
    }
  }

  function markNeedsKey(card) {
    const verifierStat = card.querySelector('[data-role="verifier-stat"]');
    const showcaseStat = card.querySelector('[data-role="showcase-stat"]');
    [verifierStat, showcaseStat].forEach(el => {
      const val = el.querySelector('.stat-value');
      val.textContent = 'Add key';
      val.classList.remove('loading');
      val.classList.add('na');
      el.style.cursor = 'pointer';
      el.title = 'Click to add a YouTube API key';
      el.addEventListener('click', () => YtKeyUI.openModal(() => hydrateCards([card])), { once: true });
    });
  }

  function clearNeedsKeyAffordance(card) {
    card.querySelectorAll('[data-role="verifier-stat"], [data-role="showcase-stat"]').forEach(el => {
      el.style.cursor = '';
      el.removeAttribute('title');
    });
  }

  async function applyStatsAndShowcase(card, verifierStats) {
    const verifierStat = card.querySelector('[data-role="verifier-stat"]');
    const showcaseStat = card.querySelector('[data-role="showcase-stat"]');
    const verifierVal = verifierStat.querySelector('.stat-value');
    const showcaseVal = showcaseStat.querySelector('.stat-value');
    const name = card.dataset.name;
    const levelId = card.dataset.levelId || null;

    const vViews = verifierStats?.viewCount ?? null;
    verifierVal.textContent = vViews !== null ? formatCount(vViews) : 'N/A';
    verifierVal.classList.remove('loading', 'na');
    if (vViews === null) verifierVal.classList.add('na');

    let sViews = null;
    try {
      const showcase = name ? await YouTube.findBestShowcase(name, levelId) : null;
      sViews = showcase?.viewCount ?? null;
    } catch { /* leave sViews null — surfaced as N/A below */ }

    showcaseVal.textContent = sViews !== null ? formatCount(sViews) : 'N/A';
    showcaseVal.classList.remove('loading', 'na');
    if (sViews === null) showcaseVal.classList.add('na');

    verifierStat.classList.remove('leader');
    showcaseStat.classList.remove('leader');
    if (vViews !== null && sViews !== null) {
      if (vViews > sViews) verifierStat.classList.add('leader');
      else if (sViews > vViews) showcaseStat.classList.add('leader');
    }
  }

  /** Hydrate a batch of cards that just became visible: AREDL extras first (own API, no quota cost), then one batched YouTube stats call for all of them. */
  async function hydrateCards(cards) {
    await Promise.all(cards.map(hydrateAredlExtrasIfNeeded));

    if (!YouTube.hasKey()) {
      cards.forEach(markNeedsKey);
      return;
    }

    cards.forEach(clearNeedsKeyAffordance);

    const videoUrls = cards.map(c => c.dataset.video || null);
    let statsResults;
    try {
      statsResults = await YouTube.getVideoStatsBatch(videoUrls);
    } catch (e) {
      statsResults = cards.map(() => null);
    }

    await Promise.all(cards.map((card, i) => applyStatsAndShowcase(card, statsResults[i])));
  }

  // --- data loading ---
  async function loadPage(isFirstPage) {
    if (loading) return;
    loading = true;
    loadMoreBtn.disabled = true;
    loadMoreBtn.textContent = 'Loading…';

    try {
      let demons, nextCursor;
      if (filterQuery && currentSource === 'pointercrate') {
        demons = await PointercrateAPI.searchByName(filterQuery);
        nextCursor = null;
      } else {
        const page = await DataSource.fetchPage(currentSource, cursor);
        demons = page.demons;
        nextCursor = page.nextCursor;
        if (filterQuery) {
          demons = demons.filter(d => d.name.toLowerCase().includes(filterQuery.toLowerCase()));
        }
      }

      cursor = nextCursor;
      allLoaded = allLoaded.concat(demons);

      if (isFirstPage && demons.length === 0) {
        gridEl.innerHTML = `<div class="empty-state">No levels found${filterQuery ? ` for “${escapeHtml(filterQuery)}”` : ''}.</div>`;
      } else {
        renderCards(demons, { append: !isFirstPage });
      }

      hideBanner();
      loadMoreRow.style.display = cursor ? 'flex' : 'none';
    } catch (err) {
      console.error(err);
      showBanner(
        `Couldn't load the list from <strong>${currentSource === 'aredl' ? 'AREDL' : 'Pointercrate'}</strong>: ${escapeHtml(err.message)}` +
        (currentSource === 'aredl' ? ` — AREDL's API shape may differ from what <code>js/api-aredl.js</code> expects; see the notes at the top of that file.` : ''),
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

  function resetAndLoad() {
    cursor = null;
    allLoaded = [];
    gridEl.innerHTML = skeletonCards(8);
    hideBanner();
    loadPage(true);
  }

  loadMoreBtn.addEventListener('click', () => loadPage(false));

  resetAndLoad();
})();
