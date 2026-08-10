/* =====================================================================
   KEYBOARD SHORTCUTS

   Plain, unmodified letter keys (m/e/q/r) rather than the Ctrl-combo the
   idea started as — Ctrl+Q/M/E collide with real browser/OS bindings
   (tab-close, window-minimize, address-bar search, ...) that JS can't
   reliably override, and some are intercepted before a page ever sees
   the keydown at all. A bare letter key is never reserved by the
   browser and is the same pattern GitHub/Gmail/YouTube use for exactly
   this reason. Site-wide (included on index/level/queue.html) so the
   shortcuts work no matter which page you're on; each one degrades to
   a full navigation when it can't just update the current page in
   place (see go() below). 'r' calls into js/nav-actions.js
   (NavActions.goToRandomLevel — loaded on all three pages, ahead of
   this script), which also owns the equivalent header button.
   ===================================================================== */

(() => {
  const SHORTCUTS = [
    { key: 'm', label: 'Main list' },
    { key: 'e', label: 'Extended list' },
    { key: 'q', label: 'Queue' },
    { key: 'r', label: 'Random level' },
    { key: '?', label: 'Toggle this panel' },
  ];

  const onIndex = !!document.getElementById('demon-grid');
  const onQueue = !!document.getElementById('queue-list');

  function go(hash) {
    if (onIndex) {
      // Same document — set the hash directly so list.js's own
      // hashchange listener re-syncs in place, no reload.
      window.location.hash = hash;
    } else {
      window.location.href = `index.html#${hash}`;
    }
  }

  function goQueue() {
    if (!onQueue) window.location.href = 'queue.html';
  }

  // --- floating "?" button + panel, built here rather than duplicated
  // markup in every HTML file ---
  const fab = document.createElement('button');
  fab.className = 'shortcuts-fab';
  fab.type = 'button';
  fab.setAttribute('aria-label', 'Keyboard shortcuts');
  fab.textContent = '?';

  const overlay = document.createElement('div');
  overlay.className = 'shortcuts-overlay';
  overlay.innerHTML = `
    <div class="shortcuts-panel" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts">
      <button type="button" class="shortcuts-close icon-btn" aria-label="Close">&times;</button>
      <h2>Keyboard shortcuts</h2>
      <p class="shortcuts-sub">Not active while typing in a text field.</p>
      <ul class="shortcuts-list">
        ${SHORTCUTS.map(s => `<li><span>${s.label}</span><span class="shortcuts-key">${s.key === '?' ? '?' : s.key.toUpperCase()}</span></li>`).join('')}
      </ul>
    </div>
  `;

  document.body.append(fab, overlay);

  function openPanel() { overlay.classList.add('open'); }
  function closePanel() { overlay.classList.remove('open'); }
  function togglePanel() { overlay.classList.toggle('open'); }

  fab.addEventListener('click', openPanel);
  overlay.querySelector('.shortcuts-close').addEventListener('click', closePanel);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closePanel(); });

  function isTyping(target) {
    return /^(input|textarea|select)$/i.test(target.tagName) || target.isContentEditable;
  }

  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.altKey || e.metaKey) return;

    if (e.key === 'Escape' && overlay.classList.contains('open')) { closePanel(); return; }
    if (isTyping(e.target)) return;

    switch (e.key) {
      case '?': togglePanel(); break;
      case 'm': case 'M': go('main'); break;
      case 'e': case 'E': go('extended'); break;
      case 'q': case 'Q': goQueue(); break;
      case 'r': case 'R': NavActions.goToRandomLevel(); break;
      default: return;
    }
  });
})();
