/* =====================================================================
   POSITION HISTORY SIMULATOR

   The shared core behind both scripts/backfill-position-history.mjs
   (full replay from an empty list) and scripts/refresh-aredl-cache.mjs
   (incremental replay of just the newest changelog entries, seeded from
   the previous run's own final state) — one implementation instead of
   two, so a fix to the replay logic itself never has to be made twice.

   Replays changelog events against an in-memory ordered array
   (order[i] = level id at position i+1) using real splice-based insert/
   remove, so every level whose position actually shifts as a side
   effect — not just the one AREDL names as "affected" — gets a history
   entry, each carrying a human-readable `reason` (see
   scripts/lib/changelog-reasons.mjs) naming whichever direct action
   actually caused it. See backfill-position-history.mjs's own header
   for the full rationale (why a naive "just the affected level" replay
   badly undercounts, why events must replay in the backend's own
   insertion order rather than a created_at sort, and how this was
   validated against AREDL's live list).

   A Swapped event's *two* known participants (action.upper_level /
   action.other_level) both get a direct "Swapped with X" reason here —
   registering only whichever one AREDL's changelog happens to name as
   affected_level left the other one attributed to a *different*,
   unrelated cascade cause in the old hourly heuristic this replaced.
   ===================================================================== */

import { directReason, swapReason, cascadeReason } from './changelog-reasons.mjs';

/**
 * A stable identity for a changelog entry — used as the "have I already
 * processed this one?" cursor for an incremental replay.  created_at
 * alone isn't safe (entries can share a timestamp — see the header above
 * on why a created_at *sort* corrupts the simulation), so this folds in
 * the affected level and the action's own fields too.
 */
export function entryFingerprint(entry) {
  return `${entry.created_at}|${entry.affected_level?.id || ''}|${JSON.stringify(entry.action)}`;
}

/**
 * Creates a simulator seeded from a previous run's final state (or
 * nothing, for a from-scratch backfill). `seed` fields, all optional:
 *   - order: level ids, position 1 first (previous run's final order)
 *   - everTracked: ids that have ever qualified for tracking
 *   - levelNames: { id: name } accumulated so far
 *   - historyByLevel: { id: [{date,position,reason}, ...] } to append to
 *   - listSize: tracking boundary (defaults to 150, keep in sync with
 *     CONFIG.LIST_SIZE in js/config.js)
 */
export function createSimulator(seed = {}) {
  const order = seed.order ? seed.order.slice() : [];
  const everTracked = new Set(seed.everTracked || []);
  const levelNames = new Map(Object.entries(seed.levelNames || {}));
  const historyByLevel = seed.historyByLevel ? JSON.parse(JSON.stringify(seed.historyByLevel)) : {};
  const LEVEL_LIST_SIZE = seed.listSize || 150;

  const touchedIds = new Set(); // every id that got >=1 *new* entry during replay() calls on this simulator instance
  let directCount = 0, cascadeCount = 0, swapResolved = 0, swapSkipped = 0;

  function noteName(lvl) { if (lvl?.id && lvl.name) levelNames.set(lvl.id, lvl.name); }

  function recordIfChanged(id, date, position, reason) {
    if (!everTracked.has(id)) {
      if (position > LEVEL_LIST_SIZE) return;
      everTracked.add(id);
    }
    const list = historyByLevel[id] || (historyByLevel[id] = []);
    const last = list[list.length - 1];
    if (last && last.position === position) return;
    list.push({ date, position, reason });
    touchedIds.add(id);
  }

  function moveTo(id, newPos, date, directReasonText, cause) {
    const oldIdx = order.indexOf(id);
    if (oldIdx !== -1) order.splice(oldIdx, 1);
    const insertIdx = Math.max(0, Math.min(newPos - 1, order.length));
    order.splice(insertIdx, 0, id);
    if (directReasonText) { recordIfChanged(id, date, insertIdx + 1, directReasonText); directCount++; }
    // A brand-new insertion (oldIdx === -1) pushes every level from
    // insertIdx through the current end of the array down by one —
    // there's no "old position" to bound the range against, unlike a
    // move within the existing list.
    const lo = oldIdx === -1 ? insertIdx : Math.min(oldIdx, insertIdx);
    const hi = oldIdx === -1 ? order.length - 1 : Math.max(oldIdx, insertIdx);
    const movedDown = oldIdx === -1 ? true : insertIdx < oldIdx;
    const reason = cascadeReason(cause.type, cause.name, newPos, movedDown);
    for (let i = lo; i <= hi; i++) {
      if (i === insertIdx) continue;
      recordIfChanged(order[i], date, i + 1, reason);
      cascadeCount++;
    }
  }

  function applyEntry(entry) {
    const id = entry.affected_level?.id;
    noteName(entry.affected_level);
    noteName(entry.level_above);
    noteName(entry.level_below);
    if (!id) return;
    const date = entry.created_at.slice(0, 10);
    const [type, action] = Object.entries(entry.action || {})[0] || [null, {}];
    noteName(action.upper_level);
    noteName(action.other_level);

    if (type === 'Placed' || type === 'Raised' || type === 'Lowered' || type === 'MovedToLegacy' || type === 'MovedFromLegacy') {
      if (!Number.isFinite(action.new_position)) return;
      const name = levelNames.get(id) || entry.affected_level?.name;
      moveTo(id, action.new_position, date, directReason(type, action), { type, name });
    } else if (type === 'Removed') {
      const oldIdx = order.indexOf(id);
      if (oldIdx === -1) return;
      order.splice(oldIdx, 1);
      const name = levelNames.get(id) || entry.affected_level?.name;
      const reason = cascadeReason('Removed', name, null, false);
      for (let i = oldIdx; i < order.length; i++) {
        recordIfChanged(order[i], date, i + 1, reason);
        cascadeCount++;
      }
    } else if (type === 'Swapped') {
      // The event's own upper_position is authoritative regardless of
      // array contents — swap whatever two slots are physically at that
      // position, rather than trusting upper_level/other_level ids for
      // *which side* each participant landed on (that field pairing has
      // been observed to sometimes duplicate itself). The *names* of
      // the two participants are still trustworthy, and both get a
      // direct reason here — not just whichever one AREDL's changelog
      // happens to call affected_level.
      const upperPos = action.upper_position;
      const idxA = upperPos - 1, idxB = upperPos;
      if (idxA < 0 || idxB >= order.length) { swapSkipped++; return; }
      const idA = order[idxA], idB = order[idxB];
      order[idxA] = idB; order[idxB] = idA;
      recordIfChanged(idA, date, idxB + 1, swapReason(levelNames.get(idB), upperPos, upperPos + 1));
      recordIfChanged(idB, date, idxA + 1, swapReason(levelNames.get(idA), upperPos + 1, upperPos));
      swapResolved++;
    }
  }

  /** Replays entries, oldest-first (see backfill's header for why reversed-fetch-order rather than a created_at sort). */
  function replay(entries) {
    for (const entry of entries) applyEntry(entry);
  }

  function getState() {
    return {
      order: order.slice(),
      everTracked: [...everTracked],
      levelNames: Object.fromEntries(levelNames),
      historyByLevel,
      touchedIds: [...touchedIds],
      counters: { directCount, cascadeCount, swapResolved, swapSkipped },
    };
  }

  return { replay, applyEntry, getState };
}
