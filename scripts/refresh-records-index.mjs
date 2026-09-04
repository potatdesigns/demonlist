#!/usr/bin/env node
/* =====================================================================
   REFRESH RECORDS INDEX

   Populates data/records-index.json — every accepted record (raw clear)
   across the tracked top LEVEL_LIST_SIZE, indexed by player. AREDL has
   no public "list everything this player has completed" endpoint (only
   the reverse: GET /levels/{id}/records, a public per-*level* list of
   who's cleared it — confirmed against the open-source backend,
   All-Rated-Extreme-Demon-List/aredl-backend-v2), so this precomputes
   the player-centric view server-side by walking every tracked level's
   own records once and inverting the index, the same reason
   scripts/refresh-yt-cache.mjs precomputes view counts instead of every
   visitor re-fetching them live.

   This is what js/aredl-sync.js's "sync my completions from AREDL"
   button matches a typed username against (case-insensitive name match,
   since that's the only identifier a visitor can be expected to type in
   without an actual login — there is none, by design, see that file),
   and what the list page's name-search "profile" summary reads to show
   what a person has completed alongside what they've created/verified.

   Usage: node scripts/refresh-records-index.mjs
   ===================================================================== */

import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_PATH = path.join(__dirname, '..', 'data', 'records-index.json');
const AREDL_BASE = 'https://api.aredl.net/v2/api/aredl';

// Keep in sync with CONFIG.LIST_SIZE in js/config.js.
const LEVEL_LIST_SIZE = 150;
const CONCURRENCY = 4;
const PACE_MS = 200;

async function fetchJson(url, { retries = 4 } = {}) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (res.ok) return res.json();
    if (res.status === 429 && attempt < retries) {
      const retryAfterSeconds = Math.max(parseInt(res.headers.get('retry-after'), 10) || 0, 2);
      console.log(`  429 from AREDL — waiting ${retryAfterSeconds}s (attempt ${attempt + 1}/${retries}) before retrying ${url}`);
      await new Promise(r => setTimeout(r, retryAfterSeconds * 1000));
      continue;
    }
    throw new Error(`AREDL returned ${res.status} for ${url}`);
  }
}

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

/** All accepted records for one level, walking pages until exhausted (capped — a tracked level having >500 clears is astronomically unlikely). */
async function fetchAllRecordsForLevel(id) {
  const all = [];
  let page = 1, pages = 1;
  do {
    const json = await fetchJson(`${AREDL_BASE}/levels/${id}/records?page=${page}&per_page=100`);
    pages = json.pages || 1;
    all.push(...(json.data || []));
    page++;
  } while (page <= pages && page <= 5);
  return all;
}

async function main() {
  const data = await fetchJson(`${AREDL_BASE}/levels`);
  const fullList = (Array.isArray(data) ? data : (data.data || data.levels || [])).sort((a, b) => a.position - b.position);
  const trackedLevels = fullList.slice(0, LEVEL_LIST_SIZE);

  console.log(`Fetching records for ${trackedLevels.length} tracked levels (concurrency ${CONCURRENCY})...`);
  let failed = 0;
  const perLevelRecords = await mapWithConcurrency(trackedLevels, CONCURRENCY, async (level) => {
    try {
      return await fetchAllRecordsForLevel(level.id);
    } catch (e) {
      failed++;
      console.warn(`  skipped records for "${level.name}": ${e.message}`);
      return [];
    }
  }, PACE_MS);

  // player id -> { name, levels: [{levelId, levelName, position, achievedAt, videoUrl}] }
  const players = {};
  let totalRecords = 0;
  for (let i = 0; i < trackedLevels.length; i++) {
    const level = trackedLevels[i];
    for (const record of perLevelRecords[i]) {
      const user = record.submitted_by;
      if (!user?.id) continue;
      const name = user.global_name || user.username;
      if (!name) continue;
      totalRecords++;
      const entry = players[user.id] || (players[user.id] = { name, levels: [] });
      entry.name = name; // always keep the most-recently-seen display name (a rename between runs shouldn't leave a stale one stuck)
      entry.levels.push({
        levelId: level.id,
        levelName: level.name,
        position: level.position,
        achievedAt: record.achieved_at,
        videoUrl: record.video_url,
      });
    }
  }
  for (const entry of Object.values(players)) {
    entry.levels.sort((a, b) => a.position - b.position);
  }

  console.log(`Indexed ${totalRecords} records (${trackedLevels.length - failed} of ${trackedLevels.length} levels fetched successfully) across ${Object.keys(players).length} players.`);

  await mkdir(path.dirname(OUT_PATH), { recursive: true });
  await writeFile(OUT_PATH, JSON.stringify({ generatedAt: new Date().toISOString(), players }, null, 2) + '\n');
  console.log(`Wrote ${OUT_PATH}.`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
