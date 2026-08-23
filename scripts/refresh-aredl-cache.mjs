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
   hourly).

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
   budget to manage, just the concurrency cap above. Hourly is already
   far more often than levels actually get reordered/added, but since it
   costs nothing there's no reason to be stingier than that.

   Also populates data/position-history.json — one { date, position }
   entry per level appended whenever its position actually changes since
   the last recorded entry (not every run), read from and republished to
   the cache branch same as data/aredl-cache.json (the workflow pulls
   the prior copy before running, see .github/workflows/refresh-aredl-
   cache.yml). Tracks both the current top LEVEL_LIST_SIZE and any level
   that already has history but has since dropped out, so its record
   doesn't just stop — js/detail.js renders anything past LEVEL_LIST_SIZE
   as "Legacy" rather than a raw (and here, not otherwise meaningful)
   AREDL position number.

   Usage: node scripts/refresh-aredl-cache.mjs
   ===================================================================== */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { directReason, cascadeReason } from './lib/changelog-reasons.mjs';

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

async function loadExistingHistory() {
  try {
    const parsed = JSON.parse(await readFile(HISTORY_PATH, 'utf8'));
    return {
      history: parsed.history && typeof parsed.history === 'object' ? parsed.history : {},
      names: parsed.names && typeof parsed.names === 'object' ? parsed.names : {},
    };
  } catch {
    return { history: {}, names: {} }; // first run, or the file's missing/unreadable — start fresh
  }
}

/**
 * Merges in a name for every tracked id, from this run's own full AREDL
 * fetch (which — unlike data/aredl-cache.json — covers AREDL's entire
 * list, not just the tracked top LEVEL_LIST_SIZE, so it can name a level
 * that dropped out of the top LEVEL_LIST_SIZE a while ago too). Existing
 * names are kept as a base so a level AREDL's own /levels response no
 * longer includes at all (actually removed, not just demoted — rare)
 * doesn't lose its name just because this run can't re-confirm it.
 */
function updateNames(existingNames, namesById, trackedIds) {
  const names = { ...existingNames };
  for (const id of trackedIds) {
    const name = namesById.get(id);
    if (name) names[id] = name;
  }
  return names;
}

/**
 * Fetches the changelog's most recent page (20 entries — cheap, one
 * request) so position changes found by updatePositionHistory() below
 * can carry a real `reason`, same vocabulary as the full changelog
 * simulation in scripts/backfill-position-history.mjs — see that file's
 * header for why AREDL's changelog only names the level an action was
 * *directly* taken on, never everything that shifted as a side effect.
 * This is a best-effort, non-simulated version of that same idea: any
 * level in this page's own directReason() gets an exact reason; any
 * *other* tracked level whose position moved this run (a cascade this
 * cheap approach can't precisely attribute) instead gets a reason
 * pointing at whichever direct event most recently ran, since between
 * two hourly checks there's usually just the one.
 */
async function fetchRecentChangelogEntries() {
  try {
    const json = await fetchJson(`${AREDL_BASE}/changelog?page=1`);
    return json.data || [];
  } catch (e) {
    console.warn(`  couldn't fetch changelog for position-history reasons: ${e.message}`);
    return [];
  }
}

/** Builds { directReasonById, latestCause } from a page of changelog entries (newest-first). */
function buildReasonContext(recentEntries) {
  const directReasonById = new Map();
  let latestCause = null;
  for (const entry of recentEntries) {
    const id = entry.affected_level?.id;
    if (!id) continue;
    const name = entry.affected_level?.name;
    const [type, action] = Object.entries(entry.action || {})[0] || [null, {}];
    // affected_level is always exactly one of upper_level/other_level for
    // a Swapped event — pick whichever one *isn't* it, rather than
    // defaulting to other_level unconditionally (which self-references
    // back to the affected level itself whenever it's the "other" side).
    const swapPartner = action.upper_level?.name === name ? action.other_level?.name : action.upper_level?.name;
    const reason = type === 'Swapped'
      ? `Swapped with ${(swapPartner || 'another level').trim()}`
      : directReason(type, action);
    if (reason && !directReasonById.has(id)) directReasonById.set(id, reason);
    if (!latestCause && type && type !== 'Swapped' && Number.isFinite(action.new_position)) {
      latestCause = { type, name: entry.affected_level?.name, position: action.new_position };
    }
  }
  return { directReasonById, latestCause };
}

/**
 * Appends a { date, position, reason } entry for every level that's
 * either currently in the top LEVEL_LIST_SIZE or already has history (so
 * a level that's since dropped out keeps getting tracked — its entries
 * just read as "Legacy" once position > LEVEL_LIST_SIZE, see
 * js/detail.js) — but only when its position actually changed since the
 * last recorded entry, not on every run. A level absent from
 * `positionById` entirely (removed from AREDL outright, not just
 * demoted — rare) is left as-is rather than guessed at.
 *
 * Kept in full, all-time — never trimmed. A level only gets a new entry
 * when it actually moves (not once per run), so even a level with years
 * of history stays a small array; there's no volume problem an entry
 * cap would actually be solving.
 */
function updatePositionHistory(existingHistory, positionById, trackedIds, reasonContext) {
  const history = { ...existingHistory };
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD — daily granularity is plenty for a position history
  let changed = 0;

  for (const id of trackedIds) {
    const currentPosition = positionById.get(id);
    if (!Number.isFinite(currentPosition)) continue;

    const entries = history[id] ? history[id].slice() : [];
    const last = entries[entries.length - 1];
    if (last && last.position === currentPosition) continue; // no change since last recorded entry

    let reason = reasonContext.directReasonById.get(id);
    if (!reason) {
      const cause = reasonContext.latestCause;
      const movedDown = last ? currentPosition > last.position : false;
      reason = cause ? cascadeReason(cause.type, cause.name, cause.position, movedDown) : (movedDown ? 'Moved down' : 'Moved up');
    }

    entries.push({ date: today, position: currentPosition, reason });
    history[id] = entries;
    changed++;
  }

  return { history, changed };
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

  const positionById = new Map(fullList.map(l => [String(l.id), l.position]));
  const namesById = new Map(fullList.map(l => [String(l.id), l.name]));
  const { history: existingHistory, names: existingNames } = await loadExistingHistory();
  const trackedIds = new Set([...bareLevels.map(l => String(l.id)), ...Object.keys(existingHistory)]);
  const recentEntries = await fetchRecentChangelogEntries();
  const reasonContext = buildReasonContext(recentEntries);
  const { history, changed } = updatePositionHistory(existingHistory, positionById, trackedIds, reasonContext);
  const names = updateNames(existingNames, namesById, trackedIds);
  await writeFile(HISTORY_PATH, JSON.stringify({ generatedAt: new Date().toISOString(), history, names }, null, 2) + '\n');
  console.log(`Position history: ${changed} level(s) moved since the last check, ${Object.keys(history).length} tracked in total, wrote to ${HISTORY_PATH}.`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
