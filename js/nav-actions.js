/* =====================================================================
   NAV ACTIONS

   Small header-area icon buttons, self-mounting into #header-actions
   wherever it exists (index.html + level.html + stats.html — queue.html
   has no such slot, deliberately, see queue.html's own notes on staying
   unlinked): "Random level" everywhere it mounts, "Copy link" on
   level.html only (there's nothing level-specific to link to from the
   other pages), "Stats" everywhere except stats.html itself (no point
   linking a page to itself). All reuse the .icon-btn /
   .refresh-btn-wrap / .refresh-status popover styling already
   established by js/cache-admin-ui.js's refresh button rather than
   inventing new CSS for the same "small icon button with a temporary
   status popover" shape.

   goToRandomLevel() is also exported for js/shortcuts.js's Ctrl+Alt+R —
   the button and the shortcut are two entry points to the same action,
   not two separate features.
   ===================================================================== */

const NavActions = (() => {
  const SHUFFLE = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/><line x1="4" y1="4" x2="9" y2="9"/></svg>`;
  const LINK = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>`;
  const CHART = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/><line x1="6" y1="20" x2="6" y2="16"/></svg>`;
  const CHECK = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>`;
  const WARN = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4"/><circle cx="12" cy="12" r="9"/><path d="M12 16h.01"/></svg>`;

  async function goToRandomLevel() {
    const total = await AredlAPI.getTotalCount().catch(() => 0);
    if (!total) return;
    const position = 1 + Math.floor(Math.random() * total);
    window.location.href = `level.html#${position}`;
  }

  function mountRandomButton(container) {
    if (!container) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'icon-btn';
    btn.setAttribute('aria-label', 'Random level');
    btn.title = 'Random level (Ctrl+Alt+R)';
    btn.innerHTML = SHUFFLE;
    btn.addEventListener('click', () => goToRandomLevel());
    container.appendChild(btn);
  }

  function mountStatsButton(container) {
    if (!container) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'icon-btn';
    btn.setAttribute('aria-label', 'Stats');
    btn.title = 'Stats (Ctrl+Alt+S)';
    btn.innerHTML = CHART;
    btn.addEventListener('click', () => { window.location.href = 'stats.html'; });
    container.appendChild(btn);
  }

  function mountCopyLinkButton(container) {
    if (!container) return;
    const wrap = document.createElement('span');
    wrap.className = 'refresh-btn-wrap';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'icon-btn';
    btn.setAttribute('aria-label', 'Copy link to this level');
    btn.title = 'Copy link';
    btn.innerHTML = LINK;

    const statusEl = document.createElement('div');
    statusEl.className = 'refresh-status';
    statusEl.setAttribute('role', 'status');

    function flash(icon) {
      clearTimeout(btn._resetTimer);
      btn.innerHTML = icon;
      btn._resetTimer = setTimeout(() => { btn.innerHTML = LINK; }, 2000);
    }
    function showStatus(message, isError) {
      clearTimeout(statusEl._hideTimer);
      statusEl.textContent = message;
      statusEl.classList.toggle('error', !!isError);
      statusEl.classList.add('visible');
      statusEl._hideTimer = setTimeout(() => statusEl.classList.remove('visible'), 3000);
    }

    btn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(window.location.href);
        flash(CHECK);
        showStatus('Link copied.', false);
      } catch (err) {
        flash(WARN);
        showStatus(`Couldn't copy: ${err.message}`, true);
      }
    });

    wrap.appendChild(btn);
    wrap.appendChild(statusEl);
    container.appendChild(wrap);
  }

  const headerActions = document.getElementById('header-actions');
  if (headerActions) {
    if (document.getElementById('detail-root')) mountCopyLinkButton(headerActions);
    if (!document.getElementById('kpi-row')) mountStatsButton(headerActions);
    mountRandomButton(headerActions);
  }

  return { goToRandomLevel };
})();
