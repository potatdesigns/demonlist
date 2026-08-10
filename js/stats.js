/* =====================================================================
   STATS PAGE CONTROLLER

   Averages, records, and three charts built from the same two sources
   every other page already reads — AredlAPI's cached full list and
   SharedYtCache's whole-cache fetch — aggregated across the tracked
   list instead of shown per-card. No charting library: plain hand-built
   SVG (this site has no build step to bring one in through), following
   the project's dataviz skill — sequential/emphasis color (gray
   verifier vs. orange showcase, the same mapping the list page's legend
   and cards already use, not a new convention), log scales (view counts
   span 4+ orders of magnitude), a hover tooltip on every mark with a
   hit target larger than the mark itself, and a "View as table" fallback
   on every chart so nothing here is chart-only.

   The All/Main/Extended range chips are the one filter, scoping the KPI
   row and all three charts together — see renderAll().
   ===================================================================== */

(() => {
  const stateBanner = document.getElementById('state-banner');
  const kpiRow = document.getElementById('kpi-row');
  const rangeChipsEl = document.getElementById('stats-range');
  const scatterBody = document.getElementById('chart-scatter');
  const trendBody = document.getElementById('chart-trend');
  const trendLegend = document.getElementById('trend-legend');
  const channelsBody = document.getElementById('chart-channels');

  let allDemons = [];
  let cache = { levels: {} };
  let range = 'all';

  function showBanner(msg, isError) {
    stateBanner.innerHTML = msg;
    stateBanner.className = 'state-banner' + (isError ? ' error' : '');
    stateBanner.style.display = 'block';
  }
  function hideBanner() { stateBanner.style.display = 'none'; }

  function filteredDemons() {
    if (range === 'main') return allDemons.filter(d => d.position <= 75);
    if (range === 'extended') return allDemons.filter(d => d.position > 75);
    return allDemons;
  }

  function entryFor(d) { return cache.levels ? cache.levels[d.id] : undefined; }

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

  function computeStats(demons) {
    const verifierVals = [], showcaseVals = [];
    let topVerifier = null, topShowcase = null, topLead = null;
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
      if (Number.isFinite(v) && Number.isFinite(s) && s > v && (!topLead || s - v > topLead.lead)) {
        topLead = { demon: d, lead: s - v };
      }
    }
    const avg = arr => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
    return {
      count: demons.length,
      avgVerifier: avg(verifierVals),
      avgShowcase: avg(showcaseVals),
      topVerifier, topShowcase, topLead,
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

  // --- chart 3: total showcase views by channel ---

  function renderChannels(demons) {
    const totals = new Map();
    for (const d of demons) {
      const sc = entryFor(d)?.showcase;
      if (!sc || !Number.isFinite(sc.viewCount)) continue;
      const key = sc.channel || 'Unknown';
      const cur = totals.get(key) || { channel: key, total: 0, count: 0 };
      cur.total += sc.viewCount;
      cur.count += 1;
      totals.set(key, cur);
    }
    const rows = [...totals.values()].sort((a, b) => b.total - a.total);
    if (!rows.length) {
      channelsBody.innerHTML = `<div class="chart-empty">No showcase data yet.</div>`;
      return;
    }

    const rowH = 30, barH = 22, gap = 6;
    const W = 760, M = { l: 150, r: 70, t: 10, b: 10 };
    const plotW = W - M.l - M.r;
    const H = M.t + M.b + rows.length * (rowH + gap) - gap;
    const max = Math.max(...rows.map(r => r.total));
    const xw = v => Math.max((v / max) * plotW, 2);

    let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Total showcase views by channel">`;
    rows.forEach((r, i) => {
      const yTop = M.t + i * (rowH + gap);
      const barW = xw(r.total);
      svg += `<g class="chart-bar-row">`;
      svg += `<text class="chart-bar-name" x="${M.l - 10}" y="${yTop + rowH / 2 + 4}" text-anchor="end">${escapeHtml(r.channel)}</text>`;
      svg += `<rect class="chart-hit" x="0" y="${yTop}" width="${W}" height="${rowH}" data-i="${i}" />`;
      svg += `<rect class="chart-bar-showcase" x="${M.l}" y="${yTop + (rowH - barH) / 2}" width="${barW}" height="${barH}" rx="4" />`;
      svg += `<text class="chart-mark-label" x="${M.l + barW + 8}" y="${yTop + rowH / 2 + 4}">${formatCount(r.total)}</text>`;
      svg += `</g>`;
    });
    svg += `</svg>`;

    const tableRows = rows.map(r => [r.channel, formatCount(r.total), String(r.count)]);
    channelsBody.innerHTML = svg + tableToggleHtml('chart-channels-table', ['Channel', 'Total showcase views', 'Levels'], tableRows);

    const tooltip = makeTooltip(channelsBody);
    channelsBody.querySelectorAll('.chart-hit').forEach(hit => {
      const r = rows[+hit.dataset.i];
      hit.addEventListener('pointermove', (e) => {
        const rect = channelsBody.getBoundingClientRect();
        tooltip.show(e.clientX - rect.left, e.clientY - rect.top, `
          <div class="tt-title">${escapeHtml(r.channel)}</div>
          <div class="tt-row">Total <span class="tt-value">${formatCount(r.total)}</span></div>
          <div class="tt-row">Top pick for <span class="tt-value">${r.count}</span> level${r.count === 1 ? '' : 's'}</div>
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
    renderTrend(demons);
    renderChannels(demons);
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
      renderAll();
    } catch (err) {
      console.error(err);
      showBanner(`Couldn't load stats: ${escapeHtml(err.message)}`, true);
    }
  }

  init();
})();
