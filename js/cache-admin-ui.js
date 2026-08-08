/* =====================================================================
   CACHE ADMIN UI
   A header link to the showcase-discovery workflow's GitHub Actions page,
   for manually kicking off a refresh instead of waiting for the daily
   schedule. It's just a link, not a one-click trigger — GitHub's
   workflow_dispatch API needs an authenticated request, and there's no
   safe way to expose that from a public static site (embedding a token
   client-side would let anyone trigger runs). Linking to the Actions
   page instead relies on GitHub's own auth: only someone signed in with
   write access to the repo can actually press "Run workflow" there, so
   it's safe to show this to every visitor.
   ===================================================================== */

const CacheAdminUI = (() => {
  function mountRefreshButton(container) {
    if (!container) return;
    const url = `https://github.com/${CONFIG.GITHUB_REPO}/actions/workflows/refresh-yt-cache.yml`;
    const btn = document.createElement('a');
    btn.className = 'icon-btn';
    btn.href = url;
    btn.target = '_blank';
    btn.rel = 'noopener';
    btn.setAttribute('aria-label', 'Update showcase cache');
    btn.title = 'Open the showcase-cache refresh workflow on GitHub (repo write access needed to actually run it)';
    btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/></svg>`;
    container.appendChild(btn);
  }

  return { mountRefreshButton };
})();
