/* =====================================================================
   HOME PAGE CONTROLLER

   The site's actual landing page — intro, a "View the list" CTA, two
   spotlight cards (current #1, a featured level that rotates daily),
   a recent-changes panel pulled live from AREDL's own changelog, and a
   Roulette teaser. Reuses js/list.js's card visuals (.demon-card and
   friends, css/list.css) rather than inventing new card CSS, since
   these are the same kind of object shown the same way there.
   ===================================================================== */

(() => {
  const totalEl = document.getElementById('home-stat-total');
  const changesCountEl = document.getElementById('home-stat-changes');
  const topBody = document.getElementById('spotlight-top-body');
  const featuredBody = document.getElementById('spotlight-featured-body');
  const featuredDateEl = document.getElementById('spotlight-featured-date');
  const changesList = document.getElementById('home-changes-list');

  if (featuredDateEl) featuredDateEl.textContent = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });

  // Purely decorative (a "NEW" badge, see spotlightCardHtml() below) —
  // fired in parallel with everything else rather than awaited, so a
  // slow or failed changelog fetch never delays the spotlights.
  let newLevelIds = new Set();
  const newLevelIdsReady = AredlAPI.fetchNewLevelIds().then(ids => { newLevelIds = ids; }).catch(() => {});

  /** YYYY-M-D for the viewer's own local calendar date, offset by `offsetDays` (negative = past). */
  function localDateString(offsetDays = 0) {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  }

  /** String -> 32-bit int, just to turn a date string into a PRNG seed below — not the source of randomness itself, so its own distribution quality doesn't matter. */
  function hashString(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
    return hash;
  }

  /** mulberry32 (public domain) — a small, fast PRNG with a genuinely uniform output distribution, unlike a raw hash%n which carries a little modulo bias. Same seed always produces the same first value, which is exactly what "deterministic but looks like real dice" needs. */
  function mulberry32(seed) {
    let t = seed >>> 0;
    return function next() {
      t = (t + 0x6D2B79F5) | 0;
      let x = Math.imul(t ^ (t >>> 15), 1 | t);
      x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** A uniform [0, count) pick, deterministic for a given date string — every level in range has an equal 1/count shot, same as if it were freshly rolled that day. */
  function randomIndexForDate(dateStr, count) {
    return Math.floor(mulberry32(hashString(dateStr))() * count);
  }

  /**
   * Same calendar day always picks the same level — a "featured today"
   * that's stable through the day rather than re-rolling on every
   * reload, without needing a server to coordinate it. Seeded by the
   * viewer's own *local* calendar date, not UTC — deliberately: two
   * visitors in the same timezone always see the same pick (there's
   * nothing personal in the seed, just the date), but the rollover
   * itself happens at each visitor's own local midnight, so someone in
   * a timezone that reaches midnight first sees the next pick before
   * someone further west still mid-day. A UTC-based seed would instead
   * roll everyone over in lockstep at one fixed moment worldwide.
   *
   * Deliberately never repeats yesterday's pick, though: two different
   * dates independently rolling the same level is exactly what real 1-
   * in-`count` odds would allow, but it reads as a stuck/broken feature
   * rather than "random" to a visitor who checks two days running.
   * Checked against yesterday's would-be pick (computed the same
   * deterministic way, so this still needs no server state) and nudged
   * forward by one if they'd collide.
   */
  function seededIndexForToday(count) {
    if (count <= 1) return 0;
    const today = randomIndexForDate(localDateString(0), count);
    const yesterday = randomIndexForDate(localDateString(-1), count);
    return today === yesterday ? (today + 1) % count : today;
  }

  async function hydrateIfNeeded(demon) {
    if (!demon.needsExtras) return demon;
    try { return await AredlAPI.fetchExtras(demon.id); }
    catch { return demon; }
  }

  function spotlightCardHtml(demon, entry) {
    const tierColor = positionColor(demon.position, CONFIG.LIST_SIZE);
    // Colors are cached by the *list* thumbnail URL (youTubeThumbnail(), mqdefault) even though
    // the visible image here is the higher-res HQ one below — one shared cache entry per level
    // across list.html/level.html/index.html, see resolveThumbnailColor()'s comment in utils.js.
    const colorCacheKey = demon.videoUrl ? youTubeThumbnail(demon.videoUrl) : demon.thumbnail;
    const cachedColor = colorCacheKey ? getCachedThumbColor(colorCacheKey) : null;
    const color = cachedColor || tierColor;
    // HQ (480x360) instead of the list card's mqdefault (320x180) — these two cards are shown much
    // larger than a grid card, where mqdefault visibly softens.
    const thumb = (demon.videoUrl && youTubeThumbnailHQ(demon.videoUrl)) || demon.thumbnail || 'data:image/svg+xml;utf8,' + encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="360"><rect width="100%" height="100%" fill="#12151f"/></svg>`
    );
    const creatorsList = demon.creators?.length ? demon.creators : [demon.publisher].filter(Boolean);
    const v = entry?.verifier?.viewCount, s = entry?.showcase?.viewCount;
    const vLeads = Number.isFinite(v) && Number.isFinite(s) && v > s;
    const sLeads = Number.isFinite(v) && Number.isFinite(s) && s > v;

    // --tier-color isn't set here — the caller sets it on the enclosing
    // .home-spotlight article instead, so it inherits down to both this
    // card *and* .home-spotlight::before's gradient ring (a CSS custom
    // property set on a descendant can't be read by an ancestor's own
    // pseudo-element, so it has to live on the shared ancestor).
    const html = `
      <a class="demon-card" href="level.html#${demon.position}">
        <div class="card-thumb-wrap">
          <img src="${thumb}" alt="${escapeHtml(demon.name)} thumbnail" loading="lazy" crossorigin="anonymous" onerror="this.style.opacity=0">
          <span class="card-rank">#${demon.position ?? '?'}</span>
          ${demon.videoUrl ? `
          <span class="play-badge" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
          </span>` : ''}
        </div>
        <div class="card-body">
          <div class="card-title">${escapeHtml(demon.name)}${newLevelIds.has(demon.id) ? '<span class="new-badge">New</span>' : ''}</div>
          <div class="card-meta"><span><strong>By</strong> ${escapeHtml(joinNames(creatorsList))}</span></div>
        </div>
        <div class="card-body" style="padding-top:0;">
          <div class="view-compare">
            <div class="view-stat verifier${vLeads ? ' leader' : ''}">
              <span class="dot"></span>
              <span class="stat-text"><span class="stat-label">Verifier vid</span><span class="stat-value${Number.isFinite(v) ? '' : ' na'}">${Number.isFinite(v) ? formatCount(v) : 'Not cached yet'}</span></span>
            </div>
            <div class="view-stat showcase${sLeads ? ' leader' : ''}">
              <span class="dot"></span>
              <span class="stat-text"><span class="stat-label">Top showcase</span><span class="stat-value${Number.isFinite(s) ? '' : ' na'}">${Number.isFinite(s) ? formatCount(s) : 'Not cached yet'}</span></span>
            </div>
          </div>
        </div>
      </a>
    `;
    return { html, color };
  }

  async function loadSpotlights(demons) {
    const top = demons[0];
    const featuredIndex = demons.length > 1 ? 1 + seededIndexForToday(demons.length - 1) : 0;
    const featured = demons[featuredIndex] || top;

    const [topFull, featuredFull] = await Promise.all([hydrateIfNeeded(top), hydrateIfNeeded(featured)]);
    const [topEntry, featuredEntry] = await Promise.all([
      SharedYtCache.getEntry(topFull.id).catch(() => undefined),
      SharedYtCache.getEntry(featuredFull.id).catch(() => undefined),
    ]);

    if (topBody) {
      const { html, color } = spotlightCardHtml(topFull, topEntry);
      topBody.innerHTML = html;
      topBody.parentElement.style.setProperty('--tier-color', color);
      wireCardColor(topBody, topFull);
    }
    if (featuredBody) {
      const { html, color } = spotlightCardHtml(featuredFull, featuredEntry);
      featuredBody.innerHTML = html;
      featuredBody.parentElement.style.setProperty('--tier-color', color);
      wireCardColor(featuredBody, featuredFull);
    }
  }

  /** Live dominant-color extraction for a spotlight card once its thumbnail decodes — spotlightCardHtml() above only applies an *already-cached* color synchronously; this is what populates that cache in the first place (or upgrades the gradient fallback once it resolves), same as js/list.js's hydrateCards() does per card. Set on the enclosing .home-spotlight (see loadSpotlights above), not the card itself. */
  function wireCardColor(container, demon) {
    const img = container.querySelector('img');
    if (!img || !demon.videoUrl) return;
    resolveThumbnailColor(img, color => { if (color) container.parentElement.style.setProperty('--tier-color', color); }, youTubeThumbnail(demon.videoUrl));
  }

  // --- recent changes (AREDL changelog, filtered to top-150-affecting entries — see AredlAPI.fetchChangelog) ---

  const CHANGE_META = {
    Placed:        { label: 'New' },
    Raised:        { label: 'Up' },
    Lowered:       { label: 'Down' },
    Swapped:       { label: 'Swap' },
    MovedToLegacy: { label: 'Legacy' },
  };

  function describeChangelogEntry(entry) {
    const [type, v] = Object.entries(entry.action || {})[0] || [null, {}];
    const name = entry.affected_level?.name || 'Unknown level';
    const meta = CHANGE_META[type] || { label: type || 'Change' };
    let text, position;
    switch (type) {
      case 'Placed':
        text = `${name} placed at #${v.new_position}`;
        position = v.new_position;
        break;
      case 'Raised':
        text = `${name} rose to #${v.new_position} (was #${v.old_position})`;
        position = v.new_position;
        break;
      case 'Lowered':
        text = `${name} fell to #${v.new_position} (was #${v.old_position})`;
        position = v.new_position;
        break;
      case 'Swapped': {
        const otherName = entry.level_above?.name === name ? entry.level_below?.name : entry.level_above?.name;
        text = `${name} swapped with ${otherName || 'another level'} around #${v.upper_position}`;
        position = v.upper_position;
        break;
      }
      case 'MovedToLegacy':
        text = `${name} dropped out of the top ${CONFIG.LIST_SIZE} to legacy (was #${v.old_position})`;
        position = v.old_position <= CONFIG.LIST_SIZE ? v.old_position : null;
        break;
      default:
        text = `${name}: ${type}`;
        position = null;
    }
    return { label: meta.label, text, position, id: entry.affected_level?.id, createdAt: entry.created_at };
  }

  function changeRowHtml(entry) {
    const d = describeChangelogEntry(entry);
    const inner = `
      <span class="home-change-badge home-change-${d.label.toLowerCase()}">${escapeHtml(d.label)}</span>
      <span class="home-change-text">${escapeHtml(d.text)}</span>
      <span class="home-change-time">${escapeHtml(timeAgo(d.createdAt))}</span>
    `;
    // Linked by id, not d.position: a changelog entry's position is a snapshot from
    // whenever that change happened, and any insertion/removal above it since then
    // shifts what's actually sitting at that rank *now* — level.html#N would land on
    // whichever level has since slid into the slot, not the one this entry is about.
    // See level.html#id=<uuid> routing in js/detail.js.
    return d.id
      ? `<li><a class="home-change-row" href="level.html#id=${encodeURIComponent(d.id)}">${inner}</a></li>`
      : `<li><span class="home-change-row">${inner}</span></li>`;
  }

  async function loadChanges() {
    if (!changesList) return;
    try {
      const entries = await AredlAPI.fetchChangelog({ maxResults: 8 });
      if (!entries.length) {
        changesList.innerHTML = `<li class="chart-empty">No recent changes in the top ${CONFIG.LIST_SIZE}.</li>`;
        if (changesCountEl) changesCountEl.textContent = '0';
        return;
      }
      changesList.innerHTML = entries.map(changeRowHtml).join('');
      if (changesCountEl) changesCountEl.textContent = String(entries.length);
    } catch (err) {
      changesList.innerHTML = `<li class="chart-empty">Couldn't load recent changes: ${escapeHtml(err.message)}</li>`;
    }
  }

  async function init() {
    try {
      const [{ demons, total }] = await Promise.all([
        AredlAPI.fetchListed({ limit: CONFIG.LIST_SIZE, offset: 0 }),
        SharedYtCache.load().catch(() => null),
        newLevelIdsReady, // spotlightCardHtml() reads newLevelIds synchronously — only rendered once, unlike list.js's cards, so this needs to actually be ready first rather than just eventually resolving
      ]);
      if (totalEl) totalEl.textContent = String(total ?? demons.length);
      await loadSpotlights(demons);
    } catch (err) {
      if (topBody) topBody.innerHTML = `<div class="chart-empty">Couldn't load: ${escapeHtml(err.message)}</div>`;
    }
    loadChanges();
  }

  init();
})();
