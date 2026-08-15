#!/usr/bin/env node
/* =====================================================================
   BACKFILL POSITION HISTORY (one-off / manual)

   scripts/refresh-aredl-cache.mjs's incremental hourly diffing only has
   data/position-history.json entries from whenever that feature first
   started running — nothing further back. This reconstructs the *real*
   history instead, straight from AREDL's own changelog (currently
   ~3200+ entries, going back to August 2022).

   Naively replaying only sets a history entry for whichever level each
   changelog event names as "affected" — but AREDL's changelog only logs
   the level an action was *directly* taken on, never the cascading
   shifts every other level in between experiences as a side effect
   (insert a level at #40 and everything from #40 to its old position
   quietly moves too, unlogged). That's most of a level's real position
   history, so this instead fully *simulates* the list: replays every
   changelog event in chronological order against an in-memory ordered
   array using real insert/remove semantics, and records a history entry
   for every level whose simulated position actually changes as a
   result — not just the one AREDL named. Swapped events are resolved by
   swapping the two array slots at the event's own position (authoritative
   regardless of array contents) rather than trying to match AREDL's
   `upper_level`/`other_level` fields, which have been observed to
   sometimes just duplicate each other.

   Events must replay in the backend's own insertion order, not a
   created_at sort — AREDL's API paginates newest-first off an internal
   serial column, and re-sorting by timestamp can silently reorder events
   that share (or round to) the same created_at, corrupting everything
   simulated afterward. Reversing the fetch order instead reconstructs
   the exact causal sequence. (Validated by simulating the full changelog
   and diffing the resulting order against AREDL's live current list —
   sorting by created_at produced 30/150 mismatches in the top 150;
   reversing fetch order instead produced a perfect 0/150 match.)

   NOT part of the regular hourly refresh — walking ~160 changelog pages
   and replaying ~3200 events is comparatively expensive, and the
   changelog's own past doesn't change, so there's no reason to redo it
   every hour (see scripts/refresh-aredl-cache.mjs's own much cheaper
   incremental approach for that). Re-run this by hand only if you want
   to re-verify against the full log, e.g. after a long gap in the hourly
   job.

   Usage: node scripts/backfill-position-history.mjs
   ===================================================================== */

import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { directReason, swapReason, cascadeReason } from './lib/changelog-reasons.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HISTORY_PATH = path.join(__dirname, '..', 'data', 'position-history.json');
const AREDL_BASE = 'https://api.aredl.net/v2/api/aredl';
const PACE_MS = 150;

// Keep in sync with CONFIG.LIST_SIZE in js/config.js — a level only
// starts being tracked once it's within the top this-many positions
// (matches refresh-aredl-cache.mjs's own tracking boundary), though its
// history keeps being recorded afterward even if it later drops out.
const LEVEL_LIST_SIZE = 150;

async function fetchJson(url, { retries = 5 } = {}) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (res.ok) return res.json();
    if (res.status === 429 && attempt < retries) {
      // AREDL sometimes sends `retry-after: 0` (a truthy string — the
      // naive `header || fallback` doesn't catch it), which if honored
      // literally means "retry immediately", re-tripping the same limiter
      // instantly. Floor it at 2s regardless of what the header says.
      const retryAfterSeconds = Math.max(parseInt(res.headers.get('retry-after'), 10) || 0, 2);
      console.log(`  429 from AREDL — waiting ${retryAfterSeconds}s (attempt ${attempt + 1}/${retries}) before retrying ${url}`);
      await new Promise(r => setTimeout(r, retryAfterSeconds * 1000));
      continue;
    }
    throw new Error(`${url} returned ${res.status}`);
  }
}

async function fetchAllChangelogEntries() {
  const first = await fetchJson(`${AREDL_BASE}/changelog?page=1`);
  const totalPages = first.pages || 1;
  const all = [...(first.data || [])];
  console.log(`Changelog has ${totalPages} pages (~${totalPages * (first.per_page || 20)} entries) — fetching the rest...`);
  for (let page = 2; page <= totalPages; page++) {
    const json = await fetchJson(`${AREDL_BASE}/changelog?page=${page}`);
    all.push(...(json.data || []));
    if (page % 20 === 0) console.log(`  ...page ${page}/${totalPages}`);
    await new Promise(r => setTimeout(r, PACE_MS));
  }
  return all; // newest-first, matching the backend's own paging order
}

/**
 * Replays every changelog event against an in-memory ordered array
 * (order[i] = level id at position i+1), using real splice-based
 * insert/remove so every level whose position actually shifts — not
 * just the one AREDL names as "affected" — gets a history entry, each
 * carrying a human-readable `reason` (see scripts/lib/changelog-reasons.mjs)
 * naming whichever direct action actually caused it.
 */
function simulate(entries) {
  const order = [];
  const historyOut = {};
  const everTracked = new Set();
  const levelNames = new Map(); // id -> name, opportunistically collected from every event seen, so a cascade can name whatever level caused it even though it's never itself the changelog's "affected_level"
  let directCount = 0, cascadeCount = 0, swapResolved = 0, swapSkipped = 0;

  function noteName(lvl) { if (lvl?.id && lvl.name) levelNames.set(lvl.id, lvl.name); }

  function recordIfChanged(id, date, position, reason) {
    if (!everTracked.has(id)) {
      if (position > LEVEL_LIST_SIZE) return;
      everTracked.add(id);
    }
    const list = historyOut[id] || (historyOut[id] = []);
    const last = list[list.length - 1];
    if (last && last.position === position) return;
    list.push({ date, position, reason });
  }

  function moveTo(id, newPos, date, directReasonText, cause) {
    const oldIdx = order.indexOf(id);
    if (oldIdx !== -1) order.splice(oldIdx, 1);
    const insertIdx = Math.max(0, Math.min(newPos - 1, order.length));
    order.splice(insertIdx, 0, id);
    if (directReasonText) { recordIfChanged(id, date, insertIdx + 1, directReasonText); directCount++; }
    // A brand-new insertion (oldIdx === -1, e.g. a fresh Placed event) pushes
    // every level from insertIdx through the *current end* of the array down
    // by one — there's no "old position" to bound the range against, unlike
    // a move within the existing list. Bounding hi at insertIdx here was a
    // bug: it meant new placements (the single most common event type) never
    // cascaded a position change to anything below them at all.
    const lo = oldIdx === -1 ? insertIdx : Math.min(oldIdx, insertIdx);
    const hi = oldIdx === -1 ? order.length - 1 : Math.max(oldIdx, insertIdx);
    // Direction is uniform across the whole cascaded range for a single
    // event: a new insertion or a raise always pushes everything in range
    // to a worse (higher) position number; a lower always pulls everything
    // in range to a better (lower) one.
    const movedDown = oldIdx === -1 ? true : insertIdx < oldIdx;
    const reason = cascadeReason(cause.type, cause.name, newPos, movedDown);
    for (let i = lo; i <= hi; i++) {
      if (i === insertIdx) continue;
      recordIfChanged(order[i], date, i + 1, reason);
      cascadeCount++;
    }
  }

  for (const entry of entries) {
    const id = entry.affected_level?.id;
    noteName(entry.affected_level);
    noteName(entry.level_above);
    noteName(entry.level_below);
    if (!id) continue;
    const date = entry.created_at.slice(0, 10);
    const [type, action] = Object.entries(entry.action || {})[0] || [null, {}];
    noteName(action.upper_level);
    noteName(action.other_level);

    if (type === 'Placed' || type === 'Raised' || type === 'Lowered' || type === 'MovedToLegacy' || type === 'MovedFromLegacy') {
      if (!Number.isFinite(action.new_position)) continue;
      const name = levelNames.get(id) || entry.affected_level?.name;
      moveTo(id, action.new_position, date, directReason(type, action), { type, name });
    } else if (type === 'Removed') {
      const oldIdx = order.indexOf(id);
      if (oldIdx === -1) continue;
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
      // position, rather than trusting upper_level/other_level ids.
      const upperPos = action.upper_position;
      const idxA = upperPos - 1, idxB = upperPos;
      if (idxA < 0 || idxB >= order.length) { swapSkipped++; continue; }
      const idA = order[idxA], idB = order[idxB];
      order[idxA] = idB; order[idxB] = idA;
      recordIfChanged(idA, date, idxB + 1, swapReason(levelNames.get(idB), upperPos, upperPos + 1));
      recordIfChanged(idB, date, idxA + 1, swapReason(levelNames.get(idA), upperPos + 1, upperPos));
      swapResolved++;
    }
  }

  console.log(`Simulated ${directCount} direct events + ${cascadeCount} cascading shifts (${swapResolved} swaps resolved, ${swapSkipped} skipped out-of-bounds).`);
  return historyOut;
}

async function main() {
  const entries = await fetchAllChangelogEntries();
  console.log(`Fetched ${entries.length} changelog entries total.`);

  // Replay oldest-first. Reversing the fetch order (rather than sorting by
  // created_at) reconstructs the backend's exact causal sequence — see the
  // header comment for why a timestamp sort corrupts the simulation.
  entries.reverse();

  const history = simulate(entries);
  console.log(`Reconstructed history for ${Object.keys(history).length} levels.`);

  await mkdir(path.dirname(HISTORY_PATH), { recursive: true });
  await writeFile(HISTORY_PATH, JSON.stringify({ generatedAt: new Date().toISOString(), history }, null, 2) + '\n');
  console.log(`Wrote ${HISTORY_PATH}.`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
