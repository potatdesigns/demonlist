/* =====================================================================
   DEMONLIST ROULETTE (roulette.html)

   Weighted by rank, not uniform: level #150 is 150x more likely to come
   up than level #1, level #75 is 75x more likely, and so on — each
   position's weight is just its own rank number, so the odds climb
   linearly from #1 up to #CONFIG.LIST_SIZE (see weightedPosition()).
   Every spin is saved to localStorage (CONFIG.STORAGE.ROULETTE_HISTORY)
   so the recent-spins list survives a reload.
   ===================================================================== */

(() => {
  const reelTrack = document.getElementById('roulette-reel');
  const spinBtn = document.getElementById('roulette-spin');
  const resultEl = document.getElementById('roulette-result');
  const historyList = document.getElementById('roulette-history-list');
  const totalWeightEl = document.getElementById('roulette-total-weight');

  let spinning = false;

  /** Weight of position i is i itself — total weight is the sum 1+2+...+total, i.e. total*(total+1)/2 (Gauss's formula). */
  function totalWeightFor(total) { return total * (total + 1) / 2; }

  function weightedPosition(total) {
    const totalWeight = totalWeightFor(total);
    let r = Math.random() * totalWeight;
    for (let i = 1; i <= total; i++) {
      r -= i;
      if (r < 0) return i;
    }
    return total;
  }

  const HISTORY_KEY = CONFIG.STORAGE.ROULETTE_HISTORY;
  const HISTORY_MAX = 15;
  function loadHistory() {
    try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); }
    catch { return []; }
  }
  function saveHistory(list) {
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, HISTORY_MAX))); }
    catch { /* storage full/disabled — this spin just won't persist */ }
  }
  function pushHistory(entry) {
    const list = loadHistory();
    list.unshift(entry);
    saveHistory(list);
    renderHistory(list);
  }

  function renderHistory(list) {
    if (!historyList) return;
    if (!list.length) {
      historyList.innerHTML = `<li class="chart-empty">No spins yet.</li>`;
      return;
    }
    historyList.innerHTML = list.map(h => `
      <li>
        <a class="roulette-history-row" href="level.html#${h.position}">
          <span class="roulette-history-rank">#${h.position}</span>
          <span class="roulette-history-name">${escapeHtml(h.name)}</span>
          <span class="roulette-history-pct">${h.pct}%</span>
          <span class="roulette-history-time">${escapeHtml(timeAgo(h.at))}</span>
        </a>
      </li>
    `).join('');
  }

  const CELL_H = 64;
  const REEL_LEN = 32;

  async function spin() {
    if (spinning) return;
    spinning = true;
    spinBtn.disabled = true;
    resultEl.style.display = 'none';

    const total = await AredlAPI.getTotalCount().catch(() => 0);
    if (!total) { spinning = false; spinBtn.disabled = false; return; }
    const target = weightedPosition(total);
    const pct = (target / totalWeightFor(total) * 100).toFixed(2);

    const values = Array.from({ length: REEL_LEN - 1 }, () => weightedPosition(total));
    values.push(target);
    reelTrack.innerHTML = values.map(v => `<div class="roulette-cell">#${v}</div>`).join('');

    reelTrack.style.transition = 'none';
    reelTrack.style.transform = 'translateY(0)';
    void reelTrack.offsetHeight; // force reflow so the reset above isn't itself animated
    const finalOffset = -(values.length - 1) * CELL_H;
    requestAnimationFrame(() => {
      reelTrack.style.transition = 'transform 3.4s cubic-bezier(.1,.85,.15,1)';
      reelTrack.style.transform = `translateY(${finalOffset}px)`;
    });

    reelTrack.addEventListener('transitionend', async function onDone() {
      reelTrack.removeEventListener('transitionend', onDone);
      spinning = false;
      spinBtn.disabled = false;
      spinBtn.textContent = 'Spin again';

      let demon = null;
      try { demon = await AredlAPI.getByPosition(target); } catch { /* still show the rank below without a name */ }
      const name = demon?.name || `Rank #${target}`;
      const tierColor = positionColor(target, total);

      resultEl.style.display = '';
      resultEl.style.setProperty('--tier-color', tierColor);
      resultEl.innerHTML = `
        <div class="roulette-pick">
          <span class="roulette-pick-rank">#${target}</span>
          <span class="roulette-pick-name">${escapeHtml(name)}</span>
          <span class="roulette-pick-pct">${pct}% odds</span>
        </div>
        <a class="btn-primary" href="level.html#${target}">View level &rarr;</a>
      `;
      pushHistory({ position: target, name, pct, at: new Date().toISOString() });
    }, { once: true });
  }

  spinBtn?.addEventListener('click', spin);
  renderHistory(loadHistory());

  AredlAPI.getTotalCount().then(total => {
    if (totalWeightEl && total) totalWeightEl.textContent = `${total} levels tracked, ${totalWeightFor(total).toLocaleString()} total tickets in the drum.`;
  }).catch(() => {});
})();
