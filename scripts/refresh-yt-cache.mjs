#!/usr/bin/env node
/* =====================================================================
   REFRESH SHARED YOUTUBE CACHE

   Populates data/yt-cache.json — the shared, precomputed showcase +
   verifier-view-count cache that js/shared-cache.js reads client-side.
   Run on a schedule by .github/workflows/refresh-yt-cache.yml, using a
   single server-side API key (repo secret YOUTUBE_API_KEY), so that
   every site visitor benefits from one staggered, budget-capped crawl
   instead of every visitor's own key repeating the same expensive
   search.list lookups.

   Staggering: rather than bucketing levels by day-of-week, this just
   always processes whichever levels are least-recently checked (never
   checked first, then oldest checkedAt), capped by a per-run unit
   budget safely under YouTube's 10,000/day default quota. Each level
   costs ~202 units (two fixed search.list queries, unconditionally —
   see findBestShowcase() — plus a couple 1-unit videos.list calls), so
   running this daily at the default 7000-unit budget spreads a full
   pass across ~45 days for AREDL's ~1600 levels; self-corrects if a run
   is skipped or the list grows, no date-math bucketing needed.

   This is the only place that talks to YouTube's API at all — the site
   itself has no personal-key fallback (a genuinely global/shared cache
   means there's no reason for every visitor to need their own key too).

   Usage:
     YOUTUBE_API_KEY=... node scripts/refresh-yt-cache.mjs
   Env overrides (all optional):
     YT_CACHE_MAX_UNITS   default 7000   — stop once this much of the day's quota would be spent
     YT_CACHE_MAX_LEVELS  default 150    — hard cap on levels processed per run regardless of unit math
   ===================================================================== */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_PATH = path.join(__dirname, '..', 'data', 'yt-cache.json');

const AREDL_BASE = 'https://api.aredl.net/v2/api/aredl';
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;
const MAX_UNITS_PER_RUN = parseInt(process.env.YT_CACHE_MAX_UNITS || '7000', 10);
const MAX_LEVELS_PER_RUN = parseInt(process.env.YT_CACHE_MAX_LEVELS || '150', 10);

if (!YOUTUBE_API_KEY) {
  console.error('YOUTUBE_API_KEY is not set — nothing to do.');
  process.exit(1);
}

function extractYouTubeId(url) {
  if (!url) return null;
  const m = url.match(/(?:youtube\.com\/watch\?v=|youtube\.com\/shorts\/|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/);
  return m ? m[1] : null;
}

let unitsSpent = 0;
async function ytFetch(endpoint, params) {
  const url = new URL(`https://www.googleapis.com/youtube/v3/${endpoint}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  url.searchParams.set('key', YOUTUBE_API_KEY);
  const res = await fetch(url.toString());
  unitsSpent += endpoint === 'search' ? 100 : 1;
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const reason = body?.error?.errors?.[0]?.reason || '';
    const err = new Error(body?.error?.message || `YouTube API error ${res.status}`);
    err.quota = /quota|dailylimit|ratelimit/i.test(reason);
    throw err;
  }
  return res.json();
}

function statsFromItem(item) {
  return {
    id: item.id,
    url: `https://www.youtube.com/watch?v=${item.id}`,
    title: item.snippet.title,
    channel: item.snippet.channelTitle,
    viewCount: parseInt(item.statistics.viewCount || '0', 10),
  };
}

async function getVerifierStats(videoUrl) {
  const id = extractYouTubeId(videoUrl);
  if (!id) return null;
  const data = await ytFetch('videos', { part: 'snippet,statistics', id });
  const item = data.items?.[0];
  return item ? statsFromItem(item) : null;
}

/**
 * Find the most-viewed showcase for a level. Two fixed queries, always
 * both run (no escalation/tiering) — results are merged into one pool.
 * The only eligibility check is whether the numeric GD level ID appears
 * in the video's title or description; no title keyword is excluded (a
 * lot of legitimate showcases use words like "verified"/"verification"
 * in their titles, so filtering those out was dropping real showcases),
 * and no channel allowlist is applied — every channel is equally
 * eligible, purest highest-view-count-among-ID-matches wins.
 */
async function findBestShowcase(levelName, levelId) {
  if (!levelId) return null;

  const queries = [`${levelName} GD showcase`, `${levelId} showcase`];
  const seen = new Map();
  for (const q of queries) {
    const data = await ytFetch('search', { part: 'snippet', q, type: 'video', maxResults: '10', order: 'viewCount' });
    for (const item of data.items || []) {
      const vid = item.id?.videoId;
      if (!vid || seen.has(vid)) continue;
      seen.set(vid, { id: vid, description: item.snippet.description || '' });
    }
  }
  if (seen.size === 0) return null;

  const ids = [...seen.keys()].slice(0, 40);
  const statsData = await ytFetch('videos', { part: 'statistics,snippet', id: ids.join(',') });
  const candidates = (statsData.items || []).map(statsFromItem);

  const idStr = String(levelId);
  const matched = candidates.filter(c =>
    c.title.includes(idStr) || (seen.get(c.id)?.description || '').includes(idStr)
  );
  if (matched.length === 0) return null;

  matched.sort((a, b) => b.viewCount - a.viewCount);
  return matched[0];
}

async function fetchAredlLevels() {
  const res = await fetch(`${AREDL_BASE}/levels`, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`AREDL returned ${res.status} for the level list`);
  const data = await res.json();
  return (Array.isArray(data) ? data : (data.data || data.levels || [])).sort((a, b) => a.position - b.position);
}

async function fetchAredlVerificationVideo(levelId) {
  const res = await fetch(`${AREDL_BASE}/levels/${levelId}`, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`AREDL returned ${res.status} for level ${levelId}`);
  const data = await res.json();
  const raw = data.data || data;
  return raw.verifications?.[0]?.video_url || null;
}

async function loadExistingCache() {
  try {
    const raw = await readFile(CACHE_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.levels === 'object') return parsed;
  } catch { /* missing or invalid — start fresh */ }
  return { generatedAt: null, levels: {} };
}

async function main() {
  const [levels, cache] = await Promise.all([fetchAredlLevels(), loadExistingCache()]);
  console.log(`AREDL list: ${levels.length} levels. Cache currently has ${Object.keys(cache.levels).length} entries.`);

  const neverCached = levels.filter(l => !cache.levels[l.id]);
  const stale = levels
    .filter(l => cache.levels[l.id])
    .sort((a, b) => new Date(cache.levels[a.id].checkedAt) - new Date(cache.levels[b.id].checkedAt));

  const queue = [...neverCached, ...stale];
  console.log(`${neverCached.length} never cached, ${stale.length} due for a staleness check (oldest first).`);
  console.log(`Budget: ${MAX_UNITS_PER_RUN} units / ${MAX_LEVELS_PER_RUN} levels this run.`);

  let processed = 0;
  let quotaHit = false;

  for (const level of queue) {
    if (processed >= MAX_LEVELS_PER_RUN) { console.log('Hit MAX_LEVELS_PER_RUN, stopping.'); break; }
    // A level always costs ~202 units now (both showcase queries run unconditionally, 100u each, plus a couple 1u videos.list calls) — stop before risking a mid-level failure that burns budget without saving a result.
    if (unitsSpent + 202 > MAX_UNITS_PER_RUN) { console.log('Hit the unit budget, stopping.'); break; }

    try {
      const videoUrl = await fetchAredlVerificationVideo(level.id);

      // Sequential, not Promise.all — a quota error from either call must
      // abort the whole run immediately (see the outer catch below) rather
      // than being swallowed as "checked, nothing found", which would
      // permanently (until the ~30-day staleness cycle) write a false
      // negative for every remaining level once quota runs out mid-run.
      const verifier = videoUrl ? await getVerifierStats(videoUrl) : null;
      const showcase = videoUrl ? await findBestShowcase(level.name, level.level_id) : null;

      cache.levels[level.id] = { name: level.name, position: level.position, verifier, showcase, checkedAt: new Date().toISOString() };
      processed++;
      console.log(`  #${level.position} ${level.name} — verifier ${verifier ? formatViews(verifier.viewCount) : '—'}, showcase ${showcase ? formatViews(showcase.viewCount) : 'none found'} (${unitsSpent}u so far)`);
    } catch (e) {
      if (e.quota) { console.log(`Quota hit on "${level.name}" — stopping this run without recording a (false) result for it.`); quotaHit = true; break; }
      console.warn(`  skipped "${level.name}": ${e.message}`);
    }
  }

  cache.generatedAt = new Date().toISOString();
  await mkdir(path.dirname(CACHE_PATH), { recursive: true });
  await writeFile(CACHE_PATH, JSON.stringify(cache, null, 2) + '\n');

  const remaining = levels.length - Object.keys(cache.levels).length;
  console.log(`Done. Processed ${processed} levels this run, ${unitsSpent} units spent${quotaHit ? ' (stopped early: quota)' : ''}. ${remaining} levels still never-cached.`);
}

function formatViews(n) {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return (n / 1000).toFixed(1) + 'K';
  return (n / 1_000_000).toFixed(1) + 'M';
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
