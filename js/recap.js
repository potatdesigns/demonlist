/* =====================================================================
   RECAP PAGE CONTROLLER

   A "wrapped"-style summary of one year in the list, computed entirely
   from data/position-history.json (js/position-history.js) — the same
   underlying data the Time Machine and detail page's own position
   history read, just aggregated differently. No extra network call.
   ===================================================================== */

(() => {
  const yearsEl = document.getElementById('recap-years');
  const stateBanner = document.getElementById('state-banner');
  const bodyEl = document.getElementById('recap-body');

  let history = null;
  let names = null;
  let earliestYear = null;

  function showBanner(msg, isError = false) {
    stateBanner.innerHTML = msg;
    stateBanner.className = 'state-banner' + (isError ? ' error' : '');
    stateBanner.style.display = msg ? 'block' : 'none';
  }

  function todayStr() { return new Date().toISOString().slice(0, 10); }
  function thisYear() { return new Date().getFullYear(); }
  function name(id) { return names[id] || 'Unknown level'; }

  /** { levelId: position } as of dateStr — same forward-scan-per-level idea as js/timemachine.js's snapshotAt(), duplicated rather than shared since these are two independent, no-build-step pages. */
  function snapshotAt(dateStr) {
    const rows = {};
    for (const [id, entries] of Object.entries(history)) {
      let match = null;
      for (const e of entries) {
        if (e.date > dateStr) break;
        match = e;
      }
      if (match) rows[id] = match.position;
    }
    return rows;
  }

  function computeRecap(year) {
    const startOfYear = `${year}-01-01`;
    const dayBefore = `${year - 1}-12-31`;
    const endOfYear = year === thisYear() ? todayStr() : `${year}-12-31`;

    const startSnap = snapshotAt(dayBefore);
    const endSnap = snapshotAt(endOfYear);

    let totalEvents = 0, newPlacements = 0, swapEvents = 0;
    const swapCountById = new Map();
    const debuts = [];
    const heldNumberOne = new Set();

    // Scoped to changes that actually happened *within* the tracked top
    // CONFIG.LIST_SIZE — history also carries entries for levels well into
    // legacy (anything that was ever in the top LIST_SIZE keeps being
    // tracked afterward, see scripts/backfill-position-history.mjs), and
    // those would otherwise swamp a "year in the list" recap with churn
    // nobody watching the actual list ever saw.
    for (const [id, entries] of Object.entries(history)) {
      for (const e of entries) {
        if (e.date < startOfYear || e.date > endOfYear) continue;
        if (e.position > CONFIG.LIST_SIZE) continue;
        totalEvents++;
        if (e.position === 1) heldNumberOne.add(id);
        if (e.reason?.startsWith('Placed')) { newPlacements++; debuts.push({ id, position: e.position }); }
        if (e.reason?.startsWith('Swapped')) {
          swapEvents++;
          swapCountById.set(id, (swapCountById.get(id) || 0) + 1);
        }
      }
    }
    for (const [id, pos] of Object.entries(startSnap)) if (pos === 1) heldNumberOne.add(id);

    let biggestRiser = null, biggestFaller = null;
    for (const id of new Set([...Object.keys(startSnap), ...Object.keys(endSnap)])) {
      const startPos = startSnap[id], endPos = endSnap[id];
      if (startPos === undefined || endPos === undefined) continue; // only levels present at both ends get a clean "moved N spots" stat
      if (startPos > CONFIG.LIST_SIZE && endPos > CONFIG.LIST_SIZE) continue; // pure legacy-to-legacy churn isn't a "list" story
      const delta = startPos - endPos; // positive = improved (moved to a better/lower position)
      if (delta === 0) continue;
      if (!biggestRiser || delta > biggestRiser.delta) biggestRiser = { id, delta, startPos, endPos };
      if (!biggestFaller || delta < biggestFaller.delta) biggestFaller = { id, delta, startPos, endPos };
    }

    let mostSwapped = null;
    for (const [id, n] of swapCountById) if (!mostSwapped || n > mostSwapped.count) mostSwapped = { id, count: n };

    let bestDebut = null;
    for (const d of debuts) if (!bestDebut || d.position < bestDebut.position) bestDebut = d;

    return {
      year, totalEvents, newPlacements, swapEvents: Math.round(swapEvents / 2),
      heldNumberOneCount: heldNumberOne.size,
      heldNumberOneNames: [...heldNumberOne].map(name),
      biggestRiser, biggestFaller, mostSwapped, bestDebut,
    };
  }

  function posLabel(pos) { return pos <= CONFIG.LIST_SIZE ? `#${pos}` : 'Legacy'; }

  function moverCardHtml(label, mover, direction) {
    if (!mover) return '';
    const arrow = direction === 'up' ? '&uarr;' : '&darr;';
    const spots = Math.abs(mover.delta);
    return `
      <a class="recap-mover-card ${direction}" href="level.html#id=${encodeURIComponent(mover.id)}">
        <span class="recap-mover-label">${escapeHtml(label)}</span>
        <span class="recap-mover-name">${escapeHtml(name(mover.id))}</span>
        <span class="recap-mover-delta">${arrow} ${spots} spot${spots === 1 ? '' : 's'} <span class="recap-mover-range">(${posLabel(mover.startPos)} &rarr; ${posLabel(mover.endPos)})</span></span>
      </a>
    `;
  }

  function render(year) {
    const r = computeRecap(year);
    const parts = [];

    parts.push(`
      <div class="kpi-row">
        <div class="kpi-tile"><span class="kpi-label">Position changes</span><span class="kpi-value">${r.totalEvents}</span></div>
        <div class="kpi-tile"><span class="kpi-label">New placements</span><span class="kpi-value">${r.newPlacements}</span></div>
        <div class="kpi-tile"><span class="kpi-label">Swaps</span><span class="kpi-value">${r.swapEvents}</span></div>
        <div class="kpi-tile"><span class="kpi-label">Held #1</span><span class="kpi-value">${r.heldNumberOneCount}</span><span class="kpi-sub" title="${escapeHtml(r.heldNumberOneNames.join(', '))}">${escapeHtml(r.heldNumberOneNames.slice(0, 2).join(', '))}${r.heldNumberOneNames.length > 2 ? `, +${r.heldNumberOneNames.length - 2}` : ''}</span></div>
      </div>
    `);

    const movers = [
      moverCardHtml('Biggest riser', r.biggestRiser, 'up'),
      moverCardHtml('Biggest faller', r.biggestFaller, 'down'),
    ].filter(Boolean);
    if (r.mostSwapped) {
      movers.push(`
        <a class="recap-mover-card swap" href="level.html#id=${encodeURIComponent(r.mostSwapped.id)}">
          <span class="recap-mover-label">Most swapped</span>
          <span class="recap-mover-name">${escapeHtml(name(r.mostSwapped.id))}</span>
          <span class="recap-mover-delta">${r.mostSwapped.count} swap${r.mostSwapped.count === 1 ? '' : 's'}</span>
        </a>
      `);
    }
    if (r.bestDebut) {
      movers.push(`
        <a class="recap-mover-card debut" href="level.html#id=${encodeURIComponent(r.bestDebut.id)}">
          <span class="recap-mover-label">Best debut</span>
          <span class="recap-mover-name">${escapeHtml(name(r.bestDebut.id))}</span>
          <span class="recap-mover-delta">Placed at #${r.bestDebut.position}</span>
        </a>
      `);
    }
    if (movers.length) parts.push(`<div class="recap-movers">${movers.join('')}</div>`);
    else parts.push(`<div class="empty-state">Not enough movement recorded for ${year} yet.</div>`);

    bodyEl.innerHTML = parts.join('');
    showBanner(`${year}${year === thisYear() ? ' so far' : ''}.`);
  }

  function yearButton(year) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn-ghost recap-year-btn';
    btn.textContent = String(year);
    btn.addEventListener('click', () => {
      yearsEl.querySelectorAll('.recap-year-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      render(year);
    });
    return btn;
  }

  async function init() {
    bodyEl.innerHTML = `<div class="empty-state">Loading position history…</div>`;
    try {
      [history, names] = await Promise.all([PositionHistory.getAllHistory(), PositionHistory.getNames()]);

      earliestYear = thisYear();
      for (const entries of Object.values(history)) {
        if (entries.length) {
          const y = parseInt(entries[0].date.slice(0, 4), 10);
          if (Number.isFinite(y) && y < earliestYear) earliestYear = y;
        }
      }

      for (let y = thisYear(); y >= earliestYear; y--) yearsEl.appendChild(yearButton(y));
      yearsEl.firstElementChild?.classList.add('active');
      render(thisYear());
    } catch (err) {
      bodyEl.innerHTML = '';
      showBanner(`Couldn't load position history: ${escapeHtml(err.message)}`, true);
    }
  }

  init();
})();
