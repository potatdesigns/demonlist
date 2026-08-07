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
    observeAllCards();
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

    return `
      <article class="demon-card" style="--tier-color: ${tierColorVar(tier)}" data-video="${escapeHtml(demon.videoUrl || '')}" data-name="${escapeHtml(demon.name)}">
        <a class="card-link" href="${detailUrl}">
          <div class="card-thumb-wrap">
            <img src="${thumb}" alt="${escapeHtml(demon.name)} thumbnail" loading="lazy" onerror="this.style.opacity=0">
            <span class="card-rank">#${demon.position ?? '?'}</span>
          </div>
          <div class="card-body">
            <div class="card-title">${escapeHtml(demon.name)}</div>
            <div class="card-meta">
              <span><strong>By</strong> ${escapeHtml(joinNames(demon.creators.length ? demon.creators : [demon.publisher].filter(Boolean)))}</span>
              <span><strong>Verified by</strong> ${escapeHtml(demon.verifier?.name || 'Unknown')} <span class="mono" style="color:var(--text-dim)">· req ${reqLabel}</span></span>
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

  // --- lazy view-count loading, only for cards currently visible ---
  let observer = null;
  function observeAllCards() {
    if (!observer) {
      observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            loadViewCounts(entry.target);
            observer.unobserve(entry.target);
          }
        });
      }, { rootMargin: '200px' });
    }
    gridEl.querySelectorAll('.demon-card:not([data-observed])').forEach(card => {
      card.setAttribute('data-observed', '1');
      observer.observe(card);
    });
  }

  async function loadViewCounts(card) {
    const verifierStat = card.querySelector('[data-role="verifier-stat"]');
    const showcaseStat = card.querySelector('[data-role="showcase-stat"]');
    const verifierVal = verifierStat.querySelector('.stat-value');
    const showcaseVal = showcaseStat.querySelector('.stat-value');
    const videoUrl = card.dataset.video;
    const name = card.dataset.name;

    if (!YouTube.hasKey()) {
      verifierVal.textContent = 'Add key';
      showcaseVal.textContent = 'Add key';
      verifierVal.classList.add('na');
      showcaseVal.classList.add('na');
      [verifierStat, showcaseStat].forEach(el => {
        el.style.cursor = 'pointer';
        el.title = 'Click to add a YouTube API key';
        el.addEventListener('click', () => YtKeyUI.openModal(observeAllCards), { once: true });
      });
      return;
    }

    try {
      const [verifierStats, showcase] = await Promise.all([
        videoUrl ? YouTube.getVideoStats(videoUrl).catch(() => null) : Promise.resolve(null),
        name ? YouTube.findBestShowcase(name).catch(() => null) : Promise.resolve(null),
      ]);
      const vViews = verifierStats?.viewCount ?? null;
      const sViews = showcase?.viewCount ?? null;

      verifierVal.textContent = vViews !== null ? formatCount(vViews) : 'N/A';
      showcaseVal.textContent = sViews !== null ? formatCount(sViews) : 'N/A';
      verifierVal.classList.remove('loading');
      showcaseVal.classList.remove('loading');
      if (vViews === null) verifierVal.classList.add('na');
      if (sViews === null) showcaseVal.classList.add('na');

      if (vViews !== null && sViews !== null) {
        if (vViews > sViews) verifierStat.classList.add('leader');
        else if (sViews > vViews) showcaseStat.classList.add('leader');
      }
    } catch (e) {
      verifierVal.textContent = 'Error';
      showcaseVal.textContent = 'Error';
    }
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
