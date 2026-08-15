/* =====================================================================
   PERSONAL COMPLETION TRACKER

   Purely client-side, localStorage-only "have I beaten this?" checklist —
   no account, no server, nothing leaves the browser. Same load-once
   in-memory-state + subscribe() shape as js/settings.js, so anything on
   the page (a card's toggle button, a progress stat) can react to a
   change without polling. Keyed by AREDL level id, not position — a
   completion mark should survive that level moving around the list.
   ===================================================================== */

const Completion = (() => {
  function load() {
    try {
      const parsed = JSON.parse(localStorage.getItem(CONFIG.STORAGE.COMPLETION) || '{}');
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  let state = load(); // { levelId: isoTimestamp }
  const listeners = new Set();

  function persist() {
    try { localStorage.setItem(CONFIG.STORAGE.COMPLETION, JSON.stringify(state)); }
    catch { /* storage full/disabled — toggle still works for this page load, just won't stick */ }
  }

  function isDone(id) { return !!state[id]; }
  function completedAt(id) { return state[id] || null; }
  function count() { return Object.keys(state).length; }

  function set(id, done) {
    if (done === isDone(id)) return;
    if (done) state[id] = new Date().toISOString();
    else delete state[id];
    persist();
    listeners.forEach(fn => fn(id, done));
  }
  function toggle(id) { set(id, !isDone(id)); }

  /** Called whenever a mark changes — (id, isDoneNow) — so e.g. a progress stat can re-render without polling. */
  function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }

  return { isDone, completedAt, count, set, toggle, subscribe };
})();
