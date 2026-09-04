/* =====================================================================
   AREDL SYNC

   Not a login — there's no account, no OAuth, nothing server-side tied
   to a visitor. A visitor types their own AREDL display name, this
   matches it (case-insensitively) against data/records-index.json (see
   scripts/refresh-records-index.mjs) and marks every tracked level that
   name has an accepted record on as beaten in js/completion.js's
   personal tracker — same end state as clicking every one of those
   toggles by hand, just automatic. Purely a convenience layered on top
   of two things that already exist independently (the records index,
   the completion tracker); nothing new is stored about the visitor
   beyond the plain name string they typed, kept locally only so the
   Settings panel can show "synced as X" without asking again.
   ===================================================================== */

const AredlSync = (() => {
  function lastSyncedName() {
    try { return localStorage.getItem(CONFIG.STORAGE.AREDL_SYNC_NAME); }
    catch { return null; }
  }

  function rememberName(name) {
    try { localStorage.setItem(CONFIG.STORAGE.AREDL_SYNC_NAME, name); }
    catch { /* storage full/disabled — sync itself still worked, just won't be remembered for display */ }
  }

  /** Marks every level `name` has an accepted AREDL record on as beaten. Never *unmarks* anything — a visitor's own manual marks (or a level completed outside what AREDL's public records happen to show) are always additive, never overridden. */
  async function syncByName(name) {
    const player = await RecordsIndex.findPlayerByName(name);
    if (!player) return { found: false };

    let newlyMarked = 0;
    for (const level of player.levels) {
      if (!Completion.isDone(level.levelId)) newlyMarked++;
      Completion.set(level.levelId, true);
    }
    rememberName(player.name);
    return { found: true, name: player.name, totalLevels: player.levels.length, newlyMarked };
  }

  return { syncByName, lastSyncedName };
})();
