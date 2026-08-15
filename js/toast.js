/* =====================================================================
   TOAST

   A minimal, stacking, self-dismissing notification — site-wide (loaded
   on every page, like the shortcuts panel), for anything that needs a
   brief "something just happened" callout that isn't worth a full
   .state-banner (which is page-specific and persists until replaced).
   Currently only js/completion.js's milestone celebrations use this,
   but it's deliberately generic rather than baked into that file.
   ===================================================================== */

const Toast = (() => {
  let container = null;
  function ensureContainer() {
    if (container) return container;
    container = document.createElement('div');
    container.className = 'toast-stack';
    document.body.appendChild(container);
    return container;
  }

  function show(message, { duration = 4000 } = {}) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = message;
    ensureContainer().appendChild(el);
    requestAnimationFrame(() => el.classList.add('visible'));
    const remove = () => {
      el.classList.remove('visible');
      el.addEventListener('transitionend', () => el.remove(), { once: true });
    };
    setTimeout(remove, duration);
    el.addEventListener('click', remove);
  }

  return { show };
})();
