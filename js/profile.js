/* =====================================================================
   PROFILE PAGE CONTROLLER

   A dedicated page for one AREDL player — Verified / Completed / Created
   levels, addressed by name (profile.html#name=<name>, see profileLink()
   in js/utils.js, used everywhere a verifier/publisher/creator/completer
   name is shown as a link). Two independent data sources, since neither
   alone covers all three sections:
     - AredlAPI.searchByName() — level name/publisher/verifier/creators,
       for "Created" (publisher or any creator credit) and as a fallback
       identity check.
     - RecordsIndex.findPlayerByName() — every accepted record across the
       tracked list, already split into verified vs. not (see
       scripts/refresh-records-index.mjs for why the verifier has to be
       indexed separately from ordinary records at all), for "Verified"
       and "Completed".
   ===================================================================== */

(() => {
  const nameEl = document.getElementById('profile-name');
  const statsEl = document.getElementById('profile-stats');
  const stateBanner = document.getElementById('state-banner');
  const bodyEl = document.getElementById('profile-body');
  const verifiedSection = document.getElementById('profile-verified-section');
  const verifiedList = document.getElementById('profile-verified-list');
  const completedSection = document.getElementById('profile-completed-section');
  const completedList = document.getElementById('profile-completed-list');
  const createdSection = document.getElementById('profile-created-section');
  const createdList = document.getElementById('profile-created-list');

  function showBanner(msg, isError = false) {
    stateBanner.innerHTML = msg;
    stateBanner.className = 'state-banner' + (isError ? ' error' : '');
    stateBanner.style.display = msg ? 'block' : 'none';
  }

  function nameFromHash() {
    const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    return params.get('name');
  }

  // Full row links to the level's own detail page (which has this same
  // record's video linked from its Completions list) — not nesting a
  // second, separate video link inside it, same reason js/timemachine.js's
  // and js/recap.js's own single-link rows don't either.
  function levelRowHtml(level, index) {
    const dateLabel = level.achievedAt ? new Date(level.achievedAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '';
    return `
      <a class="profile-level-row" href="level.html#${level.position}" style="--i:${index}">
        <span class="profile-level-pos">#${level.position}</span>
        <span class="profile-level-name">${escapeHtml(level.levelName)}</span>
        ${dateLabel ? `<span class="profile-level-date">${escapeHtml(dateLabel)}</span>` : ''}
      </a>
    `;
  }

  function demonRowHtml(demon, index) {
    return `
      <a class="profile-level-row" href="level.html#${demon.position}" style="--i:${index}">
        <span class="profile-level-pos">#${demon.position}</span>
        <span class="profile-level-name">${escapeHtml(demon.name)}</span>
      </a>
    `;
  }

  function fillSection(listEl, sectionEl, rows) {
    if (!rows.length) { sectionEl.style.display = 'none'; return; }
    listEl.innerHTML = rows;
    sectionEl.style.display = '';
  }

  async function init() {
    const name = nameFromHash();
    if (!name) {
      showBanner('No profile given — open one by clicking a verifier, creator, or completer\'s name.', true);
      bodyEl.style.display = 'none';
      return;
    }

    document.title = `Demonlist | ${name}`;
    nameEl.textContent = name;
    [verifiedSection, completedSection, createdSection].forEach(s => s.style.display = 'none');

    try {
      const q = name.trim().toLowerCase();
      const [searchResult, player] = await Promise.all([
        AredlAPI.searchByName(name).catch(() => ({ demons: [] })),
        (typeof RecordsIndex !== 'undefined' ? RecordsIndex.findPlayerByName(name) : Promise.resolve(null)),
      ]);

      const createdDemons = searchResult.demons
        .filter(d => (d.publisher?.name || '').toLowerCase() === q || (d.creators || []).some(c => (c.name || '').toLowerCase() === q))
        .sort((a, b) => a.position - b.position);

      const verifiedLevels = (player?.levels || []).filter(l => l.verified).sort((a, b) => a.position - b.position);
      const completedLevels = (player?.levels || []).filter(l => !l.verified).sort((a, b) => a.position - b.position);

      if (!createdDemons.length && !verifiedLevels.length && !completedLevels.length) {
        showBanner(`No AREDL player named "${escapeHtml(name)}" found on the tracked list.`, true);
        bodyEl.style.display = 'none';
        return;
      }
      showBanner('');

      const best = Math.min(
        ...verifiedLevels.map(l => l.position),
        ...completedLevels.map(l => l.position),
        ...createdDemons.map(d => d.position),
      );
      statsEl.innerHTML = `
        <div class="profile-stat"><span class="num">${verifiedLevels.length}</span><span>Verified</span></div>
        <div class="profile-stat"><span class="num">${completedLevels.length}</span><span>Completed</span></div>
        <div class="profile-stat"><span class="num">${createdDemons.length}</span><span>Created</span></div>
        <div class="profile-stat"><span class="num">#${best}</span><span>Best rank</span></div>
      `;

      fillSection(verifiedList, verifiedSection, verifiedLevels.map(levelRowHtml).join(''));
      fillSection(completedList, completedSection, completedLevels.map(levelRowHtml).join(''));
      fillSection(createdList, createdSection, createdDemons.map(demonRowHtml).join(''));
    } catch (err) {
      showBanner(`Couldn't load this profile: ${escapeHtml(err.message)}`, true);
      bodyEl.style.display = 'none';
    }
  }

  window.addEventListener('hashchange', init);
  init();
})();
