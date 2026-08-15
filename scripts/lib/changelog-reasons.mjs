/* =====================================================================
   CHANGELOG REASON TEXT

   Shared by scripts/backfill-position-history.mjs (full changelog
   simulation) and scripts/refresh-aredl-cache.mjs (hourly incremental
   diffing) so a position-history entry's `reason` field reads the same
   regardless of which script produced it. Mirrors the vocabulary AREDL's
   own changelog action types use (Placed/Raised/Lowered/Swapped/
   MovedToLegacy/MovedFromLegacy/Removed) rather than inventing new
   phrasing.
   ===================================================================== */

/** Reason text for the level a changelog event was directly taken on. */
export function directReason(type, action) {
  switch (type) {
    case 'Placed':
      return action.legacy ? 'Placed in legacy' : `Placed at #${action.new_position}`;
    case 'Raised':
      return `Raised from #${action.old_position} to #${action.new_position}`;
    case 'Lowered':
      return `Lowered from #${action.old_position} to #${action.new_position}`;
    case 'MovedToLegacy':
      return `Moved to legacy (was #${action.old_position})`;
    case 'MovedFromLegacy':
      return `Moved from legacy to #${action.new_position}`;
    default:
      return null;
  }
}

/** Reason text for one side of a Swapped event — the two levels that traded adjacent slots. */
export function swapReason(otherName, fromPos, toPos) {
  return `Swapped with ${(otherName || 'another level').trim()} — moved from #${fromPos} to #${toPos}`;
}

/**
 * Reason text for a level that shifted only as a *side effect* of some
 * other level's direct action (a cascade) — e.g. everything between a
 * raised level's old and new position quietly moves down one slot too,
 * unlogged by AREDL itself. causeType/causeName/causePosition describe
 * the direct action that triggered it; movedDown says which way this
 * particular level moved as a result.
 */
export function cascadeReason(causeType, causeName, causePosition, movedDown) {
  const verb = movedDown ? 'Moved down' : 'Moved up';
  const name = (causeName || 'another level').trim();
  switch (causeType) {
    case 'Placed':
      return `${verb} — ${name} was placed at #${causePosition}`;
    case 'Raised':
      return `${verb} — ${name} was raised to #${causePosition}`;
    case 'Lowered':
      return `${verb} — ${name} was lowered to #${causePosition}`;
    case 'MovedToLegacy':
      return `${verb} — ${name} moved to legacy`;
    case 'MovedFromLegacy':
      return `${verb} — ${name} moved from legacy to #${causePosition}`;
    case 'Removed':
      return `${verb} — ${name} was removed from the list`;
    default:
      return verb;
  }
}
