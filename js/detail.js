/* =====================================================================
   DETAIL PAGE CONTROLLER
   ===================================================================== */

(() => {
  const root = document.getElementById('detail-root');

  CacheAdminUI.mountRefreshButton(document.getElementById('header-actions'));

  const id = qs('id');

  if (!id) {
    root.innerHTML = `<div class="state-banner error">No level id given. Go back to the <a href="index.html">list</a> and click a card.</div>`;
    return;
  }

  init();

  async function init() {
    root.innerHTML = skeletonDetail();
    try {
      const [demon, totalCount, sharedEntry] = await Promise.all([
        DataSource.fetchOne(id),
        AredlAPI.getTotalCount().catch(() => 0),
        SharedYtCache.getEntry(id).catch(() => undefined),
      ]);
      renderDetail(demon, totalCount, sharedEntry);
    } catch (err) {
      console.error(err);
      root.innerHTML = `
        <div class="state-banner error">
          Couldn't load this level from <strong>AREDL</strong>: ${escapeHtml(err.message)}
          — see the notes at the top of <code>js/api-aredl.js</code> if the API shape changed.
        </div>
        <a class="back-link" href="index.html">&larr; Back to the list</a>
      `;
    }
  }

  function skeletonDetail() {
    return `
      <a class="back-link" href="index.html">&larr; Back to the list</a>
      <div class="detail-head">
        <div class="skeleton" style="width:74px;height:44px;"></div>
        <div style="flex:1">
          <div class="skeleton" style="width:50%;height:30px;margin-bottom:10px;"></div>
          <div class="skeleton" style="width:30%;height:16px;"></div>
        </div>
      </div>
      <div class="skeleton" style="height:120px;margin-top:24px;"></div>
      <div class="video-compare" style="margin-top:40px;">
        <div class="skeleton" style="aspect-ratio:16/9;"></div>
        <div class="skeleton" style="aspect-ratio:16/9;"></div>
      </div>
    `;
  }

  function renderDetail(demon, totalCount, sharedEntry) {
    const tier = tierFromPosition(demon.position, totalCount);
    const tierColor = tierColorVar(tier);
    const points = demon.raw?.points;
    document.title = `${demon.name} — Demonlist`;

    root.innerHTML = `
      <a class="back-link" href="index.html">&larr; Back to the list</a>

      <div class="detail-head">
        <div class="detail-rank" style="--tier-color:${tierColor}">#${demon.position ?? '?'}<span>RANK</span></div>
        <div class="detail-titles">
          <h1>${escapeHtml(demon.name)}</h1>
          <div class="detail-tags">
            ${Number.isFinite(points) ? `<span class="chip"><span class="swatch" style="background:${tierColor};width:8px;height:8px;border-radius:2px;display:inline-block;"></span>${points} points</span>` : ''}
          </div>
        </div>
      </div>

      <dl class="detail-facts">
        <div class="fact"><dt>List ID</dt><dd>${escapeHtml(String(demon.id))}</dd></div>
        <div class="fact"><dt>GD Level ID</dt><dd>${demon.levelId ? escapeHtml(String(demon.levelId)) : '—'}</dd></div>
        <div class="fact"><dt>Verifier</dt><dd>${escapeHtml(demon.verifier?.name || 'Unknown')}</dd></div>
        <div class="fact"><dt>Publisher</dt><dd>${escapeHtml(demon.publisher?.name || 'Unknown')}</dd></div>
        <div class="fact" style="grid-column: span 2;">
          <dt>Creator${demon.creators.length !== 1 ? 's' : ''}</dt>
          <dd class="creators-list">
            ${(demon.creators.length ? demon.creators : [demon.publisher].filter(Boolean))
              .map(c => `<span class="chip">${escapeHtml(c.name)}</span>`).join('') || '—'}
          </dd>
        </div>
      </dl>

      <div class="video-section-head">
        <h2>Verification vs. showcase</h2>
        <span class="eyebrow">view counts, side by side</span>
      </div>

      <div class="video-compare">
        <div class="video-panel verifier">
          <div class="panel-tag"><span class="dot"></span>Verifier video</div>
          <div class="video-embed" id="verifier-embed"></div>
          <div class="video-info" id="verifier-info">
            <span class="v-title">${escapeHtml(demon.videoUrl ? 'Loading title…' : 'No verification video on file')}</span>
          </div>
        </div>
        <div class="video-panel showcase">
          <div class="panel-tag"><span class="dot"></span>Top showcase</div>
          <div class="video-embed" id="showcase-embed">
            <div class="thumb-fallback">Searching for the highest-viewed showcase…</div>
          </div>
          <div class="video-info" id="showcase-info"></div>
        </div>
      </div>
    `;

    mountVerifierVideo(demon, sharedEntry);
    mountShowcaseVideo(demon, sharedEntry);
  }

  function embedIframe(container, videoId, title) {
    container.innerHTML = `<iframe src="https://www.youtube.com/embed/${videoId}" title="${escapeHtml(title)}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen loading="lazy"></iframe>`;
  }

  /** sharedEntry is the (possibly undefined) data/yt-cache.json entry for this level — see SharedYtCache in js/shared-cache.js. It's the only source for view counts/showcase; there's no personal-key live fallback. */
  function mountVerifierVideo(demon, sharedEntry) {
    const embedEl = document.getElementById('verifier-embed');
    const infoEl = document.getElementById('verifier-info');
    const vid = extractYouTubeId(demon.videoUrl);

    if (!vid) {
      embedEl.innerHTML = `<div class="thumb-fallback">No verification video linked on AREDL.</div>`;
      infoEl.innerHTML = '';
      return;
    }
    embedIframe(embedEl, vid, `${demon.name} — verification`);

    if (!sharedEntry) {
      infoEl.innerHTML = `<span class="v-title">Not in the shared cache yet — check back once the next refresh reaches this level.</span>`;
      return;
    }
    infoEl.innerHTML = sharedEntry.verifier ? videoInfoHtml(sharedEntry.verifier) : `<span class="v-title">Video details unavailable.</span>`;
  }

  function mountShowcaseVideo(demon, sharedEntry) {
    const embedEl = document.getElementById('showcase-embed');
    const infoEl = document.getElementById('showcase-info');

    if (!sharedEntry) {
      const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(demon.name + ' GD showcase')}`;
      embedEl.innerHTML = `<div class="thumb-fallback">Not in the shared cache yet.</div>`;
      infoEl.innerHTML = `<a class="v-channel" href="${searchUrl}" target="_blank" rel="noopener">Search YouTube for "${escapeHtml(demon.name)}" manually &rarr;</a>`;
      return;
    }

    if (!sharedEntry.showcase) {
      embedEl.innerHTML = `<div class="thumb-fallback">No clear showcase video found for this level.</div>`;
      infoEl.innerHTML = '';
      return;
    }

    embedIframe(embedEl, sharedEntry.showcase.id, sharedEntry.showcase.title);
    infoEl.innerHTML = videoInfoHtml(sharedEntry.showcase);
    const verifierViews = getRenderedViewCount('verifier-info');
    if (verifierViews !== null) markWinner('verifier-info', 'showcase-info', verifierViews, sharedEntry.showcase.viewCount);
  }

  function videoInfoHtml(v) {
    return `
      <a class="v-title" href="${v.url}" target="_blank" rel="noopener" title="${escapeHtml(v.title)}">${escapeHtml(v.title)}</a>
      <span class="v-channel">${escapeHtml(v.channel)}</span>
      <span class="v-stats" data-views="${v.viewCount}"><span class="views-num">👁 <b>${formatCount(v.viewCount)}</b> views</span></span>
    `;
  }

  function getRenderedViewCount(infoElId) {
    const el = document.getElementById(infoElId)?.querySelector('.v-stats');
    return el ? parseInt(el.dataset.views, 10) : null;
  }

  function markWinner(verifierInfoId, showcaseInfoId, verifierViews, showcaseViews) {
    const vPanel = document.getElementById(verifierInfoId)?.closest('.video-panel');
    const sPanel = document.getElementById(showcaseInfoId)?.closest('.video-panel');
    if (verifierViews > showcaseViews) vPanel?.querySelector('.views-num')?.classList.add('win');
    else if (showcaseViews > verifierViews) sPanel?.querySelector('.views-num')?.classList.add('win');
  }
})();
