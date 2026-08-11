/* =====================================================================
   BACK TO TOP

   A floating button that fades in once you've scrolled down a bit and
   jumps back to the top of the page. Bottom-left, deliberately — the
   keyboard-shortcuts "?" FAB (js/shortcuts.js) already lives bottom-
   right on every page, and the two would otherwise collide. Doesn't
   specify a scroll behavior itself; window.scrollTo(0, 0) with no
   `behavior` option follows <html>'s own scroll-behavior (smooth
   normally, auto under reduce-motion — see css/base.css), so this
   automatically respects that setting instead of needing its own copy
   of the same check.
   ===================================================================== */

(() => {
  const SHOW_AFTER = 400; // px scrolled before the button appears

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'back-to-top-fab';
  btn.setAttribute('aria-label', 'Back to top');
  btn.title = 'Back to top';
  btn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5"/><path d="M5 12l7-7 7 7"/></svg>`;
  btn.addEventListener('click', () => window.scrollTo(0, 0));
  document.body.appendChild(btn);

  function update() {
    btn.classList.toggle('visible', window.scrollY > SHOW_AFTER);
  }
  window.addEventListener('scroll', update, { passive: true });
  update();
})();
