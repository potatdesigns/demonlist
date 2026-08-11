/* =====================================================================
   EXTREME DEMON ROULETTE (roulette.html)

   The actual community challenge format (created by npesta, 2020 — see
   aredl.net/games/roulette and matcool.github.io/extreme-demon-roulette
   for the reference implementations this follows), not a random-level
   picker: levels come up one at a time in random order from a chosen
   range, the percent you need to clear starts at 1% and climbs by 1%
   every level you pass — or to whatever you actually got, plus 1%, if
   you beat the requirement by more than that. Miss the requirement and
   the run's over; reach 100% on a level and it's a win ("GG"). This
   site can't see into an actual Geometry Dash run, so it's a picker +
   tracker: you play the level for real, then report back what percent
   you got.

   The whole run — range, remaining pool, history, current level and
   required percent — is saved to localStorage
   (CONFIG.STORAGE.ROULETTE_RUN) after every step, so a reload mid-run
   (these can span a long time) resumes exactly where it left off
   instead of losing progress.
   ===================================================================== */

(() => {
  const setupEl = document.getElementById('roulette-setup');
  const playEl = document.getElementById('roulette-play');
  const endEl = document.getElementById('roulette-end');
  const startBtn = document.getElementById('roulette-start');
  const rangeGroup = document.getElementById('roulette-range');

  const currentCardEl = document.getElementById('roulette-current-card');
  const requiredEl = document.getElementById('roulette-required');
  const scoreEl = document.getElementById('roulette-score');
  const achievedInput = document.getElementById('roulette-achieved-input');
  const submitBtn = document.getElementById('roulette-submit');
  const giveUpBtn = document.getElementById('roulette-giveup');
  const historyList = document.getElementById('roulette-history-list');
  const historyCardEl = document.getElementById('roulette-history-card');

  const endTitleEl = document.getElementById('roulette-end-title');
  const endScoreEl = document.getElementById('roulette-end-score');
  const playAgainBtn = document.getElementById('roulette-play-again');

  let range = 'main';
  let allDemons = null; // cached full top-150 list (position/name/id), fetched once

  function rangeDemons(demons, r) {
    if (r === 'main') return demons.filter(d => d.position <= 75);
    if (r === 'extended') return demons.filter(d => d.position > 75);
    return demons;
  }

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // --- persistence ---

  function loadRun() {
    try { return JSON.parse(localStorage.getItem(CONFIG.STORAGE.ROULETTE_RUN) || 'null'); }
    catch { return null; }
  }
  function saveRun(run) {
    try { localStorage.setItem(CONFIG.STORAGE.ROULETTE_RUN, JSON.stringify(run)); }
    catch { /* storage full/disabled — run still works this session, just won't resume after a reload */ }
  }
  function clearRun() {
    try { localStorage.removeItem(CONFIG.STORAGE.ROULETTE_RUN); } catch { /* nothing to clean up then */ }
  }

  let run = loadRun();

  // --- rendering ---

  function show(el) { el.style.display = ''; }
  function hide(el) { el.style.display = 'none'; }

  function renderSetup() {
    hide(playEl); hide(endEl); hide(historyCardEl); show(setupEl);
  }

  function historyRowHtml(entry) {
    return `
      <li>
        <a class="roulette-history-row ${entry.passed ? 'passed' : 'failed'}" href="level.html#${entry.position}">
          <span class="roulette-history-rank">#${entry.position}</span>
          <span class="roulette-history-name">${escapeHtml(entry.name)}</span>
          <span class="roulette-history-pct">${entry.achieved}% <span class="roulette-history-req">(needed ${entry.required}%)</span></span>
          <span class="roulette-history-result">${entry.passed ? '✓' : '✗'}</span>
        </a>
      </li>
    `;
  }

  function renderHistory() {
    if (!historyList) return;
    if (!run.played.length) { historyList.innerHTML = `<li class="chart-empty">No levels played yet.</li>`; return; }
    historyList.innerHTML = run.played.slice().reverse().map(historyRowHtml).join('');
  }

  async function renderCurrentCard() {
    if (!run.current) return;
    currentCardEl.innerHTML = `<div class="demon-card skeleton-card" aria-hidden="true"><div class="skeleton card-thumb-wrap"></div></div>`;
    let demon;
    try { demon = await AredlAPI.getByPosition(run.current.position); } catch { /* fall through to the plain fallback below */ }
    if (!demon) {
      currentCardEl.innerHTML = `<div class="chart-empty">#${run.current.position} — couldn't load details, but you can still play it.</div>`;
      return;
    }
    // getByPosition() only returns {id, name} — fetchExtras() below fills in the rest (thumbnail, video, creators) the same way a list card hydrates.
    let full = demon;
    try { full = await AredlAPI.fetchExtras(demon.id); } catch { /* the name/rank alone below is still enough to go play it */ }
    const tierColor = positionColor(run.current.position, CONFIG.LIST_SIZE);
    const thumb = (full.videoUrl && youTubeThumbnailHQ(full.videoUrl)) || full.thumbnail || 'data:image/svg+xml;utf8,' + encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="360"><rect width="100%" height="100%" fill="#12151f"/></svg>`
    );
    const creatorsList = full.creators?.length ? full.creators : [full.publisher].filter(Boolean);
    currentCardEl.innerHTML = `
      <a class="demon-card" style="--tier-color:${tierColor}" href="level.html#${run.current.position}" target="_blank" rel="noopener">
        <div class="card-thumb-wrap">
          <img src="${thumb}" alt="${escapeHtml(full.name)} thumbnail" loading="lazy" crossorigin="anonymous" onerror="this.style.opacity=0">
          <span class="card-rank">#${run.current.position}</span>
        </div>
        <div class="card-body">
          <div class="card-title">${escapeHtml(full.name)}</div>
          <div class="card-meta"><span><strong>By</strong> ${escapeHtml(joinNames(creatorsList))}</span></div>
        </div>
      </a>
    `;
    if (full.videoUrl) resolveThumbnailColor(currentCardEl.querySelector('img'), color => {
      if (color) currentCardEl.querySelector('.demon-card').style.setProperty('--tier-color', color);
    }, youTubeThumbnail(full.videoUrl));
  }

  function renderPlay() {
    hide(setupEl); hide(endEl); show(playEl); show(historyCardEl);
    requiredEl.textContent = `${run.current.required}%`;
    scoreEl.textContent = String(run.played.filter(p => p.passed).length);
    achievedInput.value = '';
    achievedInput.min = String(run.current.required);
    achievedInput.focus();
    renderCurrentCard();
    renderHistory();
  }

  function renderEnd() {
    hide(setupEl); hide(playEl); show(endEl); show(historyCardEl);
    const cleared = run.played.filter(p => p.passed).length;
    if (run.status === 'won') {
      endTitleEl.textContent = 'GG';
      endTitleEl.className = 'roulette-end-title won';
    } else {
      endTitleEl.textContent = 'Run over';
      endTitleEl.className = 'roulette-end-title lost';
    }
    endScoreEl.textContent = `Cleared ${cleared} level${cleared === 1 ? '' : 's'}.`;
    renderHistory();
  }

  function render() {
    if (!run || run.status === 'idle') { renderSetup(); return; }
    if (run.status === 'playing') { renderPlay(); return; }
    renderEnd();
  }

  // --- actions ---

  async function startRun() {
    startBtn.disabled = true;
    try {
      if (!allDemons) {
        const { demons } = await AredlAPI.fetchListed({ limit: CONFIG.LIST_SIZE, offset: 0 });
        allDemons = demons;
      }
      const pool = shuffle(rangeDemons(allDemons, range).map(d => d.position));
      if (!pool.length) return;
      const first = pool.shift();
      run = { range, pool, played: [], current: { position: first, required: 1 }, status: 'playing' };
      saveRun(run);
      render();
    } finally {
      startBtn.disabled = false;
    }
  }

  function submitAchieved() {
    const achieved = parseInt(achievedInput.value, 10);
    if (!Number.isFinite(achieved) || achieved < 0 || achieved > 100) return;
    const { position, required } = run.current;
    const passed = achieved >= required;

    AredlAPI.getByPosition(position).then(demon => {
      run.played.push({ position, name: demon?.name || `Rank #${position}`, required, achieved, passed });

      if (!passed) {
        run.status = 'lost';
        run.current = null;
      } else if (achieved >= 100) {
        run.status = 'won';
        run.current = null;
      } else if (run.pool.length) {
        const nextRequired = Math.max(required, achieved) + 1;
        const nextPosition = run.pool.shift();
        run.current = { position: nextPosition, required: nextRequired };
      } else {
        // Cleared every level in the chosen range without hitting 100% on the last one — nothing left to spin, so the run ends as a win.
        run.status = 'won';
        run.current = null;
      }
      saveRun(run);
      render();
    });
  }

  function giveUp() {
    run.status = 'lost';
    run.current = null;
    saveRun(run);
    render();
  }

  function playAgain() {
    run = null;
    clearRun();
    render();
  }

  rangeGroup?.querySelectorAll('.settings-btn-opt').forEach(btn => {
    btn.addEventListener('click', () => {
      range = btn.dataset.value;
      rangeGroup.querySelectorAll('.settings-btn-opt').forEach(b => b.classList.toggle('active', b === btn));
    });
  });
  startBtn?.addEventListener('click', startRun);
  submitBtn?.addEventListener('click', submitAchieved);
  achievedInput?.addEventListener('keydown', e => { if (e.key === 'Enter') submitAchieved(); });
  giveUpBtn?.addEventListener('click', giveUp);
  playAgainBtn?.addEventListener('click', playAgain);

  if (!run) run = { status: 'idle' };
  render();
})();
