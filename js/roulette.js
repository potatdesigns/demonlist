/* =====================================================================
   DEMONLIST ROULETTE

   A more theatrical alternative to js/nav-actions.js's instant "Random
   level" button — same underlying pick (a uniform random rank), but
   revealed through a slot-reel spin instead of an immediate redirect.
   Self-mounting modal, built once on first open() and reused after
   that (same lazy-build-then-toggle pattern as js/settings.js's panel).
   Requires js/api-aredl.js and js/utils.js to already be loaded.
   ===================================================================== */

const Roulette = (() => {
  let overlay, reelTrack, resultEl, spinBtn, viewLink, spinning = false;

  function build() {
    overlay = document.createElement('div');
    overlay.className = 'roulette-overlay';
    overlay.innerHTML = `
      <div class="roulette-panel" role="dialog" aria-modal="true" aria-label="Demonlist Roulette">
        <div class="roulette-head">
          <h2>Demonlist Roulette</h2>
          <button type="button" class="roulette-close icon-btn" aria-label="Close">&times;</button>
        </div>
        <p class="roulette-sub">Spin for a random level, main list or extended.</p>
        <div class="roulette-reel-wrap"><div class="roulette-reel" id="roulette-reel"></div></div>
        <div class="roulette-result" id="roulette-result" style="display:none;"></div>
        <div class="roulette-actions">
          <button type="button" class="btn-primary" id="roulette-spin">Spin</button>
          <a class="btn-ghost" id="roulette-view" style="display:none;" href="#">View level &rarr;</a>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    reelTrack = overlay.querySelector('#roulette-reel');
    resultEl = overlay.querySelector('#roulette-result');
    spinBtn = overlay.querySelector('#roulette-spin');
    viewLink = overlay.querySelector('#roulette-view');

    overlay.querySelector('.roulette-close').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && overlay.classList.contains('open')) close(); });
    spinBtn.addEventListener('click', spin);
  }

  function open() {
    if (!overlay) build();
    overlay.classList.add('open');
    if (!reelTrack.children.length) spin(); // spin on first open rather than showing an empty reel
  }
  function close() { overlay?.classList.remove('open'); }

  const CELL_H = 56;
  const REEL_LEN = 30; // long enough that the slow-down reads as a real spin, short enough it doesn't feel laggy

  async function spin() {
    if (spinning) return;
    spinning = true;
    spinBtn.disabled = true;
    resultEl.style.display = 'none';
    viewLink.style.display = 'none';

    const total = await AredlAPI.getTotalCount().catch(() => 0);
    if (!total) { spinning = false; spinBtn.disabled = false; return; }
    const target = 1 + Math.floor(Math.random() * total);

    const values = Array.from({ length: REEL_LEN - 1 }, () => 1 + Math.floor(Math.random() * total));
    values.push(target);
    reelTrack.innerHTML = values.map(v => `<div class="roulette-cell">#${v}</div>`).join('');

    reelTrack.style.transition = 'none';
    reelTrack.style.transform = 'translateY(0)';
    void reelTrack.offsetHeight; // force reflow so the reset above isn't itself animated
    const finalOffset = -(values.length - 1) * CELL_H;
    requestAnimationFrame(() => {
      reelTrack.style.transition = 'transform 3s cubic-bezier(.1,.85,.15,1)';
      reelTrack.style.transform = `translateY(${finalOffset}px)`;
    });

    reelTrack.addEventListener('transitionend', async function onDone() {
      reelTrack.removeEventListener('transitionend', onDone);
      spinning = false;
      spinBtn.disabled = false;
      spinBtn.textContent = 'Spin again';
      viewLink.href = `level.html#${target}`;
      viewLink.style.display = '';

      try {
        const demon = await AredlAPI.getByPosition(target);
        resultEl.innerHTML = demon ? `
          <div class="roulette-pick">
            <span class="roulette-pick-rank">#${demon.position ?? target}</span>
            <span class="roulette-pick-name">${escapeHtml(demon.name)}</span>
          </div>
        ` : '';
        resultEl.style.display = demon ? '' : 'none';
      } catch { /* the reel's own #N and the View link both already work without this */ }
    }, { once: true });
  }

  return { open, close };
})();
