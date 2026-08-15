/* =====================================================================
   TIME MACHINE PAGE CONTROLLER

   Reconstructs the top CONFIG.LIST_SIZE as of any past date, purely from
   data/position-history.json (js/position-history.js) — no extra network
   call needed once that's loaded, since the full simulated history
   already has every level's position at every point in time it changed
   (see scripts/backfill-position-history.mjs's header for how that's
   built). For a given date, a level's position is whatever its most
   recent entry *on or before* that date says — entries are stored
   oldest-first per level, so this is a simple forward scan per level,
   stopping at the first entry past the target date.

   "Current" (for the vs.-today delta column) reuses the exact same
   snapshotAt() against today's date rather than a fresh AREDL fetch —
   one code path for both, and no extra request.
   ===================================================================== */

(() => {
  const dateInput = document.getElementById('tm-date');
  const form = document.getElementById('tm-form');
  const quickJumps = document.getElementById('tm-quick-jumps');
  const rangeNote = document.getElementById('tm-range-note');
  const stateBanner = document.getElementById('state-banner');
  const listEl = document.getElementById('tm-list');

  let history = null;
  let names = null;
  let earliestDate = null; // YYYY-MM-DD across all entries — the Time Machine can't show anything before this

  function showBanner(msg, isError = false) {
    stateBanner.innerHTML = msg;
    stateBanner.className = 'state-banner' + (isError ? ' error' : '');
    stateBanner.style.display = msg ? 'block' : 'none';
  }

  function todayStr() { return new Date().toISOString().slice(0, 10); }

  /** [{id, position}, ...] sorted by position — every level whose most recent entry on or before `dateStr` puts it at <= CONFIG.LIST_SIZE. */
  function snapshotAt(dateStr) {
    const rows = [];
    for (const [id, entries] of Object.entries(history)) {
      let match = null;
      for (const e of entries) {
        if (e.date > dateStr) break; // entries are oldest-first, so nothing past this point can still qualify
        match = e;
      }
      if (match && match.position <= CONFIG.LIST_SIZE) rows.push({ id, position: match.position });
    }
    rows.sort((a, b) => a.position - b.position);
    return rows;
  }

  function rowHtml(row, currentPositionById, index) {
    const name = names[row.id] || 'Unknown level';
    const currentPos = currentPositionById.get(row.id);
    let deltaHtml;
    if (currentPos === undefined) {
      deltaHtml = `<span class="tm-delta dropped">Legacy</span>`;
    } else if (currentPos === row.position) {
      deltaHtml = `<span class="tm-delta same">still #${currentPos}</span>`;
    } else if (currentPos < row.position) {
      deltaHtml = `<span class="tm-delta up">&uarr; now #${currentPos}</span>`;
    } else {
      deltaHtml = `<span class="tm-delta down">&darr; now #${currentPos}</span>`;
    }
    return `
      <a class="tm-row" href="level.html#id=${encodeURIComponent(row.id)}" style="--i:${index}">
        <span class="tm-pos">#${row.position}</span>
        <span class="tm-name">${escapeHtml(name)}</span>
        ${deltaHtml}
      </a>
    `;
  }

  function render(dateStr) {
    if (dateStr < earliestDate) {
      listEl.innerHTML = '';
      showBanner(`Earliest available date is ${escapeHtml(earliestDate)}.`, true);
      return;
    }
    const rows = snapshotAt(dateStr);
    if (!rows.length) {
      listEl.innerHTML = `<div class="empty-state">No levels were tracked yet as of this date.</div>`;
      showBanner('');
      return;
    }
    const currentRows = dateStr === todayStr() ? rows : snapshotAt(todayStr());
    const currentPositionById = new Map(currentRows.map(r => [r.id, r.position]));
    listEl.innerHTML = rows.map((r, i) => rowHtml(r, currentPositionById, i)).join('');
    showBanner(`Top ${rows.length} on ${escapeHtml(dateStr)}, vs. today.`);
  }

  function goTo(dateStr) {
    dateInput.value = dateStr;
    render(dateStr);
  }

  function quickJumpButton(label, dateStr) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn-ghost tm-quick-btn';
    btn.textContent = label;
    btn.addEventListener('click', () => goTo(dateStr));
    return btn;
  }

  function daysAgo(n) {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return d.toISOString().slice(0, 10);
  }

  async function init() {
    listEl.innerHTML = `<div class="empty-state">Loading position history…</div>`;
    try {
      [history, names] = await Promise.all([PositionHistory.getAllHistory(), PositionHistory.getNames()]);

      earliestDate = todayStr();
      for (const entries of Object.values(history)) {
        if (entries.length && entries[0].date < earliestDate) earliestDate = entries[0].date;
      }

      dateInput.min = earliestDate;
      dateInput.max = todayStr();
      rangeNote.textContent = `Earliest available: ${earliestDate}`;

      quickJumps.append(
        quickJumpButton('Today', todayStr()),
        quickJumpButton('1 year ago', clampDate(daysAgo(365))),
        quickJumpButton('2 years ago', clampDate(daysAgo(730))),
        quickJumpButton('Earliest available', earliestDate),
      );

      const initial = clampDate(daysAgo(365));
      goTo(initial);
    } catch (err) {
      listEl.innerHTML = '';
      showBanner(`Couldn't load position history: ${escapeHtml(err.message)}`, true);
    }
  }

  function clampDate(dateStr) {
    if (dateStr < earliestDate) return earliestDate;
    if (dateStr > todayStr()) return todayStr();
    return dateStr;
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!dateInput.value) return;
    render(clampDate(dateInput.value));
  });

  init();
})();
