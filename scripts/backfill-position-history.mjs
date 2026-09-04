#!/usr/bin/env node
/* =====================================================================
   BACKFILL POSITION HISTORY (full rebuild)

   Rebuilds data/position-history.json from scratch by walking AREDL's
   *entire* changelog (currently ~3300+ entries, going back to August
   2022) and replaying it through scripts/lib/simulate-history.mjs — see
   that file for the actual replay logic (shared with
   scripts/refresh-aredl-cache.mjs's own incremental replay) and why a
   naive "just the level AREDL names as affected" replay badly
   undercounts a level's real position history.

   Also publishes `simState` — the simulation's final { order,
   everTracked, levelNames } — alongside `history`/`names`.
   refresh-aredl-cache.mjs seeds its own much cheaper incremental replay
   from this every run, rather than re-walking the whole changelog; this
   script exists to (re-)establish that baseline, and as a periodic
   sanity check (see the live-list validation below) that the
   incremental replay hasn't quietly drifted from what AREDL's changelog
   actually says. Re-run by hand after a long gap in the scheduled job,
   or any time the replay logic itself changes.

   Usage: node scripts/backfill-position-history.mjs
   ===================================================================== */

import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createSimulator, entryFingerprint } from './lib/simulate-history.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HISTORY_PATH = path.join(__dirname, '..', 'data', 'position-history.json');
const AREDL_BASE = 'https://api.aredl.net/v2/api/aredl';
const PACE_MS = 150;

// Keep in sync with CONFIG.LIST_SIZE in js/config.js.
const LEVEL_LIST_SIZE = 150;

async function fetchJson(url, { retries = 5 } = {}) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (res.ok) return res.json();
    if (res.status === 429 && attempt < retries) {
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

/** Diffs the simulated final order's top LEVEL_LIST_SIZE against AREDL's live current list — this is what caught the created_at-sort bug during development, and stays as a standing correctness check on every full rebuild. */
async function validateAgainstLive(order) {
  const data = await fetchJson(`${AREDL_BASE}/levels`);
  const live = (Array.isArray(data) ? data : (data.data || data.levels || [])).sort((a, b) => a.position - b.position);
  let mismatches = 0;
  for (let i = 0; i < LEVEL_LIST_SIZE; i++) {
    if (order[i] !== live[i]?.id) mismatches++;
  }
  console.log(`Validation: ${mismatches}/${LEVEL_LIST_SIZE} mismatches vs. AREDL's live current list.`);
  if (mismatches > 0) {
    console.warn(`  WARNING: simulated order doesn't match AREDL's live list — investigate before trusting this run's output.`);
  }
  return mismatches;
}

async function main() {
  const entries = await fetchAllChangelogEntries();
  console.log(`Fetched ${entries.length} changelog entries total.`);

  // Replay oldest-first. Reversing the fetch order (rather than sorting by
  // created_at) reconstructs the backend's exact causal sequence — see
  // scripts/lib/simulate-history.mjs's header for why a timestamp sort
  // corrupts the simulation.
  entries.reverse();

  const sim = createSimulator({ listSize: LEVEL_LIST_SIZE });
  sim.replay(entries);
  const state = sim.getState();
  const { directCount, cascadeCount, swapResolved, swapSkipped } = state.counters;
  console.log(`Simulated ${directCount} direct events + ${cascadeCount} cascading shifts (${swapResolved} swaps resolved, ${swapSkipped} skipped out-of-bounds).`);
  console.log(`Reconstructed history for ${Object.keys(state.historyByLevel).length} levels.`);

  await validateAgainstLive(state.order);

  // Every tracked id started life via its own Placed/MovedFromLegacy event
  // (the only way an id ever enters the simulated order), so levelNames
  // always has a name for it — published alongside the history so a level
  // that's since dropped out of the tracked top LEVEL_LIST_SIZE (and so
  // isn't in data/aredl-cache.json anymore either) can still be named by
  // On This Day / the Time Machine page.
  const names = {};
  for (const id of Object.keys(state.historyByLevel)) {
    const name = state.levelNames[id];
    if (name) names[id] = name;
  }

  const out = {
    generatedAt: new Date().toISOString(),
    history: state.historyByLevel,
    names,
    // Seeds refresh-aredl-cache.mjs's incremental replay — see that
    // script and scripts/lib/simulate-history.mjs's header.
    simState: {
      order: state.order,
      everTracked: state.everTracked,
      levelNames: state.levelNames,
      lastEventFingerprint: entries.length ? entryFingerprint(entries[entries.length - 1]) : null,
    },
  };

  await mkdir(path.dirname(HISTORY_PATH), { recursive: true });
  await writeFile(HISTORY_PATH, JSON.stringify(out, null, 2) + '\n');
  console.log(`Wrote ${HISTORY_PATH}.`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
