#!/usr/bin/env node
/* =====================================================================
   REFRESH SHARED YOUTUBE CACHE

   Populates data/yt-cache.json — the shared, precomputed cache that
   js/shared-cache.js reads client-side. Run on a schedule using a single
   server-side API key (repo secret YOUTUBE_API_KEY), so every visitor
   benefits from one controlled crawl instead of each visitor's own key
   repeating the same expensive lookups. Two modes, meant to run on two
   different schedules (see the two workflow files in .github/workflows/):

   - discover (default) — the expensive part: figure out *which* video is
     the showcase for a level (search.list, 100 units/call). Staggered
     and budget-capped (see below), because this is genuinely costly.
     Verifier video *identity* is basically free (it's just read off
     AREDL's own API), so that's resolved here too every time, cheaply.
   - views — the cheap part: for every level that already has a verifier
     and/or showcase video identified, refresh just their view counts
     (videos.list, 1 unit — batched up to 50 ids per call, so refreshing
     view counts for the *entire* ~1600-level list costs on the order of
     60-70 units total). Meant to run frequently (see
     .github/workflows/refresh-yt-views.yml, every 30 minutes) so the
     numbers shown on the site are close to real-time, decoupled from how
     slowly the expensive discovery crawl grinds through the list.

   Staggering (discover mode): rather than bucketing levels by
   day-of-week, this just always processes whichever levels have gone
   longest without their showcase being (re-)discovered (never-discovered
   first, then oldest-discoveredAt-first), capped by a per-run unit
   budget safely under YouTube's 10,000/day default quota. Each level
   costs ~102 units (one search.list call, bare level-ID query, plus a
   couple 1-unit videos.list calls) — running discover mode daily at the
   default 7000-unit budget covers roughly 68 new/re-checked levels per
   day. Self-corrects if a run is skipped or the list grows; no
   date-math bucketing needed.

   This is the only place that talks to YouTube's API at all — the site
   itself has no personal-key fallback (a genuinely global/shared cache
   means there's no reason for every visitor to need their own key too).

   Usage:
     YOUTUBE_API_KEY=... node scripts/refresh-yt-cache.mjs
     YOUTUBE_API_KEY=... YT_CACHE_MODE=views node scripts/refresh-yt-cache.mjs
   Env overrides (all optional):
     YT_CACHE_MODE         default discover — "discover" or "views", see above
     YT_CACHE_MAX_UNITS    default 7000     — discover mode: stop once this much of the day's quota would be spent
     YT_CACHE_MAX_LEVELS   default 150      — discover mode: hard cap on levels processed per run regardless of unit math
   ===================================================================== */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_PATH = path.join(__dirname, '..', 'data', 'yt-cache.json');

const AREDL_BASE = 'https://api.aredl.net/v2/api/aredl';
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;
const MODE = process.env.YT_CACHE_MODE === 'views' ? 'views' : 'discover';
const MAX_UNITS_PER_RUN = parseInt(process.env.YT_CACHE_MAX_UNITS || '7000', 10);
const MAX_LEVELS_PER_RUN = parseInt(process.env.YT_CACHE_MAX_LEVELS || '150', 10);

// Showcase channels this app trusts, resolved once (by hand, via
// `GET /youtube/v3/channels?forHandle=<handle>` — 1 unit, not the
// constrained search quota) from the handles given for this feature.
// Handles can be renamed; channel IDs can't, so those are what's used at
// match time.
// NOTE: the handle "@mindcap" (no trailing dot) resolves to an unrelated,
// near-empty channel — the real one is "@mindcap." (with the trailing dot).
const SHOWCASE_CHANNELS = [
  { name: 'Nexus', handle: 'NexusGD10', channelId: 'UCZwP1iUQiAKYQp5w-9mJb_w' },
  { name: 'Neiro', handle: 'Neiro1999', channelId: 'UCCj0f5y47A94_dahjTbem-A' },
  { name: 'Viprin', handle: 'viprin', channelId: 'UCUwapObI2gw2Tovu5oj-wng' },
  { name: 'Just a GD Player', handle: 'justagdplayer', channelId: 'UCVqV78rREnC02D1-5qYyxZQ' },
  { name: 'IcedCave', handle: 'icedcave', channelId: 'UCnG4WVthOU8yEqjol4BR44g' },
  { name: 'fnm04', handle: 'fnm04', channelId: 'UCw00BI5Nm1nXxxbTsXHNaLg' },
  { name: 'zof', handle: 'The_zof', channelId: 'UC5Ljfy4cP_jmMN2UckIOpMg' },
  { name: 'Newly Rated Extremes', handle: 'NewlyRatedExtremes', channelId: 'UClz5PjabyNVXnb0UsoQn0cw' },
  { name: 'MindCap', handle: 'mindcap.', channelId: 'UC5XddTLrnFtB1drApEfZzDQ' },
];
const KNOWN_CHANNEL_IDS = new Set(SHOWCASE_CHANNELS.map(c => c.channelId));

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

/** { id, url, title, channel, viewCount } — no description, that's only needed transiently for ID-matching. */
function statsFromItem(item) {
  return {
    id: item.id,
    url: `https://www.youtube.com/watch?v=${item.id}`,
    title: item.snippet.title,
    channel: item.snippet.channelTitle,
    viewCount: parseInt(item.statistics.viewCount || '0', 10),
  };
}

async function getVideoStats(videoId) {
  if (!videoId) return null;
  const data = await ytFetch('videos', { part: 'snippet,statistics', id: videoId });
  const item = data.items?.[0];
  return item ? statsFromItem(item) : null;
}

/**
 * Find the showcase for a level: search for the bare numeric GD level ID
 * only (no other keywords at all), restricted to the known showcase
 * channels above. Any video whose title or description doesn't actually
 * contain the ID is discarded (search relevance isn't a guaranteed
 * substring match). Among what's left, the highest-viewed video *per
 * channel* is taken as that channel's showcase, then the highest-viewed
 * of those per-channel picks wins overall.
 *
 * The ID check is done against the description from the *videos.list*
 * call below, not search.list's own snippet.description — search.list
 * truncates descriptions to a short teaser (often cut off before
 * reaching a showcaser's "ID: 123456789" line further down), which was
 * silently discarding real matches. videos.list returns the full text.
 */
async function findBestShowcase(levelId) {
  if (!levelId) return null;
  const idStr = String(levelId);

  const data = await ytFetch('search', { part: 'snippet', q: idStr, type: 'video', maxResults: '50' });
  const items = (data.items || []).filter(item => KNOWN_CHANNEL_IDS.has(item.snippet.channelId));
  if (items.length === 0) return null;

  const channelIdByVideo = new Map(items.map(item => [item.id.videoId, item.snippet.channelId]));

  const ids = [...channelIdByVideo.keys()];
  const statsData = await ytFetch('videos', { part: 'statistics,snippet', id: ids.join(',') });
  const matched = (statsData.items || [])
    .filter(item => item.snippet.title.includes(idStr) || (item.snippet.description || '').includes(idStr))
    .map(statsFromItem);
  if (matched.length === 0) return null;

  const bestPerChannel = new Map();
  for (const c of matched) {
    const chId = channelIdByVideo.get(c.id);
    const existing = bestPerChannel.get(chId);
    if (!existing || c.viewCount > existing.viewCount) bestPerChannel.set(chId, c);
  }

  return [...bestPerChannel.values()].sort((a, b) => b.viewCount - a.viewCount)[0];
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

async function saveCache(cache) {
  cache.generatedAt = new Date().toISOString();
  await mkdir(path.dirname(CACHE_PATH), { recursive: true });
  await writeFile(CACHE_PATH, JSON.stringify(cache, null, 2) + '\n');
}

function formatViews(n) {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return (n / 1000).toFixed(1) + 'K';
  return (n / 1_000_000).toFixed(1) + 'M';
}

// --- discover mode: figure out which video is the showcase (expensive, staggered) ---
async function runDiscover() {
  const [levels, cache] = await Promise.all([fetchAredlLevels(), loadExistingCache()]);
  console.log(`AREDL list: ${levels.length} levels. Cache currently has ${Object.keys(cache.levels).length} entries.`);

  const neverDiscovered = levels.filter(l => !cache.levels[l.id]);
  const stale = levels
    .filter(l => cache.levels[l.id])
    .sort((a, b) => new Date(cache.levels[a.id].discoveredAt) - new Date(cache.levels[b.id].discoveredAt));

  const queue = [...neverDiscovered, ...stale];
  console.log(`${neverDiscovered.length} never discovered, ${stale.length} due for a re-check (oldest first).`);
  console.log(`Budget: ${MAX_UNITS_PER_RUN} units / ${MAX_LEVELS_PER_RUN} levels this run.`);

  let processed = 0;
  let quotaHit = false;

  for (const level of queue) {
    if (processed >= MAX_LEVELS_PER_RUN) { console.log('Hit MAX_LEVELS_PER_RUN, stopping.'); break; }
    // A level costs ~102 units (one search.list call + a couple 1u videos.list calls) — stop before risking a mid-level failure that burns budget without saving a result.
    if (unitsSpent + 102 > MAX_UNITS_PER_RUN) { console.log('Hit the unit budget, stopping.'); break; }

    try {
      const videoUrl = await fetchAredlVerificationVideo(level.id);

      // Sequential, not Promise.all — a quota error from either call must
      // abort the whole run immediately (see the outer catch below) rather
      // than being swallowed as "checked, nothing found", which would
      // permanently (until the next staleness cycle) write a false
      // negative for every remaining level once quota runs out mid-run.
      const verifier = videoUrl ? await getVideoStats(extractYouTubeId(videoUrl)) : null;
      const showcase = videoUrl ? await findBestShowcase(level.level_id) : null;
      const now = new Date().toISOString();

      cache.levels[level.id] = {
        name: level.name,
        position: level.position,
        verifier: verifier ? { ...verifier, viewsCheckedAt: now } : null,
        showcase: showcase ? { ...showcase, viewsCheckedAt: now } : null,
        discoveredAt: now,
      };
      processed++;
      console.log(`  #${level.position} ${level.name} — verifier ${verifier ? formatViews(verifier.viewCount) : '—'}, showcase ${showcase ? `${showcase.channel} (${formatViews(showcase.viewCount)})` : 'none found'} (${unitsSpent}u so far)`);
    } catch (e) {
      if (e.quota) { console.log(`Quota hit on "${level.name}" — stopping this run without recording a (false) result for it.`); quotaHit = true; break; }
      console.warn(`  skipped "${level.name}": ${e.message}`);
    }
  }

  await saveCache(cache);
  const remaining = levels.length - Object.keys(cache.levels).length;
  console.log(`Done. Processed ${processed} levels this run, ${unitsSpent} units spent${quotaHit ? ' (stopped early: quota)' : ''}. ${remaining} levels still never-discovered.`);
}

// --- views mode: refresh view counts only, for everything already discovered (cheap, frequent) ---
async function runViews() {
  const cache = await loadExistingCache();
  const entries = Object.entries(cache.levels);

  const targets = []; // { levelId, slot: 'verifier'|'showcase', videoId }
  for (const [levelId, entry] of entries) {
    if (entry.verifier?.id) targets.push({ levelId, slot: 'verifier', videoId: entry.verifier.id });
    if (entry.showcase?.id) targets.push({ levelId, slot: 'showcase', videoId: entry.showcase.id });
  }
  console.log(`Refreshing view counts for ${targets.length} videos across ${entries.length} cached levels.`);

  const now = new Date().toISOString();
  for (let i = 0; i < targets.length; i += 50) {
    const chunk = targets.slice(i, i + 50);
    const ids = [...new Set(chunk.map(t => t.videoId))];
    const data = await ytFetch('videos', { part: 'statistics', id: ids.join(',') });
    const viewsById = new Map((data.items || []).map(item => [item.id, parseInt(item.statistics.viewCount || '0', 10)]));

    for (const t of chunk) {
      const viewCount = viewsById.get(t.videoId);
      if (viewCount === undefined) continue; // video gone/private — leave the last-known count rather than guessing
      cache.levels[t.levelId][t.slot].viewCount = viewCount;
      cache.levels[t.levelId][t.slot].viewsCheckedAt = now;
    }
  }

  await saveCache(cache);
  console.log(`Done. ${unitsSpent} units spent refreshing view counts.`);
}

(MODE === 'views' ? runViews() : runDiscover()).catch(err => {
  console.error(err);
  process.exit(1);
});
