/* =====================================================================
   DETAIL PAGE CONTROLLER
   ===================================================================== */

(() => {
  const root = document.getElementById('detail-root');

  // The URL is normally a level's rank as a bare hash fragment —
  // level.html#42, no question mark and no long AREDL id (see
  // cardTemplate()'s detailUrl in list.js, and writeUrlState()'s doc
  // comment in list.js for why hash over a query string). Resolved to
  // the actual AREDL id via AredlAPI.getIdByPosition() below before
  // fetching anything.
  //
  // The other form, level.html#id=<uuid>, resolves straight to that id
  // instead of going through a position at all — used anywhere a link is
  // built from *historical* data whose recorded position can drift out
  // from under it, namely js/home.js's recent-changes panel: a changelog
  // entry's position is a snapshot from whenever that change happened,
  // and every level insertion/removal above it since then shifts what's
  // actually sitting at that rank *now*. A bare #N link there would send
  // you to whichever level has since slid into that slot, not the one
  // the entry was actually about. Ids don't drift.
  function getRouteParam() {
    const raw = window.location.hash.replace(/^#/, '');
    if (!raw) return null;
    if (raw.startsWith('id=')) return { type: 'id', value: decodeURIComponent(raw.slice(3)) };
    const key = [...new URLSearchParams(raw).keys()][0];
    return key ? { type: 'position', value: key } : null;
  }

  init();
  // Prev/Next (both the <a href="level.html#N"> links and the
  // ArrowLeft/ArrowRight handler below) change only the hash while
  // already on level.html — same-document navigation, not a reload, so
  // nothing would re-run init() without this. Same reasoning list.js's
  // own hashchange/popstate listeners give for the exact same pattern.
  window.addEventListener('popstate', init);
  window.addEventListener('hashchange', init);

  async function init() {
    const route = getRouteParam();
    if (!route) {
      root.innerHTML = `<div class="state-banner error">No level given. Go back to the <a href="list.html">list</a> and click a card.</div>`;
      return;
    }
    root.innerHTML = skeletonDetail();
    try {
      let id;
      if (route.type === 'id') {
        id = route.value;
      } else {
        const position = parseInt(route.value, 10);
        if (!Number.isFinite(position) || position <= 0) {
          throw new Error(`"${route.value}" isn't a valid rank.`);
        }
        id = await AredlAPI.getIdByPosition(position);
        if (!id) throw new Error(`No level at rank #${position}.`);
      }

      const [demon, totalCount, sharedEntry] = await Promise.all([
        DataSource.fetchOne(id),
        AredlAPI.getTotalCount().catch(() => 0),
        SharedYtCache.getEntry(id).catch(() => undefined),
      ]);
      if (!demon) throw new Error(route.type === 'id' ? `No level with that id.` : `No level at that rank.`);

      // An id: route did its job (immune to the position drift getRouteParam()'s doc comment
      // above describes) the moment it resolved — once we know the level's actual position, swap
      // the visible URL to the short, shareable #N form everything else on the site uses. replaceState
      // doesn't fire hashchange/popstate, so this doesn't re-trigger init() in a loop.
      if (route.type === 'id' && Number.isFinite(demon.position)) {
        history.replaceState(null, '', `${window.location.pathname}#${demon.position}`);
      }

      // Prev/Next always come from the level's own resolved position, never route.value —
      // for an id: route that's the only place a position exists at all, and for a #N route
      // it keeps prev/next correct even if position and demon disagreed somehow.
      const [prevLevel, nextLevel] = await Promise.all([
        AredlAPI.getByPosition(demon.position - 1).catch(() => null),
        AredlAPI.getByPosition(demon.position + 1).catch(() => null),
      ]);
      renderDetail(demon, totalCount, sharedEntry, prevLevel, nextLevel);
    } catch (err) {
      console.error(err);
      root.innerHTML = `
        <div class="state-banner error">Couldn't load this level: ${escapeHtml(err.message)}</div>
        <a class="back-link" href="list.html">&larr; Back to the list</a>
      `;
    }
  }

  function skeletonDetail() {
    return `
      <a class="back-link" href="list.html">&larr; Back to the list</a>
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

  // Set by renderDetail(), read by the ArrowLeft/ArrowRight handler
  // below — module-level so the listener (registered once, outside
  // renderDetail) always sees whatever the *current* level's neighbors
  // are, not whatever they were when the listener was first attached.
  let prevPosition = null, nextPosition = null;

  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    if (/^(input|textarea|select)$/i.test(e.target.tagName) || e.target.isContentEditable) return;
    if (e.key === 'ArrowLeft' && prevPosition !== null) window.location.href = `level.html#${prevPosition}`;
    else if (e.key === 'ArrowRight' && nextPosition !== null) window.location.href = `level.html#${nextPosition}`;
  });

  function navButton(dir, position, level) {
    if (!level) return `<span class="detail-nav-btn disabled ${dir}"><span class="nav-arrow">${dir === 'prev' ? '&larr;' : '&rarr;'}</span><span class="nav-info"><span class="nav-label">${dir === 'prev' ? 'Previous' : 'Next'}</span></span></span>`;
    const info = `<span class="nav-info"><span class="nav-label">${dir === 'prev' ? 'Previous' : 'Next'}</span><span class="nav-name">#${position} ${escapeHtml(level.name)}</span></span>`;
    const arrow = `<span class="nav-arrow">${dir === 'prev' ? '&larr;' : '&rarr;'}</span>`;
    const targetAttrs = Settings.get('openInNewTab') ? ' target="_blank" rel="noopener"' : '';
    return `<a class="detail-nav-btn ${dir}" href="level.html#${position}"${targetAttrs}>${dir === 'prev' ? arrow + info : info + arrow}</a>`;
  }

  /** Chips for every creator, unless there are a lot of them (some collabs run into the dozens) — past MAX, the rest collapse into one "+N more" chip with the full remaining names as its hover title, rather than every card wrapping into a wall of chips. Each chip links to that person's other levels (list.html#q=<name>, see profileLink() in js/utils.js) — the "+N more" overflow chip doesn't, since it isn't any one person. */
  function creatorsChipsHtml(list, max = 8) {
    if (!list.length) return '';
    const shown = list.slice(0, max).map(c => `<a class="chip profile-link" href="${profileLink(c.name)}">${escapeHtml(c.name)}</a>`).join('');
    const rest = list.slice(max);
    if (!rest.length) return shown;
    const restNames = rest.map(c => c.name).join(', ');
    return `${shown}<span class="chip chip-more" title="${escapeHtml(restNames)}">+${rest.length} more</span>`;
  }

  function renderDetail(demon, totalCount, sharedEntry, prevLevel, nextLevel) {
    // Shares its cache entry with js/list.js's cards (same key: youTubeThumbnail's
    // mqdefault URL) even though mountDetailBackground() below samples a different,
    // higher-res image for the actual extraction — see resolveThumbnailColor()'s
    // comment in js/utils.js.
    const thumbCacheKey = youTubeThumbnail(demon.videoUrl);
    const cachedColor = thumbCacheKey ? getCachedThumbColor(thumbCacheKey) : null;
    const tierColor = cachedColor || positionColor(demon.position, totalCount);
    const badgeColor = badgeColorFor(tierColor);
    const badgeColorOn = contrastTextColor(badgeColor);
    document.title = `Demonlist | ${demon.name}`;
    prevPosition = prevLevel ? demon.position - 1 : null;
    nextPosition = nextLevel ? demon.position + 1 : null;

    root.innerHTML = `
      <a class="back-link" href="list.html">&larr; Back to the list</a>

      <div class="detail-head">
        <div class="detail-rank" style="--tier-color:${tierColor}">#${demon.position ?? '?'}<span>RANK</span></div>
        <div class="detail-titles">
          <h1>${escapeHtml(demon.name)}<span id="detail-new-badge"></span></h1>
        </div>
        <button type="button" class="detail-complete-toggle" id="detail-complete-toggle" aria-pressed="${Completion.isDone(demon.id)}">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
          <span>${Completion.isDone(demon.id) ? 'Beaten' : 'Mark as beaten'}</span>
        </button>
      </div>

      <div class="detail-pagenav">
        ${navButton('prev', prevPosition, prevLevel)}
        ${navButton('next', nextPosition, nextLevel)}
      </div>

      <dl class="detail-facts">
        <div class="fact"><dt>List ID</dt><dd>${escapeHtml(String(demon.id))}</dd></div>
        <div class="fact"><dt>GD Level ID</dt><dd>${demon.levelId ? escapeHtml(String(demon.levelId)) : '—'}</dd></div>
        <div class="fact"><dt>Verifier</dt><dd>${demon.verifier?.name ? `<a class="profile-link" href="${profileLink(demon.verifier.name)}">${escapeHtml(demon.verifier.name)}</a>` : 'Unknown'}</dd></div>
        <div class="fact"><dt>Publisher</dt><dd>${demon.publisher?.name ? `<a class="profile-link" href="${profileLink(demon.publisher.name)}">${escapeHtml(demon.publisher.name)}</a>` : 'Unknown'}</dd></div>
        <div class="fact" style="grid-column: span 2;">
          <dt>Creator${demon.creators.length !== 1 ? 's' : ''}</dt>
          <dd class="creators-list">
            ${creatorsChipsHtml(demon.creators.length ? demon.creators : [demon.publisher].filter(Boolean)) || '—'}
          </dd>
        </div>
      </dl>

      <div class="video-section-head">
        <h2>Verification vs. showcase</h2>
        <div class="video-section-actions">
          <span class="eyebrow">view counts, side by side</span>
          <div id="level-refresh-actions"></div>
        </div>
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

      <div class="video-section-head">
        <h2>Position history</h2>
        <span class="eyebrow">past #${CONFIG.LIST_SIZE} is legacy</span>
      </div>
      <ul class="position-history-list" id="position-history-list">
        <li class="chart-empty">Loading…</li>
      </ul>
    `;

    mountPositionHistory(demon);
    mountVerifierVideo(demon, sharedEntry);
    mountShowcaseVideo(demon, sharedEntry);
    CacheAdminUI.mountLevelRefreshButton(document.getElementById('level-refresh-actions'), demon.id);
    mountDetailBackground(demon.videoUrl);
    mountCompletionToggle(demon.id);

    // Placed into the top CONFIG.LIST_SIZE within the last week — see
    // AredlAPI.fetchNewLevelIds(). Fired off rather than awaited, same
    // as list.js's own use of this: purely decorative, never worth
    // delaying or failing the rest of the page over.
    AredlAPI.fetchNewLevelIds().then(ids => {
      const badge = document.getElementById('detail-new-badge');
      if (badge && ids.has(demon.id)) badge.innerHTML = `<span class="new-badge" style="--badge-color:${badgeColor};--badge-color-on:${badgeColorOn}">New</span>`;
    }).catch(() => {});
  }

  /**
   * Ambient background: the verification video's own YouTube thumbnail,
   * blurred (see .detail-bg in css/detail.css) — the closest thing to "a
   * picture of this level" available at all, since AREDL doesn't host
   * level screenshots and there's no client-side YouTube API access (see
   * README's "Shared showcase/view-count cache"). Tries maxresdefault
   * first (1280x720) for quality; YouTube serves that as a real image
   * only for videos it was generated for, otherwise silently returns a
   * small gray placeholder *with a 200*, not a 404 — so this checks the
   * loaded image's actual width rather than relying on `onerror`, and
   * falls back to hqdefault (480x360, effectively always present) when
   * the "high-res" one turns out to be that placeholder.
   */
  function mountDetailBackground(videoUrl) {
    const bgEl = document.getElementById('detail-bg');
    const vid = extractYouTubeId(videoUrl);
    if (!bgEl || !vid) return;

    const maxres = `https://i.ytimg.com/vi/${vid}/maxresdefault.jpg`;
    const fallback = `https://i.ytimg.com/vi/${vid}/hqdefault.jpg`;

    // crossOrigin doesn't affect its use as a CSS background-image below —
    // set purely so the same already-fetched probe can also feed
    // resolveThumbnailColor()'s canvas read without a second request.
    const probe = new Image();
    probe.crossOrigin = 'anonymous';
    const upgradeRankColor = () => {
      const rankEl = document.querySelector('.detail-rank');
      const badgeEl = document.querySelector('#detail-new-badge .new-badge');
      const cacheKey = youTubeThumbnail(videoUrl); // shared with js/list.js's cards — see resolveThumbnailColor()'s comment
      resolveThumbnailColor(probe, color => {
        if (!color) return;
        if (rankEl) rankEl.style.setProperty('--tier-color', color);
        if (badgeEl) {
          const badge = badgeColorFor(color);
          badgeEl.style.setProperty('--badge-color', badge);
          badgeEl.style.setProperty('--badge-color-on', contrastTextColor(badge));
        }
      }, cacheKey);
    };
    probe.onload = () => {
      const url = probe.naturalWidth > 200 ? maxres : fallback;
      bgEl.style.backgroundImage = `url("${url}")`;
      requestAnimationFrame(() => bgEl.classList.add('visible'));
      upgradeRankColor();
    };
    probe.onerror = () => {
      bgEl.style.backgroundImage = `url("${fallback}")`;
      requestAnimationFrame(() => bgEl.classList.add('visible'));
    };
    probe.src = maxres;
  }

  /** Wires up the "Mark as beaten" toggle in .detail-head — see js/completion.js. Its initial pressed state/label was already baked into renderDetail()'s template; this just handles the click. */
  function mountCompletionToggle(levelId) {
    const btn = document.getElementById('detail-complete-toggle');
    if (!btn) return;
    btn.addEventListener('click', () => {
      Completion.toggle(levelId);
      const done = Completion.isDone(levelId);
      btn.setAttribute('aria-pressed', String(done));
      btn.querySelector('span').textContent = done ? 'Beaten' : 'Mark as beaten';
    });
  }

  /**
   * Past AREDL position changes for this level — data/position-history.json
   * (js/position-history.js), built by scripts/refresh-aredl-cache.mjs:
   * one entry per actual change, not one per refresh, so this is a real
   * "here's what happened" log rather than a daily snapshot. Rendered
   * newest-first with a ↑/↓ against the *previous* (older) entry — lower
   * position number is a rise, same direction the changelog's own
   * "Raised"/"Lowered" use. Anything past CONFIG.LIST_SIZE reads as
   * "Legacy" rather than a raw AREDL position number, which wouldn't
   * mean much in a site that only ranks the top CONFIG.LIST_SIZE itself.
   */
  async function mountPositionHistory(demon) {
    const listEl = document.getElementById('position-history-list');
    if (!listEl || typeof PositionHistory === 'undefined') return;
    try {
      const entries = await PositionHistory.getEntries(demon.id);
      if (!entries.length) {
        listEl.innerHTML = `<li class="chart-empty">No recorded movement yet — history only tracks changes since this level was first cached.</li>`;
        return;
      }
      const newestFirst = entries.slice().reverse();
      listEl.innerHTML = newestFirst.map((entry, i) => {
        const older = newestFirst[i + 1]; // one entry *older* than this one, since the array is newest-first
        let deltaIcon = '–', deltaClass = 'first';
        if (older) {
          if (entry.position < older.position) { deltaIcon = '&uarr;'; deltaClass = 'up'; }
          else if (entry.position > older.position) { deltaIcon = '&darr;'; deltaClass = 'down'; }
          else { deltaIcon = '•'; deltaClass = 'same'; }
        }
        const label = entry.position <= CONFIG.LIST_SIZE ? `#${entry.position}` : 'Legacy';
        const dateLabel = new Date(entry.date).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
        const reasonHtml = entry.reason ? `<span class="position-history-reason">${escapeHtml(entry.reason)}</span>` : '';
        return `
          <li class="position-history-row">
            <span class="position-history-delta ${deltaClass}">${deltaIcon}</span>
            <div class="position-history-main">
              <span class="position-history-label">${escapeHtml(label)}</span>
              ${reasonHtml}
            </div>
            <span class="position-history-date">${escapeHtml(dateLabel)}</span>
          </li>
        `;
      }).join('');
    } catch {
      listEl.innerHTML = `<li class="chart-empty">Couldn't load position history.</li>`;
    }
  }

  /** Autoplay is opt-in (Settings.get('autoplayVideos')) and always paired with mute=1 — browsers block unmuted autoplay outright regardless, so a silent "autoplay" that isn't muted just wouldn't play at all. */
  function embedIframe(container, videoId, title) {
    const autoplay = Settings.get('autoplayVideos');
    const src = `https://www.youtube.com/embed/${videoId}${autoplay ? '?autoplay=1&mute=1' : ''}`;
    container.innerHTML = `<iframe src="${src}" title="${escapeHtml(title)}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen loading="lazy"></iframe>`;
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
