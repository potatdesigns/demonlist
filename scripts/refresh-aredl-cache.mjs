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

   Usage: node scripts/refresh-aredl-cache.mjs
   ===================================================================== */

import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_PATH = path.join(__dirname, '..', 'data', 'aredl-cache.json');
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
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
