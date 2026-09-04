#!/usr/bin/env node
/* =====================================================================
   REFRESH AREDL LEVEL-LIST CACHE

   Populates data/aredl-cache.json — a snapshot of the *top LEVEL_LIST_SIZE*
   of AREDL's GET /levels (the bare list: id, name, position, level_id,
   points, etc.), each entry then enriched with its GET /levels/{id}
   detail (verification video, resolved publisher, verifier) and
   GET /levels/{id}/creators, merged directly onto the same object. That
   full picture is what js/api-aredl.js reads instead of hitting AREDL's
   live API — for the list itself *and* for every card's thumbnail/
   verifier/publisher/creators, and the detail page. Every visitor was
   independently re-fetching all of this; this makes it one shared,
   scheduled fetch instead (see .github/workflows/refresh-aredl-cache.yml,
   hourly — and .github/workflows/watch-new-levels.yml, which triggers an
   extra off-schedule run the moment a top-LEVEL_LIST_SIZE-affecting
   change is detected, so a change doesn't sit stale for up to an hour).

   Caching per-level detail too used to not be worth it — pre-fetching
   detail for AREDL's full ~1600-level list on every run would've been a
   lot of work for a lot less benefit than just caching the bare list.
   That math changed once the tracked list got capped to the top
   LEVEL_LIST_SIZE (150, see the comment on CONFIG.LIST_SIZE in
   js/config.js): 150 levels' worth of detail is a perfectly reasonable
   thing to fetch once an hour server-side, and it's what actually fixes
   cards showing a black thumbnail while they wait on a live per-card
   AREDL call from the visitor's own browser (and occasionally erroring
   if that live call fails) — see AredlAPI.fetchDemon()/normalizeLevel()
   in js/api-aredl.js for the cache-first, live-fallback read side.

   Concurrency-limited (CONCURRENCY below) rather than firing all
   LEVEL_LIST_SIZE*2 detail+creators requests at once — AREDL's API has
   no documented rate limit, but there's no reason to hammer it either.
   A level whose detail fetch fails this run is written with just its
   bare fields — js/api-aredl.js falls back to a live per-level fetch for
   that one specifically, same as it would have for everything before
   this existed, so a transient failure here degrades gracefully rather
   than breaking the run.

   This is unauthenticated and free (no API key, no quota — AREDL's
   endpoints are public), so unlike the YouTube cache there's no unit
   budget to manage, just the concurrency cap above.

   Also updates data/position-history.json — an *incremental* run of the
   same changelog simulation scripts/backfill-position-history.mjs does a
   full walk of (see scripts/lib/simulate-history.mjs for the shared
   replay logic). Rather than re-walking the entire changelog every run,
   this seeds the simulator from the previous run's own final state
   (`simState`, published alongside `history`) and only fetches/replays
   whatever changelog entries are newer than the last one it already
   processed — cheap (almost always just page 1, one request) and, unlike
   the old best-effort "guess the cause from whatever's most recent"
   heuristic this replaced, exactly as precise as the full backfill: every
   level whose position actually shifts, including as a cascade side
   effect, gets a correctly-attributed entry, not just whichever one
   AREDL's changelog happens to name directly. If `simState` is missing
   (e.g. a fresh cache branch) this skips position-history for the run
   rather than replaying against an empty, wrong seed — run
   scripts/backfill-position-history.mjs by hand first to establish one.

   Usage: node scripts/refresh-aredl-cache.mjs
   ===================================================================== */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createSimulator, entryFingerprint } from './lib/simulate-history.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_PATH = path.join(__dirname, '..', 'data', 'aredl-cache.json');
const HISTORY_PATH = path.join(__dirname, '..', 'data', 'position-history.json');
const AREDL_BASE = 'https://api.aredl.net/v2/api/aredl';

// Keep in sync with CONFIG.LIST_SIZE in js/config.js — this app only
// tracks the top this-many positions, not AREDL's full ~1600-level list.
const LEVEL_LIST_SIZE = 150;

// How many levels' detail+creators to fetch in parallel (each level is 2
// simultaneous requests, so this is really CONCURRENCY*2 in-flight at
// once), plus a small pause after each one finishes — AREDL's API is
// genuinely rate-limited (confirmed live: ~30 concurrent requests to
// distinct levels was enough to draw a handful of 429s, each with a
// `retry-after` header), not just "no documented limit" the way the bare
// list endpoint is. This combination (modest concurrency + pacing)
// mostly avoids tripping it in the first place; fetchJson()'s retry
// below is the safety net for whatever slips through anyway.
const CONCURRENCY = 4;
const PACE_MS = 250;

// Safety cap on how many changelog pages an incremental run will walk
// looking for its last-processed entry, before giving up and skipping
// position-history for this run rather than guessing. 30 pages (~600
// entries) comfortably covers even a multi-day gap between runs — a
// bigger gap than that means something's actually wrong with the
// schedule and deserves a fresh scripts/backfill-position-history.mjs
// run, not a script silently doing something unreliable.
const MAX_CATCHUP_PAGES = 30;

async function fetchJson(url, { retries = 4 } = {}) {
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
    throw new Error(`AREDL returned ${res.status} for ${url}`);
  }
}

async function fetchLevelDetail(id) {
  const data = await fetchJson(`${AREDL_BASE}/levels/${id}`);
  return data.data || data;
}

async function fetchLevelCreators(id) {
  try {
    const data = await fetchJson(`${AREDL_BASE}/levels/${id}/creators`);
    return Array.isArray(data) ? data : (data.data || []);
  } catch {
    return []; // creators endpoint hiccuping shouldn't block the rest of this level's detail
  }
}

/** Runs fn(item) over items with at most `limit` in flight at once, pausing `pauseMs` between each worker's iterations. */
async function mapWithConcurrency(items, limit, fn, pauseMs = 0) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
      if (pauseMs) await new Promise(r => setTimeout(r, pauseMs));
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

async function loadExistingHistoryFile() {
  try {
    const parsed = JSON.parse(await readFile(HISTORY_PATH, 'utf8'));
    return {
      history: parsed.history && typeof parsed.history === 'object' ? parsed.history : {},
      names: parsed.names && typeof parsed.names === 'object' ? parsed.names : {},
      simState: parsed.simState && typeof parsed.simState === 'object' ? parsed.simState : null,
    };
  } catch {
    return { history: {}, names: {}, simState: null }; // first run, or the file's missing/unreadable
  }
}

/**
 * Walks the changelog from page 1 (newest-first) collecting entries until
 * one matches `lastFingerprint` — everything from there back was already
 * processed by a previous run. Returns them oldest-first, ready to
 * replay. Returns null (rather than a possibly-incomplete list) if
 * MAX_CATCHUP_PAGES is exhausted without finding the fingerprint, or if
 * `lastFingerprint` is falsy (nothing to anchor an incremental walk to).
 */
async function fetchNewChangelogEntries(lastFingerprint) {
  if (!lastFingerprint) return null;
  const collected = [];
  for (let page = 1; page <= MAX_CATCHUP_PAGES; page++) {
    const json = await fetchJson(`${AREDL_BASE}/changelog?page=${page}`);
    const entries = json.data || [];
    for (const entry of entries) {
      if (entryFingerprint(entry) === lastFingerprint) {
        return collected.reverse(); // oldest-first, ready for createSimulator().replay()
      }
      collected.push(entry);
    }
    if (page >= (json.pages || 1)) break; // reached the end of the whole changelog without finding it — shouldn't happen, but don't loop past it
  }
  return null; // gap too large — see MAX_CATCHUP_PAGES
}

async function main() {
  const data = await fetchJson(`${AREDL_BASE}/levels`);
  const fullList = (Array.isArray(data) ? data : (data.data || data.levels || [])).sort((a, b) => a.position - b.position);
  const bareLevels = fullList.slice(0, LEVEL_LIST_SIZE);

  console.log(`Fetching detail for ${bareLevels.length} of ${fullList.length} AREDL levels (concurrency ${CONCURRENCY})...`);
  let failed = 0;
  const levels = await mapWithConcurrency(bareLevels, CONCURRENCY, async (level) => {
    try {
      const [detail, creators] = await Promise.all([fetchLevelDetail(level.id), fetchLevelCreators(level.id)]);
      return { ...level, ...detail, creators };
    } catch (e) {
      failed++;
      console.warn(`  skipped detail for "${level.name}": ${e.message}`);
      return level; // bare fields only — the client falls back to a live fetch for just this one
    }
  }, PACE_MS);

  const cache = { generatedAt: new Date().toISOString(), levels };
  await mkdir(path.dirname(CACHE_PATH), { recursive: true });
  await writeFile(CACHE_PATH, JSON.stringify(cache, null, 2) + '\n');
  console.log(`Wrote ${levels.length} AREDL levels (${levels.length - failed} with full detail) to ${CACHE_PATH}.`);

  const { history: existingHistory, names: existingNames, simState } = await loadExistingHistoryFile();

  if (!simState) {
    console.warn(`No simState in ${HISTORY_PATH} — skipping position-history update this run. Run scripts/backfill-position-history.mjs by hand to establish one.`);
    return;
  }

  const newEntries = await fetchNewChangelogEntries(simState.lastEventFingerprint);
  if (newEntries === null) {
    console.warn(`Couldn't find this run's starting point within the last ${MAX_CATCHUP_PAGES} changelog pages — skipping position-history update this run. Run scripts/backfill-position-history.mjs by hand to catch back up.`);
    return;
  }

  if (newEntries.length === 0) {
    console.log('Position history: no new changelog entries since the last run.');
    return;
  }

  const sim = createSimulator({
    order: simState.order,
    everTracked: simState.everTracked,
    levelNames: simState.levelNames,
    historyByLevel: existingHistory,
    listSize: LEVEL_LIST_SIZE,
  });
  sim.replay(newEntries);
  const state = sim.getState();
  const { directCount, cascadeCount, swapResolved, swapSkipped } = state.counters;
  console.log(`Replayed ${newEntries.length} new changelog entries: ${directCount} direct + ${cascadeCount} cascading shifts (${swapResolved} swaps, ${swapSkipped} skipped out-of-bounds). ${state.touchedIds.length} level(s) got a new position-history entry.`);

  // Cheap standing correctness check — fullList is already in memory from
  // this run's own /levels fetch above, no extra request needed. A
  // mismatch here means something's actually wrong with the incremental
  // replay (or AREDL's changelog itself lagged the live position briefly);
  // it doesn't block publishing, but it's worth a loud log line so it
  // doesn't drift silently for weeks.
  const livePositionById = new Map(fullList.map(l => [l.id, l.position]));
  let mismatches = 0;
  for (let i = 0; i < LEVEL_LIST_SIZE; i++) {
    const simId = state.order[i];
    if (livePositionById.get(simId) !== i + 1) mismatches++;
  }
  if (mismatches > 0) {
    console.warn(`  WARNING: simulated order has ${mismatches}/${LEVEL_LIST_SIZE} mismatches vs. this run's live list — consider re-running scripts/backfill-position-history.mjs.`);
  }

  const names = { ...existingNames };
  for (const id of state.touchedIds) {
    const name = state.levelNames[id];
    if (name) names[id] = name;
  }

  const out = {
    generatedAt: new Date().toISOString(),
    history: state.historyByLevel,
    names,
    simState: {
      order: state.order,
      everTracked: state.everTracked,
      levelNames: state.levelNames,
      lastEventFingerprint: entryFingerprint(newEntries[newEntries.length - 1]),
    },
  };
  await writeFile(HISTORY_PATH, JSON.stringify(out, null, 2) + '\n');
  console.log(`Position history: ${Object.keys(state.historyByLevel).length} levels tracked in total, wrote to ${HISTORY_PATH}.`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
