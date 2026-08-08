#!/usr/bin/env node
/* =====================================================================
   REFRESH AREDL LEVEL-LIST CACHE

   Populates data/aredl-cache.json — a snapshot of AREDL's GET /levels
   (the bare list: id, name, position, level_id, points, etc.) that
   js/api-aredl.js reads instead of hitting AREDL's live API on every
   single visitor's page load. Every visitor was independently re-fetching
   the exact same ~1600-entry list; this makes that one shared, scheduled
   fetch instead (see .github/workflows/refresh-aredl-cache.yml, hourly).

   This is unauthenticated and free (no API key, no quota — AREDL's list
   endpoint is public), so unlike the YouTube cache there's no budget or
   staggering logic needed: it's just "fetch the whole list, write it
   out" every run. Hourly is already far more often than levels actually
   get reordered/added, but since it costs nothing there's no reason to
   be stingier than that.

   Per-level detail (verification video, publisher, creators) is NOT
   cached here — that's a separate GET /levels/{id} call per level with
   its own staleness story, still fetched live/lazily by the client as
   cards scroll into view (see AredlAPI.fetchExtras() in js/api-aredl.js).
   Caching that too would mean pre-fetching detail for all ~1600 levels
   on every run, which is a lot more work for a lot less benefit than
   just caching the list.

   Usage: node scripts/refresh-aredl-cache.mjs
   ===================================================================== */

import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_PATH = path.join(__dirname, '..', 'data', 'aredl-cache.json');
const AREDL_BASE = 'https://api.aredl.net/v2/api/aredl';

async function main() {
  const res = await fetch(`${AREDL_BASE}/levels`, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`AREDL returned ${res.status} for the level list`);
  const data = await res.json();
  const levels = (Array.isArray(data) ? data : (data.data || data.levels || [])).sort((a, b) => a.position - b.position);

  const cache = { generatedAt: new Date().toISOString(), levels };
  await mkdir(path.dirname(CACHE_PATH), { recursive: true });
  await writeFile(CACHE_PATH, JSON.stringify(cache, null, 2) + '\n');

  console.log(`Wrote ${levels.length} levels to ${CACHE_PATH}.`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
