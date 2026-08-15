/* =====================================================================
   KEYBOARD SHORTCUTS

   Ctrl+Alt+<letter> for the navigation shortcuts (M/E/Q/R/S) — a combo
   browsers/OSes essentially never reserve, unlike a bare letter (which
   can misfire while just typing/browsing normally outside a tracked
   text field) or a single-modifier Ctrl+letter (which collides with
   real bindings — tab-close, window-minimize, address-bar search —
   that JS can't reliably override, and some of which are intercepted
   before a page ever sees the keydown at all; that was the first cut
   of this feature). Alt alone is its own hazard on Windows (menu
   access-key accelerators), but requiring Ctrl *together with* Alt
   sidesteps that too. '?' stays a bare key on its own, deliberately —
   it's not a letter, so none of the above applies, and "press ? for
   help" is an established enough convention (GitHub, Gmail, Slack) to
   keep as-is rather than burying it behind a modifier. Site-wide
   (included on every page) so the shortcuts work no matter which page
   you're on; each one degrades to a full navigation when it can't just
   update the current page in place (see go() below). 'r' calls into
   js/nav-actions.js (NavActions.goToRandomLevel — loaded ahead of this
   script wherever this script is), which also owns the equivalent
   header button.
   ===================================================================== */

(() => {
  const SHORTCUTS = [
    { keys: ['Ctrl', 'Alt', 'M'], label: 'Main list' },
    { keys: ['Ctrl', 'Alt', 'E'], label: 'Extended list' },
    { keys: ['Ctrl', 'Alt', 'Q'], label: 'Queue' },
    { keys: ['Ctrl', 'Alt', 'R'], label: 'Random level' },
    { keys: ['Ctrl', 'Alt', 'S'], label: 'Stats' },
    { keys: ['Ctrl', 'Alt', 'T'], label: 'Time Machine' },
    { keys: ['?'], label: 'Toggle this panel' },
  ];

  const onIndex = !!document.getElementById('demon-grid');
  const onQueue = !!document.getElementById('queue-list');
  const onTimeMachine = !!document.getElementById('timemachine-root');

  function go(hash) {
    if (onIndex) {
      // Same document — set the hash directly so list.js's own
      // hashchange listener re-syncs in place, no reload.
      window.location.hash = hash;
    } else {
      window.location.href = `list.html#${hash}`;
    }
  }

  function goQueue() {
    if (!onQueue) window.location.href = 'queue.html';
  }

  function goStats() {
    if (!window.location.pathname.endsWith('stats.html')) window.location.href = 'stats.html';
  }

  function goTimeMachine() {
    if (!onTimeMachine) window.location.href = 'timemachine.html';
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
        ${SHORTCUTS.map(s => `<li><span>${s.label}</span><span class="shortcuts-combo">${s.keys.map(k => `<span class="shortcuts-key">${k}</span>`).join('<span class="shortcuts-plus">+</span>')}</span></li>`).join('')}
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
    if (e.key === 'Escape' && overlay.classList.contains('open')) { closePanel(); return; }
    if (isTyping(e.target)) return;

    // '?' alone — see the file header for why this one stays unmodified.
    if (!e.ctrlKey && !e.altKey && !e.metaKey && e.key === '?') { togglePanel(); return; }

    // Everything else needs Ctrl+Alt, and only Ctrl+Alt — Shift/Meta
    // riding along would just be a different, unintended combo.
    if (!e.ctrlKey || !e.altKey || e.shiftKey || e.metaKey) return;
    switch (e.key.toLowerCase()) {
      case 'm': go('main'); break;
      case 'e': go('extended'); break;
      case 'q': goQueue(); break;
      case 'r': NavActions.goToRandomLevel(); break;
      case 's': goStats(); break;
      case 't': goTimeMachine(); break;
      default: return;
    }
    e.preventDefault();
  });
})();
