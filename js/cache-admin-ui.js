/* =====================================================================
   CACHE ADMIN UI
   A detail-page control for manually kicking off a refresh of one
   level's showcase/verifier videos instead of waiting for the daily
   discover cycle. It's a link + a clipboard copy, not a one-click
   trigger — GitHub's workflow_dispatch API needs an authenticated
   request, and there's no safe way to expose that from a public static
   site (embedding a token client-side would let anyone trigger runs).
   Linking to the Actions page instead relies on GitHub's own auth: only
   someone signed in with write access to the repo can actually press
   "Run workflow" there, so it's safe to show this to every visitor.

   Copies the level's AREDL internal id to the clipboard on click, since
   that's what refresh-yt-cache.yml's optional `target_level_id` input
   (see scripts/refresh-yt-cache.mjs) expects — sparing whoever runs it
   manually from having to go dig the id out of the URL themselves.
   ===================================================================== */

const CacheAdminUI = (() => {
  function mountLevelRefreshButton(container, levelId) {
    if (!container || levelId === undefined || levelId === null) return;
    const url = `https://github.com/${CONFIG.GITHUB_REPO}/actions/workflows/refresh-yt-cache.yml`;
    const defaultTitle = 'Copy this level\'s ID and open the refresh workflow (repo write access needed to actually run it)';
    const icon = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/></svg>`;
    const check = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>`;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'icon-btn';
    btn.setAttribute('aria-label', "Refresh this level's videos");
    btn.title = defaultTitle;
    btn.innerHTML = icon;

    let resetTimer = null;
    btn.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(String(levelId)); } catch { /* clipboard unavailable — still open the link */ }
      window.open(url, '_blank', 'noopener');

      clearTimeout(resetTimer);
      btn.innerHTML = check;
      btn.title = 'Level ID copied — paste it into "target_level_id" on the workflow page';
      resetTimer = setTimeout(() => { btn.innerHTML = icon; btn.title = defaultTitle; }, 2500);
    });

    container.appendChild(btn);
  }

  return { mountLevelRefreshButton };
})();
