/* =====================================================================
   STATS PAGE CONTROLLER

   Averages, records, and six charts built from the same two sources
   every other page already reads — AredlAPI's cached full list and
   SharedYtCache's whole-cache fetch — aggregated across the tracked
   list instead of shown per-card. No charting library: plain hand-built
   SVG (this site has no build step to bring one in through), following
   the project's dataviz skill — sequential/emphasis color (gray
   verifier vs. orange showcase, the same mapping the list page's legend
   and cards already use, not a new convention, everywhere except the
   channel-share donut, which needs real categorical identity — see its
   own comment on why it deliberately avoids the site's orange), log
   scales (view counts span 4+ orders of magnitude), a hover tooltip on
   every mark with a hit target larger than the mark itself, and a
   "View as table" fallback on every chart with more rows than a legend
   can hold.

   Three filters — range chips (All/Main/Extended), a channel select,
   and a verifier/showcase view-count range panel (the last two shared
   with the list page's own filter UI, see css/base.css) — combine
   (AND) to scope the KPI row and every chart together. See
   filteredDemons() and renderAll().
   ===================================================================== */

(() => {
  const stateBanner = document.getElementById('state-banner');
  const kpiRow = document.getElementById('kpi-row');
  const rangeChipsEl = document.getElementById('stats-range');
  const channelFilterEl = document.getElementById('channel-filter');
  const filterToggleBtn = document.getElementById('filter-toggle');
  const filterPanel = document.getElementById('filter-panel');
  const filterBadge = document.getElementById('filter-badge');
  const verifierMinInput = document.getElementById('filter-verifier-min');
  const verifierMaxInput = document.getElementById('filter-verifier-max');
  const showcaseMinInput = document.getElementById('filter-showcase-min');
  const showcaseMaxInput = document.getElementById('filter-showcase-max');
  const filterClearBtn = document.getElementById('filter-clear');
  const scatterBody = document.getElementById('chart-scatter');
  const trendBody = document.getElementById('chart-trend');
  const trendLegend = document.getElementById('trend-legend');
  const channelsBody = document.getElementById('chart-channels');
  const channelsVerifierBody = document.getElementById('chart-channels-verifier');
  const leadBody = document.getElementById('chart-lead');
  const leadLegend = document.getElementById('lead-legend');
  const shareBody = document.getElementById('chart-share');
  const shareVerifierBody = document.getElementById('chart-share-verifier');
  const histBody = document.getElementById('chart-hist');
  const histLegend = document.getElementById('hist-legend');

  let allDemons = [];
  let cache = { levels: {} };
  let range = 'all';
  let channelFilter = '';
  const filters = { verifierMin: null, verifierMax: null, showcaseMin: null, showcaseMax: null };

  function showBanner(msg, isError) {
    stateBanner.innerHTML = msg;
    stateBanner.className = 'state-banner' + (isError ? ' error' : '');
    stateBanner.style.display = 'block';
  }
  function hideBanner() { stateBanner.style.display = 'none'; }

  function entryFor(d) { return cache.levels ? cache.levels[d.id] : undefined; }

  function filtersActive() {
    return filters.verifierMin !== null || filters.verifierMax !== null || filters.showcaseMin !== null || filters.showcaseMax !== null;
  }
  function activeFilterCount() {
    return [filters.verifierMin, filters.verifierMax, filters.showcaseMin, filters.showcaseMax].filter(v => v !== null).length;
  }
  function passesFilters(entry) {
    if (filters.verifierMin !== null && !(entry?.verifier?.viewCount >= filters.verifierMin)) return false;
    if (filters.verifierMax !== null && !(entry?.verifier?.viewCount <= filters.verifierMax)) return false;
    if (filters.showcaseMin !== null && !(entry?.showcase?.viewCount >= filters.showcaseMin)) return false;
    if (filters.showcaseMax !== null && !(entry?.showcase?.viewCount <= filters.showcaseMax)) return false;
    return true;
  }

  function filteredDemons() {
    let list = allDemons;
    if (range === 'main') list = list.filter(d => d.position <= 75);
    else if (range === 'extended') list = list.filter(d => d.position > 75);
    if (channelFilter) list = list.filter(d => entryFor(d)?.showcase?.channel === channelFilter);
    if (filtersActive()) list = list.filter(d => passesFilters(entryFor(d)));
    return list;
  }

  // --- filter panel wiring (verifier/showcase view-count ranges) — same
  // pattern as the list page's Filters dropdown (js/list.js), sharing
  // its CSS (moved to css/base.css for that reason) ---

  function closeFilterPanel() {
    filterPanel.classList.remove('open');
    filterToggleBtn.setAttribute('aria-expanded', 'false');
  }
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
    renderAll();
  }
  const debouncedApplyFilters = debounce(applyFiltersFromUI, 350);
  verifierMinInput.addEventListener('input', debouncedApplyFilters);
  verifierMaxInput.addEventListener('input', debouncedApplyFilters);
  showcaseMinInput.addEventListener('input', debouncedApplyFilters);
  showcaseMaxInput.addEventListener('input', debouncedApplyFilters);
  filterClearBtn.addEventListener('click', () => {
    filters.verifierMin = filters.verifierMax = filters.showcaseMin = filters.showcaseMax = null;
    verifierMinInput.value = verifierMaxInput.value = showcaseMinInput.value = showcaseMaxInput.value = '';
    syncFilterUI();
    renderAll();
  });

  channelFilterEl.addEventListener('change', () => {
    channelFilter = channelFilterEl.value;
    renderAll();
  });

  /** Populated once the data's in — every channel that's the top showcase pick for at least one tracked level, alphabetical. */
  function populateChannelFilter() {
    const channels = [...new Set(allDemons.map(d => entryFor(d)?.showcase?.channel).filter(Boolean))].sort();
    channelFilterEl.innerHTML = `<option value="">All channels</option>` +
      channels.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
  }

  // --- small chart-building helpers, shared by all three charts ---

  function logPos(value, min, max, size) {
    const v = Math.max(value, 1);
    const lo = Math.log10(Math.max(min, 1));
    const hi = Math.log10(Math.max(max, 1));
    if (hi <= lo) return size / 2;
    return ((Math.log10(v) - lo) / (hi - lo)) * size;
  }

  /** One tick per power of ten spanning [min, max] — a log axis has no other "nice" step. */
  function logTicks(min, max) {
    const lo = Math.floor(Math.log10(Math.max(min, 1)));
    const hi = Math.ceil(Math.log10(Math.max(max, 1)));
    const ticks = [];
    for (let e = lo; e <= hi; e++) ticks.push(Math.pow(10, e));
    return ticks;
  }

  /** floor()/ceil() in logTicks() round *out* to the nearest whole power of ten, which can land just past the actual [min, max] domain — this keeps a tick's gridline/label off the plot only when its mapped position would actually spill outside the axis. */
  function inPlotBounds(pos, size) {
    return pos >= -0.5 && pos <= size + 0.5;
  }

  function tableToggleHtml(id, headers, rows) {
    return `
      <details class="chart-table-toggle" id="${id}">
        <summary>View as table</summary>
        <table class="chart-table">
          <thead><tr>${headers.map(h => `<th>${escapeHtml(h)}</th>`).join('')}</tr></thead>
          <tbody>${rows.map(r => `<tr>${r.map(c => `<td>${escapeHtml(String(c))}</td>`).join('')}</tr>`).join('')}</tbody>
        </table>
      </details>
    `;
  }

  /** One tooltip div per chart, repositioned/rewritten on hover rather than rebuilt — see the per-chart wireXTooltips() below. */
  function makeTooltip(container) {
    const el = document.createElement('div');
    el.className = 'chart-tooltip';
    container.appendChild(el);
    return {
      show(x, y, html) {
        el.innerHTML = html;
        el.style.left = `${x}px`;
        el.style.top = `${y - 12}px`;
        el.classList.add('visible');
      },
      hide() { el.classList.remove('visible'); },
    };
  }

  // --- KPI row ---

  function median(arr) {
    if (!arr.length) return null;
    const sorted = arr.slice().sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  /**
   * Pearson correlation, on log10 of the raw values rather than the
   * values themselves — view counts span 4+ orders of magnitude (same
   * reason every chart on this page uses a log scale), so a raw-value
   * correlation would just measure whether the single biggest outliers
   * line up, not whether the two are actually related across the whole
   * range. Only over levels with both values present and positive.
   */
  function logCorrelation(pairs) {
    const xs = [], ys = [];
    for (const [v, s] of pairs) {
      if (v > 0 && s > 0) { xs.push(Math.log10(v)); ys.push(Math.log10(s)); }
    }
    if (xs.length < 2) return null;
    const mean = arr => arr.reduce((a, b) => a + b, 0) / arr.length;
    const mx = mean(xs), my = mean(ys);
    let num = 0, dx2 = 0, dy2 = 0;
    for (let i = 0; i < xs.length; i++) {
      const dx = xs[i] - mx, dy = ys[i] - my;
      num += dx * dy; dx2 += dx * dx; dy2 += dy * dy;
    }
    const denom = Math.sqrt(dx2 * dy2);
    return denom === 0 ? null : num / denom;
  }

  function computeStats(demons) {
    const verifierVals = [], showcaseVals = [], pairs = [];
    let topVerifier = null, topShowcase = null, topLead = null, leads = 0, bothCount = 0;
    for (const d of demons) {
      const entry = entryFor(d);
      if (!entry) continue;
      const v = entry.verifier?.viewCount;
      const s = entry.showcase?.viewCount;
      if (Number.isFinite(v)) {
        verifierVals.push(v);
        if (!topVerifier || v > topVerifier.views) topVerifier = { demon: d, views: v };
      }
      if (Number.isFinite(s)) {
        showcaseVals.push(s);
        if (!topShowcase || s > topShowcase.views) topShowcase = { demon: d, views: s };
      }
      if (Number.isFinite(v) && Number.isFinite(s)) {
        pairs.push([v, s]);
        bothCount++;
        if (s > v) leads++;
        if (s > v && (!topLead || s - v > topLead.lead)) topLead = { demon: d, lead: s - v };
      }
    }
    const avg = arr => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
    return {
      count: demons.length,
      avgVerifier: avg(verifierVals),
      avgShowcase: avg(showcaseVals),
      medianVerifier: median(verifierVals),
      medianShowcase: median(showcaseVals),
      topVerifier, topShowcase, topLead,
      showcaseWinRate: bothCount ? leads / bothCount : null,
      showcaseWins: leads,
      verifierWins: bothCount - leads,
      correlation: logCorrelation(pairs),
    };
  }

  function kpiTile(label, value, { sub, href } = {}) {
    const content = `
      <span class="kpi-label">${escapeHtml(label)}</span>
      <span class="kpi-value">${escapeHtml(value)}</span>
      ${sub ? `<span class="kpi-sub">${escapeHtml(sub)}</span>` : ''}
    `;
    return href ? `<a class="kpi-tile" href="${href}">${content}</a>` : `<div class="kpi-tile">${content}</div>`;
  }

  function renderKpis(stats) {
    const tiles = [
      kpiTile('Tracked levels', String(stats.count)),
      kpiTile('Avg. verifier views', stats.avgVerifier !== null ? formatCount(Math.round(stats.avgVerifier)) : '—'),
      kpiTile('Avg. showcase views', stats.avgShowcase !== null ? formatCount(Math.round(stats.avgShowcase)) : '—'),
      kpiTile('Median verifier views', stats.medianVerifier !== null ? formatCount(Math.round(stats.medianVerifier)) : '—'),
      kpiTile('Median showcase views', stats.medianShowcase !== null ? formatCount(Math.round(stats.medianShowcase)) : '—'),
    ];
    if (stats.topVerifier) {
      tiles.push(kpiTile('Most-viewed verification', formatCount(stats.topVerifier.views),
        { sub: `#${stats.topVerifier.demon.position} ${stats.topVerifier.demon.name}`, href: `level.html#${stats.topVerifier.demon.position}` }));
    }
    if (stats.topShowcase) {
      tiles.push(kpiTile('Most-viewed showcase', formatCount(stats.topShowcase.views),
        { sub: `#${stats.topShowcase.demon.position} ${stats.topShowcase.demon.name}`, href: `level.html#${stats.topShowcase.demon.position}` }));
    }
    if (stats.topLead) {
      tiles.push(kpiTile('Biggest showcase lead', `+${formatCount(stats.topLead.lead)}`,
        { sub: `#${stats.topLead.demon.position} ${stats.topLead.demon.name}`, href: `level.html#${stats.topLead.demon.position}` }));
    }
    if (stats.showcaseWinRate !== null) {
      tiles.push(kpiTile('Showcase win rate', `${Math.round(stats.showcaseWinRate * 100)}%`,
        { sub: `${stats.showcaseWins} of ${stats.showcaseWins + stats.verifierWins} levels` }));
    }
    if (stats.correlation !== null) {
      tiles.push(kpiTile('Correlation (log views)', stats.correlation.toFixed(2),
        { sub: 'verifier ↔ showcase, −1 to 1' }));
    }
    kpiRow.innerHTML = tiles.join('');
  }

  // --- chart 1: scatter, verifier views vs. showcase views ---

  function renderScatter(demons) {
    const points = demons.map(d => {
      const entry = entryFor(d);
      const v = entry?.verifier?.viewCount;
      const s = entry?.showcase?.viewCount;
      return Number.isFinite(v) && Number.isFinite(s) ? { demon: d, v, s } : null;
    }).filter(Boolean);

    if (!points.length) {
      scatterBody.innerHTML = `<div class="chart-empty">No levels with both a verifier and showcase view count yet.</div>`;
      return;
    }

    const W = 760, H = 420, M = { l: 64, r: 20, t: 16, b: 46 };
    const plotW = W - M.l - M.r, plotH = H - M.t - M.b;
    const allVals = points.flatMap(p => [p.v, p.s]);
    const min = Math.min(...allVals), max = Math.max(...allVals);
    const x = v => M.l + logPos(v, min, max, plotW);
    const y = v => M.t + plotH - logPos(v, min, max, plotH);
    const ticks = logTicks(min, max);

    let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Scatter plot of verifier views versus showcase views per level">`;
    ticks.forEach(t => {
      const xPos = logPos(t, min, max, plotW), yPos = logPos(t, min, max, plotH);
      if (inPlotBounds(xPos, plotW)) {
        const xp = M.l + xPos;
        svg += `<line class="chart-axis" x1="${xp}" y1="${M.t}" x2="${xp}" y2="${M.t + plotH}" />`;
        svg += `<text class="chart-axis-text" x="${xp}" y="${M.t + plotH + 16}" text-anchor="middle">${formatCount(t)}</text>`;
      }
      if (inPlotBounds(yPos, plotH)) {
        const yp = M.t + plotH - yPos;
        svg += `<line class="chart-axis" x1="${M.l}" y1="${yp}" x2="${M.l + plotW}" y2="${yp}" />`;
        svg += `<text class="chart-axis-text" x="${M.l - 8}" y="${yp + 3}" text-anchor="end">${formatCount(t)}</text>`;
      }
    });
    // y = x reference — above it, showcase out-views the verification video.
    svg += `<line class="chart-ref-line" x1="${x(min)}" y1="${y(min)}" x2="${x(max)}" y2="${y(max)}" />`;
    svg += `<text class="chart-axis-text" x="${M.l + plotW / 2}" y="${H - 4}" text-anchor="middle">Verifier views</text>`;

    points.forEach((p, i) => {
      const cx = x(p.v), cy = y(p.s);
      svg += `<circle class="chart-hit" cx="${cx}" cy="${cy}" r="14" data-i="${i}" />`;
      svg += `<circle class="chart-dot-showcase" cx="${cx}" cy="${cy}" r="4.5" opacity="0.85" data-i="${i}" />`;
    });
    svg += `</svg>`;

    const rows = points.slice().sort((a, b) => b.s - a.s)
      .map(p => [`#${p.demon.position}`, p.demon.name, formatCount(p.v), formatCount(p.s)]);
    scatterBody.innerHTML = svg + tableToggleHtml('chart-scatter-table', ['Rank', 'Level', 'Verifier views', 'Showcase views'], rows);

    const tooltip = makeTooltip(scatterBody);
    scatterBody.querySelectorAll('.chart-hit').forEach(hit => {
      const p = points[+hit.dataset.i];
      hit.addEventListener('pointermove', (e) => {
        const rect = scatterBody.getBoundingClientRect();
        tooltip.show(e.clientX - rect.left, e.clientY - rect.top, `
          <div class="tt-title">#${p.demon.position} ${escapeHtml(p.demon.name)}</div>
          <div class="tt-row"><span class="tt-key" style="background:var(--text-mid)"></span>Verifier <span class="tt-value">${formatCount(p.v)}</span></div>
          <div class="tt-row"><span class="tt-key" style="background:var(--primary)"></span>Showcase <span class="tt-value">${formatCount(p.s)}</span></div>
        `);
      });
      hit.addEventListener('pointerleave', () => tooltip.hide());
    });
  }

  // --- chart 2: average views by rank bucket ---

  function bucketize(demons, size) {
    const sorted = demons.slice().sort((a, b) => a.position - b.position);
    const avg = arr => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
    const buckets = [];
    for (let i = 0; i < sorted.length; i += size) {
      const chunk = sorted.slice(i, i + size);
      const vVals = [], sVals = [];
      for (const d of chunk) {
        const entry = entryFor(d);
        if (Number.isFinite(entry?.verifier?.viewCount)) vVals.push(entry.verifier.viewCount);
        if (Number.isFinite(entry?.showcase?.viewCount)) sVals.push(entry.showcase.viewCount);
      }
      buckets.push({
        label: chunk.length > 1 ? `#${chunk[0].position}-${chunk[chunk.length - 1].position}` : `#${chunk[0].position}`,
        avgV: avg(vVals),
        avgS: avg(sVals),
      });
    }
    return buckets;
  }

  function renderTrend(demons) {
    const points = bucketize(demons, 10).filter(b => b.avgV !== null || b.avgS !== null);
    if (!points.length) {
      trendBody.innerHTML = `<div class="chart-empty">Not enough data yet.</div>`;
      trendLegend.innerHTML = '';
      return;
    }
    trendLegend.innerHTML = `
      <span class="legend-key"><span class="legend-line" style="background:var(--text-mid)"></span>Verifier</span>
      <span class="legend-key"><span class="legend-line" style="background:var(--primary)"></span>Showcase</span>
    `;

    const W = 760, H = 340, M = { l: 64, r: 54, t: 16, b: 70 };
    const plotW = W - M.l - M.r, plotH = H - M.t - M.b;
    const allVals = points.flatMap(b => [b.avgV, b.avgS]).filter(v => v !== null);
    const min = Math.min(...allVals), max = Math.max(...allVals);
    const xStep = points.length > 1 ? plotW / (points.length - 1) : 0;
    const xAt = i => M.l + (points.length > 1 ? i * xStep : plotW / 2);
    const yAt = v => M.t + plotH - logPos(v, min, max, plotH);
    const ticks = logTicks(min, max);

    let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Average verifier and showcase views by rank bucket">`;
    ticks.forEach(t => {
      const yPos = logPos(t, min, max, plotH);
      if (!inPlotBounds(yPos, plotH)) return;
      const yp = M.t + plotH - yPos;
      svg += `<line class="chart-axis" x1="${M.l}" y1="${yp}" x2="${M.l + plotW}" y2="${yp}" />`;
      svg += `<text class="chart-axis-text" x="${M.l - 8}" y="${yp + 3}" text-anchor="end">${formatCount(t)}</text>`;
    });

    function pathFor(key) {
      let d = '';
      points.forEach((b, i) => {
        if (b[key] === null) return;
        d += `${d === '' ? 'M' : 'L'}${xAt(i)},${yAt(b[key])} `;
      });
      return d.trim();
    }
    svg += `<path class="chart-line-verifier" d="${pathFor('avgV')}" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />`;
    svg += `<path class="chart-line-showcase" d="${pathFor('avgS')}" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />`;

    points.forEach((b, i) => {
      const xp = xAt(i);
      if (b.avgV !== null) {
        svg += `<circle class="chart-hit" cx="${xp}" cy="${yAt(b.avgV)}" r="12" data-i="${i}" />`;
        svg += `<circle class="chart-dot-verifier" cx="${xp}" cy="${yAt(b.avgV)}" r="4" />`;
      }
      if (b.avgS !== null) {
        svg += `<circle class="chart-hit" cx="${xp}" cy="${yAt(b.avgS)}" r="12" data-i="${i}" />`;
        svg += `<circle class="chart-dot-showcase" cx="${xp}" cy="${yAt(b.avgS)}" r="4" />`;
      }
      svg += `<text class="chart-axis-text" x="${xp}" y="${M.t + plotH + 14}" text-anchor="end" transform="rotate(-40 ${xp} ${M.t + plotH + 14})">${escapeHtml(b.label)}</text>`;
    });

    // Direct end-labels on the last bucket — the endpoint is the one point worth labeling inline; everything else lives in the axis/tooltip/table.
    const lastI = points.length - 1, last = points[lastI];
    if (last.avgV !== null) svg += `<text class="chart-mark-label" x="${xAt(lastI) + 8}" y="${yAt(last.avgV) + 4}">${formatCount(Math.round(last.avgV))}</text>`;
    if (last.avgS !== null) svg += `<text class="chart-mark-label" x="${xAt(lastI) + 8}" y="${yAt(last.avgS) + 4}" fill="var(--primary)">${formatCount(Math.round(last.avgS))}</text>`;
    svg += `</svg>`;

    const rows = points.map(b => [b.label, b.avgV !== null ? formatCount(Math.round(b.avgV)) : '—', b.avgS !== null ? formatCount(Math.round(b.avgS)) : '—']);
    trendBody.innerHTML = svg + tableToggleHtml('chart-trend-table', ['Rank range', 'Avg. verifier views', 'Avg. showcase views'], rows);

    const tooltip = makeTooltip(trendBody);
    trendBody.querySelectorAll('.chart-hit').forEach(hit => {
      const b = points[+hit.dataset.i];
      hit.addEventListener('pointermove', (e) => {
        const rect = trendBody.getBoundingClientRect();
        tooltip.show(e.clientX - rect.left, e.clientY - rect.top, `
          <div class="tt-title">${escapeHtml(b.label)}</div>
          ${b.avgV !== null ? `<div class="tt-row"><span class="tt-key" style="background:var(--text-mid)"></span>Verifier <span class="tt-value">${formatCount(Math.round(b.avgV))}</span></div>` : ''}
          ${b.avgS !== null ? `<div class="tt-row"><span class="tt-key" style="background:var(--primary)"></span>Showcase <span class="tt-value">${formatCount(Math.round(b.avgS))}</span></div>` : ''}
        `);
      });
      hit.addEventListener('pointerleave', () => tooltip.hide());
    });
  }

  // --- chart 3: total views by channel (showcase + verifier) ---

  /** Generic "total views by channel" ranked bar, shared by the showcase and verifier variants. Caps at topN rows, folding the rest into one "Other" row — magnitude bars don't have the donut's color-identity ceiling, this cap is purely so a long tail (verifier channels run to 100+, almost all one level each) doesn't turn into a page-length chart. */
  function renderChannelTotals(bodyEl, demons, videoKey, { barClass, topN = 12, ariaLabel, countLabel }) {
    const totals = new Map();
    for (const d of demons) {
      const v = entryFor(d)?.[videoKey];
      if (!v || !Number.isFinite(v.viewCount)) continue;
      const key = v.channel || 'Unknown';
      const cur = totals.get(key) || { channel: key, total: 0, count: 0 };
      cur.total += v.viewCount;
      cur.count += 1;
      totals.set(key, cur);
    }
    let rows = [...totals.values()].sort((a, b) => b.total - a.total);
    if (!rows.length) {
      bodyEl.innerHTML = `<div class="chart-empty">No ${videoKey} data yet.</div>`;
      return;
    }
    if (rows.length > topN) {
      const rest = rows.slice(topN);
      const other = rest.reduce((a, r) => ({ channel: 'Other', total: a.total + r.total, count: a.count + r.count }), { channel: 'Other', total: 0, count: 0 });
      rows = [...rows.slice(0, topN), other];
    }

    const rowH = 30, barH = 22, gap = 6;
    const W = 760, M = { l: 150, r: 70, t: 10, b: 10 };
    const plotW = W - M.l - M.r;
    const H = M.t + M.b + rows.length * (rowH + gap) - gap;
    const max = Math.max(...rows.map(r => r.total));
    const xw = v => Math.max((v / max) * plotW, 2);

    let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${escapeHtml(ariaLabel)}">`;
    rows.forEach((r, i) => {
      const yTop = M.t + i * (rowH + gap);
      const barW = xw(r.total);
      const cls = r.channel === 'Other' ? 'chart-bar-other' : barClass;
      svg += `<g class="chart-bar-row">`;
      svg += `<text class="chart-bar-name" x="${M.l - 10}" y="${yTop + rowH / 2 + 4}" text-anchor="end">${escapeHtml(r.channel)}</text>`;
      svg += `<rect class="chart-hit" x="0" y="${yTop}" width="${W}" height="${rowH}" data-i="${i}" />`;
      svg += `<rect class="${cls}" x="${M.l}" y="${yTop + (rowH - barH) / 2}" width="${barW}" height="${barH}" rx="4" />`;
      svg += `<text class="chart-mark-label" x="${M.l + barW + 8}" y="${yTop + rowH / 2 + 4}">${formatCount(r.total)}</text>`;
      svg += `</g>`;
    });
    svg += `</svg>`;

    const tableRows = rows.map(r => [r.channel, formatCount(r.total), String(r.count)]);
    bodyEl.innerHTML = svg + tableToggleHtml(`${bodyEl.id}-table`, ['Channel', 'Total views', 'Levels'], tableRows);

    const tooltip = makeTooltip(bodyEl);
    bodyEl.querySelectorAll('.chart-hit').forEach(hit => {
      const r = rows[+hit.dataset.i];
      hit.addEventListener('pointermove', (e) => {
        const rect = bodyEl.getBoundingClientRect();
        tooltip.show(e.clientX - rect.left, e.clientY - rect.top, `
          <div class="tt-title">${escapeHtml(r.channel)}</div>
          <div class="tt-row">Total <span class="tt-value">${formatCount(r.total)}</span></div>
          <div class="tt-row">${countLabel(r.count)}</div>
        `);
      });
      hit.addEventListener('pointerleave', () => tooltip.hide());
    });
  }

  // --- chart 4/5: donut charts (leadership split, channel share) ---

  /**
   * Generic donut: slices = [{ label, value, color }]. A hit-ring path
   * per slice (pointer-events:auto) sits behind the painted slice
   * (pointer-events:none in CSS, same reason as every other chart on
   * this page — see the SVG chart chrome comment in stats.css), and the
   * legend is the identity channel (never color alone) doubling as this
   * chart's "View as table" — a 2-4 slice donut's whole dataset already
   * fits directly on screen, so a separate collapsed table would just
   * repeat the legend.
   */
  function renderDonut(bodyEl, legendEl, slices, { centerLabel = 'Total' } = {}) {
    const total = slices.reduce((a, s) => a + s.value, 0);
    if (!total) {
      bodyEl.innerHTML = `<div class="chart-empty">No data yet.</div>`;
      legendEl.innerHTML = '';
      return;
    }
    const size = 200, r = 92, innerR = 58, cx = size / 2, cy = size / 2;
    let angle = -Math.PI / 2;
    const arcs = slices.filter(s => s.value > 0).map(s => {
      const frac = s.value / total;
      const a0 = angle;
      angle += frac * Math.PI * 2;
      return { ...s, a0, a1: angle, frac };
    });

    function slicePath(a0, a1) {
      const full = (a1 - a0) >= Math.PI * 2 - 0.001;
      if (full) {
        return `M${cx + r},${cy} A${r},${r} 0 1 1 ${cx - r},${cy} A${r},${r} 0 1 1 ${cx + r},${cy} `
          + `M${cx + innerR},${cy} A${innerR},${innerR} 0 1 0 ${cx - innerR},${cy} A${innerR},${innerR} 0 1 0 ${cx + innerR},${cy} Z`;
      }
      const largeArc = (a1 - a0) > Math.PI ? 1 : 0;
      const x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0);
      const x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
      const ix0 = cx + innerR * Math.cos(a1), iy0 = cy + innerR * Math.sin(a1);
      const ix1 = cx + innerR * Math.cos(a0), iy1 = cy + innerR * Math.sin(a0);
      return `M${x0},${y0} A${r},${r} 0 ${largeArc} 1 ${x1},${y1} L${ix0},${iy0} A${innerR},${innerR} 0 ${largeArc} 0 ${ix1},${iy1} Z`;
    }

    let svg = `<svg viewBox="0 0 ${size} ${size}" role="img" aria-label="Donut chart">`;
    arcs.forEach((s, i) => {
      const path = slicePath(s.a0, s.a1);
      svg += `<path class="donut-hit" d="${path}" data-i="${i}" />`;
      svg += `<path class="donut-slice" d="${path}" fill="${s.color}" data-i="${i}" />`;
    });
    svg += `<text class="donut-center-value" x="${cx}" y="${cy - 2}">${escapeHtml(formatCount(total))}</text>`;
    svg += `<text class="donut-center-label" x="${cx}" y="${cy + 14}">${escapeHtml(centerLabel)}</text>`;
    svg += `</svg>`;
    bodyEl.innerHTML = svg;

    legendEl.innerHTML = arcs.map(s => `
      <span class="legend-key"><span class="legend-dot" style="background:${s.color}"></span>${escapeHtml(s.label)} <span class="mono">${Math.round(s.frac * 100)}%</span></span>
    `).join('');

    const tooltip = makeTooltip(bodyEl);
    bodyEl.querySelectorAll('.donut-hit').forEach(hit => {
      const s = arcs[+hit.dataset.i];
      hit.addEventListener('pointermove', (e) => {
        const rect = bodyEl.getBoundingClientRect();
        tooltip.show(e.clientX - rect.left, e.clientY - rect.top, `
          <div class="tt-title">${escapeHtml(s.label)}</div>
          <div class="tt-row"><span class="tt-key" style="background:${s.color}"></span><span class="tt-value">${escapeHtml(formatCount(s.value))}</span> (${Math.round(s.frac * 100)}%)</div>
        `);
      });
      hit.addEventListener('pointerleave', () => tooltip.hide());
    });
  }

  function renderLeadDonut(demons) {
    let showcaseWins = 0, verifierWins = 0;
    for (const d of demons) {
      const entry = entryFor(d);
      const v = entry?.verifier?.viewCount, s = entry?.showcase?.viewCount;
      if (!Number.isFinite(v) || !Number.isFinite(s)) continue;
      if (s > v) showcaseWins++;
      else verifierWins++;
    }
    renderDonut(leadBody, leadLegend, [
      { label: 'Showcase leads', value: showcaseWins, color: 'var(--primary)' },
      { label: 'Verifier leads', value: verifierWins, color: 'var(--text-mid)' },
    ], { centerLabel: 'Levels' });
  }

  // A donut can't safely carry more than 3 named identity colors — any
  // two slices can end up adjacent depending on the data (an "all-pairs"
  // context), and this palette's all-pairs CVD safety only clears three
  // slots — so channel share is a ranked bar instead: bars in a fixed
  // order only need *adjacent*-pair safety, which the categorical set
  // clears for all eight slots. Orange is skipped — "showcase" already
  // means something specific in orange everywhere else on this page (see
  // the file header), and reusing it for "channel #2" here would read as
  // if it meant that again — leaving seven named colors before the rest
  // fold into one muted "Other" row.
  //
  // Colors are assigned once against the *full* unfiltered dataset
  // (allDemons), ranked by level count, and held fixed per channel from
  // then on — a filter that changes which channels are visible must
  // never repaint the ones that stay (dataviz skill: "color follows the
  // entity, never its rank").
  const IDENTITY_COLORS = ['#3987e5', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'];
  const IDENTITY_OTHER_COLOR = 'var(--text-dim)';

  function channelCounts(demons, videoKey) {
    const counts = new Map();
    for (const d of demons) {
      const channel = entryFor(d)?.[videoKey]?.channel;
      if (!channel) continue;
      counts.set(channel, (counts.get(channel) || 0) + 1);
    }
    return counts;
  }

  function channelColorMap(videoKey) {
    const ranked = [...channelCounts(allDemons, videoKey).entries()].sort((a, b) => b[1] - a[1]);
    const map = new Map();
    ranked.forEach(([channel], i) => { if (i < IDENTITY_COLORS.length) map.set(channel, IDENTITY_COLORS[i]); });
    return map;
  }

  function renderChannelShareBar(bodyEl, demons, videoKey, ariaLabel) {
    const colorMap = channelColorMap(videoKey);
    const counts = channelCounts(demons, videoKey);
    const rows = [];
    let other = 0;
    for (const [channel, n] of counts) {
      if (colorMap.has(channel)) rows.push({ channel, n, color: colorMap.get(channel) });
      else other += n;
    }
    rows.sort((a, b) => b.n - a.n);
    if (other > 0) rows.push({ channel: 'Other', n: other, color: IDENTITY_OTHER_COLOR });

    if (!rows.length) {
      bodyEl.innerHTML = `<div class="chart-empty">No data yet.</div>`;
      return;
    }

    const total = rows.reduce((a, r) => a + r.n, 0);
    const rowH = 30, barH = 22, gap = 6;
    const W = 760, M = { l: 150, r: 60, t: 10, b: 10 };
    const plotW = W - M.l - M.r;
    const H = M.t + M.b + rows.length * (rowH + gap) - gap;
    const max = Math.max(...rows.map(r => r.n));
    const xw = v => Math.max((v / max) * plotW, 2);

    let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${escapeHtml(ariaLabel)}">`;
    rows.forEach((r, i) => {
      const yTop = M.t + i * (rowH + gap);
      const barW = xw(r.n);
      svg += `<g class="chart-bar-row">`;
      svg += `<text class="chart-bar-name" x="${M.l - 10}" y="${yTop + rowH / 2 + 4}" text-anchor="end">${escapeHtml(r.channel)}</text>`;
      svg += `<rect class="chart-hit" x="0" y="${yTop}" width="${W}" height="${rowH}" data-i="${i}" />`;
      svg += `<rect class="chart-bar-identity" x="${M.l}" y="${yTop + (rowH - barH) / 2}" width="${barW}" height="${barH}" rx="4" fill="${r.color}" />`;
      svg += `<text class="chart-mark-label" x="${M.l + barW + 8}" y="${yTop + rowH / 2 + 4}">${r.n} (${Math.round(r.n / total * 100)}%)</text>`;
      svg += `</g>`;
    });
    svg += `</svg>`;

    bodyEl.innerHTML = svg;

    const tooltip = makeTooltip(bodyEl);
    bodyEl.querySelectorAll('.chart-hit').forEach(hit => {
      const r = rows[+hit.dataset.i];
      hit.addEventListener('pointermove', (e) => {
        const rect = bodyEl.getBoundingClientRect();
        tooltip.show(e.clientX - rect.left, e.clientY - rect.top, `
          <div class="tt-title">${escapeHtml(r.channel)}</div>
          <div class="tt-row"><span class="tt-key" style="background:${r.color}"></span><span class="tt-value">${r.n}</span> level${r.n === 1 ? '' : 's'} (${Math.round(r.n / total * 100)}%)</div>
        `);
      });
      hit.addEventListener('pointerleave', () => tooltip.hide());
    });
  }

  // --- chart 6: distribution of view counts (histogram) ---

  const HIST_BUCKETS = [
    { label: '<10K', max: 1e4 },
    { label: '10K-100K', max: 1e5 },
    { label: '100K-1M', max: 1e6 },
    { label: '1M-10M', max: 1e7 },
    { label: '10M+', max: Infinity },
  ];
  function histBucketIndex(v) {
    for (let i = 0; i < HIST_BUCKETS.length; i++) if (v < HIST_BUCKETS[i].max) return i;
    return HIST_BUCKETS.length - 1;
  }

  function renderHistogram(demons) {
    const counts = HIST_BUCKETS.map(b => ({ label: b.label, v: 0, s: 0 }));
    for (const d of demons) {
      const entry = entryFor(d);
      const v = entry?.verifier?.viewCount, s = entry?.showcase?.viewCount;
      if (Number.isFinite(v)) counts[histBucketIndex(v)].v++;
      if (Number.isFinite(s)) counts[histBucketIndex(s)].s++;
    }
    if (!counts.some(c => c.v || c.s)) {
      histBody.innerHTML = `<div class="chart-empty">No data yet.</div>`;
      histLegend.innerHTML = '';
      return;
    }
    histLegend.innerHTML = `
      <span class="legend-key"><span class="legend-line" style="background:var(--text-mid)"></span>Verifier</span>
      <span class="legend-key"><span class="legend-line" style="background:var(--primary)"></span>Showcase</span>
    `;

    const W = 760, H = 320, M = { l: 46, r: 20, t: 16, b: 40 };
    const plotW = W - M.l - M.r, plotH = H - M.t - M.b;
    const maxCount = Math.max(1, ...counts.map(c => Math.max(c.v, c.s)));
    const groupW = plotW / counts.length;
    const colW = Math.min(28, groupW * 0.32);
    const yAt = n => M.t + plotH - (n / maxCount) * plotH;

    // y-axis: whole-number ticks only, thinned to avoid crowding when the range is small.
    const rawStep = Math.ceil(maxCount / 5);
    const yStep = Math.max(1, rawStep);
    const yTicks = [];
    for (let n = 0; n <= maxCount; n += yStep) yTicks.push(n);

    let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Distribution of verifier and showcase view counts">`;
    yTicks.forEach(n => {
      const yp = yAt(n);
      svg += `<line class="chart-axis" x1="${M.l}" y1="${yp}" x2="${M.l + plotW}" y2="${yp}" />`;
      svg += `<text class="chart-axis-text" x="${M.l - 8}" y="${yp + 3}" text-anchor="end">${n}</text>`;
    });

    counts.forEach((c, i) => {
      const groupCx = M.l + groupW * (i + 0.5);
      const vx = groupCx - colW - 2, sx = groupCx + 2;
      const vTop = yAt(c.v), sTop = yAt(c.s);
      svg += `<rect class="chart-hit" x="${groupCx - groupW / 2}" y="${M.t}" width="${groupW}" height="${plotH}" data-i="${i}" />`;
      if (c.v > 0) svg += `<rect class="chart-col-verifier" x="${vx}" y="${vTop}" width="${colW}" height="${M.t + plotH - vTop}" rx="3" />`;
      if (c.s > 0) svg += `<rect class="chart-col-showcase" x="${sx}" y="${sTop}" width="${colW}" height="${M.t + plotH - sTop}" rx="3" />`;
      svg += `<text class="chart-axis-text" x="${groupCx}" y="${M.t + plotH + 16}" text-anchor="middle">${escapeHtml(c.label)}</text>`;
    });
    svg += `</svg>`;

    const rows = counts.map(c => [c.label, String(c.v), String(c.s)]);
    histBody.innerHTML = svg + tableToggleHtml('chart-hist-table', ['View-count range', 'Verifier count', 'Showcase count'], rows);

    const tooltip = makeTooltip(histBody);
    histBody.querySelectorAll('.chart-hit').forEach(hit => {
      const c = counts[+hit.dataset.i];
      hit.addEventListener('pointermove', (e) => {
        const rect = histBody.getBoundingClientRect();
        tooltip.show(e.clientX - rect.left, e.clientY - rect.top, `
          <div class="tt-title">${escapeHtml(c.label)}</div>
          <div class="tt-row"><span class="tt-key" style="background:var(--text-mid)"></span>Verifier <span class="tt-value">${c.v}</span></div>
          <div class="tt-row"><span class="tt-key" style="background:var(--primary)"></span>Showcase <span class="tt-value">${c.s}</span></div>
        `);
      });
      hit.addEventListener('pointerleave', () => tooltip.hide());
    });
  }

  // --- wiring ---

  function renderAll() {
    const demons = filteredDemons();
    renderKpis(computeStats(demons));
    renderScatter(demons);
    renderLeadDonut(demons);
    renderChannelShareBar(shareBody, demons, 'showcase', 'Showcase channel share');
    renderChannelShareBar(shareVerifierBody, demons, 'verifier', 'Verifier channel share');
    renderHistogram(demons);
    renderTrend(demons);
    renderChannelTotals(channelsBody, demons, 'showcase', {
      barClass: 'chart-bar-showcase',
      ariaLabel: 'Total showcase views by channel',
      countLabel: n => `Top pick for <span class="tt-value">${n}</span> level${n === 1 ? '' : 's'}`,
    });
    renderChannelTotals(channelsVerifierBody, demons, 'verifier', {
      barClass: 'chart-bar-verifier',
      ariaLabel: 'Total verifier views by channel',
      countLabel: n => `Verified <span class="tt-value">${n}</span> level${n === 1 ? '' : 's'}`,
    });
  }

  rangeChipsEl.querySelectorAll('.range-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      range = chip.dataset.range;
      rangeChipsEl.querySelectorAll('.range-chip').forEach(c => c.classList.toggle('active', c === chip));
      renderAll();
    });
  });

  async function init() {
    showBanner('Loading stats…');
    try {
      const [{ demons }, cacheData] = await Promise.all([
        AredlAPI.fetchListed({ limit: CONFIG.LIST_SIZE, offset: 0 }),
        SharedYtCache.load(),
      ]);
      allDemons = demons;
      cache = cacheData;
      hideBanner();
      populateChannelFilter();
      renderAll();
    } catch (err) {
      console.error(err);
      showBanner(`Couldn't load stats: ${escapeHtml(err.message)}`, true);
    }
  }

  init();
})();
