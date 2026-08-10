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
  const changesList = document.getElementById('home-changes-list');
  const rouletteBtn = document.getElementById('home-roulette-btn');

  rouletteBtn?.addEventListener('click', () => Roulette.open());

  /** Same calendar day (UTC) always picks the same level — a "featured today" that's actually stable through the day rather than re-rolling on every reload, without needing a server to coordinate it. */
  function seededIndexForToday(count) {
    const dateStr = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    let hash = 0;
    for (let i = 0; i < dateStr.length; i++) hash = (hash * 31 + dateStr.charCodeAt(i)) >>> 0;
    return hash % count;
  }

  async function hydrateIfNeeded(demon) {
    if (!demon.needsExtras) return demon;
    try { return await AredlAPI.fetchExtras(demon.id); }
    catch { return demon; }
  }

  function spotlightCardHtml(demon, entry) {
    const tierColor = positionColor(demon.position, CONFIG.LIST_SIZE);
    const cachedColor = demon.thumbnail ? getCachedThumbColor(demon.thumbnail) : null;
    const color = cachedColor || tierColor;
    const thumb = demon.thumbnail || 'data:image/svg+xml;utf8,' + encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="100%" height="100%" fill="#12151f"/></svg>`
    );
    const creatorsList = demon.creators?.length ? demon.creators : [demon.publisher].filter(Boolean);
    const v = entry?.verifier?.viewCount, s = entry?.showcase?.viewCount;
    const vLeads = Number.isFinite(v) && Number.isFinite(s) && v > s;
    const sLeads = Number.isFinite(v) && Number.isFinite(s) && s > v;

    return `
      <a class="demon-card" style="--tier-color:${color}" href="level.html#${demon.position}">
        <div class="card-thumb-wrap">
          <img src="${thumb}" alt="${escapeHtml(demon.name)} thumbnail" loading="lazy" crossorigin="anonymous" onerror="this.style.opacity=0">
          <span class="card-rank">#${demon.position ?? '?'}</span>
          ${demon.videoUrl ? `
          <span class="play-badge" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
          </span>` : ''}
        </div>
        <div class="card-body">
          <div class="card-title">${escapeHtml(demon.name)}</div>
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

    if (topBody) topBody.innerHTML = spotlightCardHtml(topFull, topEntry);
    if (featuredBody) featuredBody.innerHTML = spotlightCardHtml(featuredFull, featuredEntry);
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
    return { label: meta.label, text, position, createdAt: entry.created_at };
  }

  function changeRowHtml(entry) {
    const d = describeChangelogEntry(entry);
    const inner = `
      <span class="home-change-badge home-change-${d.label.toLowerCase()}">${escapeHtml(d.label)}</span>
      <span class="home-change-text">${escapeHtml(d.text)}</span>
      <span class="home-change-time">${escapeHtml(timeAgo(d.createdAt))}</span>
    `;
    return Number.isFinite(d.position)
      ? `<li><a class="home-change-row" href="level.html#${d.position}">${inner}</a></li>`
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
