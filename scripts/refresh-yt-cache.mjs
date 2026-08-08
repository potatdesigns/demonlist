#!/usr/bin/env node
/* =====================================================================
   REFRESH SHARED YOUTUBE CACHE

   Populates data/yt-cache.json — the shared, precomputed cache that
   js/shared-cache.js reads client-side. Run on a schedule using a single
   server-side API key (repo secret YOUTUBE_API_KEY), so every visitor
   benefits from one controlled crawl instead of each visitor's own key
   repeating the same expensive lookups. Two modes, meant to run on two
   different schedules (see the two workflow files in .github/workflows/):

   - discover (default) — figures out *which* video is the showcase for
     a level, and refreshes verifier-video identity/stats. Verifier
     identity+stats are read straight off AREDL's own API + one
     videos.list call per level (cheap: 1 unit, batched 50-at-a-time).
     Showcases are resolved by cross-referencing a *channel video index*
     (see "Channel index" below) rather than searching YouTube per
     level — this used to be a search.list call per level (100 units
     each, ~163,000 units to cover AREDL's full ~1600-level list, hence
     the old staggering/budget dance). Now showcase lookup is a free
     local map lookup once the index is built, so discover mode can
     cover every level every run; only AREDL courtesy (MAX_LEVELS_PER_RUN)
     and the shared YouTube-unit budget (for verifier stats + index
     upkeep) still cap how much happens per run. In practice neither cap
     binds anymore: this app only tracks the top LEVEL_LIST_SIZE (150)
     of AREDL's list (see that constant below), so a run's queue is at
     most 150 long — the entire tracked list gets refreshed every run.
   - views — for every level that already has a verifier and/or showcase
     identified, refresh just their view counts (videos.list, 1 unit —
     batched up to 50 ids per call). Meant to run frequently (see
     .github/workflows/refresh-yt-views.yml, every 30 minutes) so the
     numbers shown on the site stay close to real-time. Also doubles as
     the freshness source for verifier views between discover runs.

   Channel index (discover mode): for each trusted showcase channel
   (SHOWCASE_CHANNELS below), the whole uploads history gets crawled via
   its uploads playlist (channel ID with UC -> UU, no lookup needed) —
   playlistItems.list (1 unit/50 videos) for the ID list, then
   videos.list (1 unit/50 videos) for full title+description+stats.
   Every video's title+description is scanned for standalone 5-10 digit
   runs (candidate GD level IDs), and that's cached per video
   (cache.channelIndex[channelId].videos), so re-matching against a
   growing level list never needs to hit YouTube again. Once a channel's
   full history is indexed (backfillDone), each later run only needs a
   cheap "catch up to the newest known video" pass (cache.channelIndex[
   channelId].newestVideoId is the watermark) — a handful of units per
   channel, most days. Showcase-for-a-level is then: every indexed video
   (across all channels) whose extracted ID set contains that level's
   ID, highest-viewed *per channel*, then highest-viewed of those
   per-channel picks wins overall — the same selection rule the old
   per-level search used, just running against a complete local index
   instead of whatever a single search.list call's top-50 happened to
   surface.

   This is the only place that talks to YouTube's API at all — the site
   itself has no personal-key fallback (a genuinely global/shared cache
   means there's no reason for every visitor to need their own key too).

   Usage:
     YOUTUBE_API_KEY=... node scripts/refresh-yt-cache.mjs
     YOUTUBE_API_KEY=... YT_CACHE_MODE=views node scripts/refresh-yt-cache.mjs
   Env overrides (all optional):
     YT_CACHE_MODE           default discover — "discover" or "views", see above
     YT_CACHE_MAX_UNITS      default 7000     — discover mode: total quota-unit ceiling for the run (index upkeep + verifier stats)
     YT_CACHE_CHANNEL_BUDGET default 4000     — discover mode: of that ceiling, how much the channel-index phase alone may spend (leaves room for verifier stats)
     YT_CACHE_MAX_LEVELS     default 150      — discover mode: hard cap on levels processed per run (AREDL-courtesy, not quota-driven anymore)
     YT_CACHE_TARGET_LEVEL_ID default (none)  — discover mode: AREDL internal id (not the GD level id) of a single level to force-refresh, bypassing the staggered queue entirely — see the detail page's "refresh this level" button
   ===================================================================== */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_PATH = path.join(__dirname, '..', 'data', 'yt-cache.json');

const AREDL_BASE = 'https://api.aredl.net/v2/api/aredl';
// Keep in sync with CONFIG.LIST_SIZE in js/config.js and LEVEL_LIST_SIZE in
// scripts/refresh-aredl-cache.mjs — this app only tracks the top this-many
// AREDL positions, not the full ~1600-level list. Levels that fall out of
// the top LEVEL_LIST_SIZE (positions shift as new levels get placed) are
// pruned from the cache below rather than left to accumulate forever.
const LEVEL_LIST_SIZE = 150;
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;
const MODE = process.env.YT_CACHE_MODE === 'views' ? 'views' : 'discover';
const MAX_UNITS_PER_RUN = parseInt(process.env.YT_CACHE_MAX_UNITS || '7000', 10);
const CHANNEL_INDEX_BUDGET = parseInt(process.env.YT_CACHE_CHANNEL_BUDGET || '4000', 10);
const MAX_LEVELS_PER_RUN = parseInt(process.env.YT_CACHE_MAX_LEVELS || '150', 10);
const TARGET_LEVEL_ID = process.env.YT_CACHE_TARGET_LEVEL_ID || null;

// Safety caps for the channel-index crawl (see refreshChannelIndex): bound
// per-channel cost per run so one large/stale channel can't eat a whole
// run's budget or (if its watermark video vanished) re-walk its entire
// history every single run.
const MAX_CATCHUP_PAGES = 10; // "catch up to newest known video" pass: 10 pages = 500 videos before giving up and resetting the watermark
const MAX_BACKFILL_PAGES_PER_CHANNEL = 20; // "walk further into history" pass: 1000 videos/channel/run

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

if (!YOUTUBE_API_KEY) {
  console.error('YOUTUBE_API_KEY is not set — nothing to do.');
  process.exit(1);
}

function extractYouTubeId(url) {
  if (!url) return null;
  const m = url.match(/(?:youtube\.com\/watch\?v=|youtube\.com\/shorts\/|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/);
  return m ? m[1] : null;
}

/** Standalone 5-10 digit runs (candidate GD level IDs) — not adjacent to further digits, so a 6-digit ID can't falsely match inside a longer number. */
function extractLevelIds(text) {
  return [...new Set((text || '').match(/(?<!\d)\d{5,10}(?!\d)/g) || [])];
}

/** A channel's uploads playlist ID is always its channel ID with the UC prefix swapped for UU. */
function uploadsPlaylistId(channelId) {
  return 'UU' + channelId.slice(2);
}

let unitsSpent = 0;
let quotaHit = false;
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

async function fetchAredlLevels() {
  const res = await fetch(`${AREDL_BASE}/levels`, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`AREDL returned ${res.status} for the level list`);
  const data = await res.json();
  return (Array.isArray(data) ? data : (data.data || data.levels || []))
    .sort((a, b) => a.position - b.position)
    .slice(0, LEVEL_LIST_SIZE);
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

// --- channel index: crawl each trusted channel's uploads once, then keep it caught up cheaply ---

/**
 * Bring one channel's index up to date: a cheap "catch up to the newest
 * video we already know about" pass, plus (if the channel's full history
 * hasn't been walked yet) a bounded step further into its backlog. Newly
 * seen video IDs get their title+description+stats fetched (videos.list,
 * batched 50) and their candidate level IDs extracted and cached — so
 * later runs never need to re-fetch or re-scan a video once it's indexed.
 */
async function refreshChannelIndex(channel, entry, budget) {
  const playlistId = uploadsPlaylistId(channel.channelId);
  const newIds = [];

  if (entry.newestVideoId) {
    let pageToken;
    for (let page = 0; page < MAX_CATCHUP_PAGES && unitsSpent < budget; page++) {
      const data = await ytFetch('playlistItems', { part: 'contentDetails', playlistId, maxResults: '50', ...(pageToken ? { pageToken } : {}) });
      const ids = (data.items || []).map(i => i.contentDetails.videoId);
      const idx = ids.indexOf(entry.newestVideoId);
      if (idx !== -1) { newIds.push(...ids.slice(0, idx)); break; }
      newIds.push(...ids);
      if (!data.nextPageToken) break;
      pageToken = data.nextPageToken;
    }
    // Not found within the cap (video deleted/private, or >500 new uploads since last run) —
    // fall through and let the watermark reset below rather than re-walking the whole channel.
  }
  if (newIds.length) entry.newestVideoId = newIds[0];

  if (!entry.backfillDone) {
    let pageToken = entry.oldestPageToken || undefined;
    for (let page = 0; page < MAX_BACKFILL_PAGES_PER_CHANNEL && unitsSpent < budget; page++) {
      const data = await ytFetch('playlistItems', { part: 'contentDetails', playlistId, maxResults: '50', ...(pageToken ? { pageToken } : {}) });
      const ids = (data.items || []).map(i => i.contentDetails.videoId);
      if (!entry.newestVideoId && ids.length) entry.newestVideoId = ids[0]; // very first run: page 1 is the newest video
      newIds.push(...ids);
      if (!data.nextPageToken) { entry.backfillDone = true; entry.oldestPageToken = null; break; }
      entry.oldestPageToken = pageToken = data.nextPageToken;
    }
  }

  const idsToFetch = [...new Set(newIds)].filter(id => !entry.videos[id]);
  const now = new Date().toISOString();
  for (let i = 0; i < idsToFetch.length && unitsSpent < budget; i += 50) {
    const chunk = idsToFetch.slice(i, i + 50);
    const data = await ytFetch('videos', { part: 'snippet,statistics', id: chunk.join(',') });
    for (const item of data.items || []) {
      entry.videos[item.id] = {
        title: item.snippet.title,
        channel: item.snippet.channelTitle,
        viewCount: parseInt(item.statistics.viewCount || '0', 10),
        levelIds: extractLevelIds(`${item.snippet.title}\n${item.snippet.description || ''}`),
        checkedAt: now,
      };
    }
  }

  console.log(`  ${channel.name}: +${idsToFetch.length} new video(s) indexed (${Object.keys(entry.videos).length} total, backfill ${entry.backfillDone ? 'complete' : 'in progress'}).`);
}

async function updateChannelIndex(cache) {
  const budget = Math.min(MAX_UNITS_PER_RUN, CHANNEL_INDEX_BUDGET);
  for (const channel of SHOWCASE_CHANNELS) {
    if (quotaHit || unitsSpent >= budget) break;
    if (!cache.channelIndex[channel.channelId]) {
      cache.channelIndex[channel.channelId] = { name: channel.name, newestVideoId: null, oldestPageToken: null, backfillDone: false, videos: {} };
    }
    try {
      await refreshChannelIndex(channel, cache.channelIndex[channel.channelId], budget);
    } catch (e) {
      if (e.quota) { console.log(`Quota hit indexing ${channel.name} — stopping channel-index phase.`); quotaHit = true; break; }
      console.warn(`  ${channel.name}: index refresh failed: ${e.message}`);
    }
  }
}

/** levelId (string) -> every indexed video across all channels whose title/description contains it. */
function buildLevelIndex(cache) {
  const index = new Map();
  for (const channel of SHOWCASE_CHANNELS) {
    const entry = cache.channelIndex[channel.channelId];
    if (!entry) continue;
    for (const [videoId, v] of Object.entries(entry.videos)) {
      for (const levelId of v.levelIds) {
        if (!index.has(levelId)) index.set(levelId, []);
        index.get(levelId).push({
          id: videoId,
          url: `https://www.youtube.com/watch?v=${videoId}`,
          title: v.title,
          channel: v.channel,
          viewCount: v.viewCount,
          channelId: channel.channelId,
        });
      }
    }
  }
  return index;
}

/** Highest-viewed video per channel among candidates for this level, then the highest-viewed of those per-channel picks. */
function bestShowcaseFor(levelId, levelIndex) {
  const candidates = levelIndex.get(String(levelId));
  if (!candidates || candidates.length === 0) return null;

  const bestPerChannel = new Map();
  for (const c of candidates) {
    const existing = bestPerChannel.get(c.channelId);
    if (!existing || c.viewCount > existing.viewCount) bestPerChannel.set(c.channelId, c);
  }

  const { channelId, ...best } = [...bestPerChannel.values()].sort((a, b) => b.viewCount - a.viewCount)[0];
  return best;
}

// --- discover mode: refresh the channel index, then match + refresh verifiers for every level (staggered by AREDL-courtesy cap) ---
async function runDiscover() {
  const [levels, cache] = await Promise.all([fetchAredlLevels(), loadExistingCache()]);
  if (!cache.channelIndex) cache.channelIndex = {};
  console.log(`AREDL list: ${levels.length} levels. Cache currently has ${Object.keys(cache.levels).length} entries.`);

  // Drop cache entries for levels that fell out of the top LEVEL_LIST_SIZE
  // (position shifted below the cutoff) — otherwise they'd sit in
  // data/yt-cache.json forever, un-refreshed and unused, defeating the
  // point of capping the list in the first place.
  const currentIds = new Set(levels.map(l => String(l.id)));
  let pruned = 0;
  for (const id of Object.keys(cache.levels)) {
    if (!currentIds.has(id)) { delete cache.levels[id]; pruned++; }
  }
  if (pruned) console.log(`Pruned ${pruned} level(s) that fell out of the top ${LEVEL_LIST_SIZE}.`);

  try {
    console.log('Updating channel index...');
    await updateChannelIndex(cache);
    const totalIndexed = Object.values(cache.channelIndex).reduce((n, c) => n + Object.keys(c.videos).length, 0);
    console.log(`Channel index: ${totalIndexed} videos across ${SHOWCASE_CHANNELS.length} channels (${unitsSpent}u so far).`);

    const levelIndex = buildLevelIndex(cache);

    // Manual single-level override — see the detail page's "refresh this
    // level" button (js/cache-admin-ui.js), which copies a level's AREDL
    // internal id to the clipboard for pasting in here. Bypasses the
    // staggered queue and MAX_LEVELS_PER_RUN entirely; a single level is
    // trivial next to either budget.
    let queue;
    if (TARGET_LEVEL_ID) {
      const target = levels.find(l => String(l.id) === TARGET_LEVEL_ID);
      if (target) {
        queue = [target];
        console.log(`Targeting a single level: #${target.position} ${target.name} (${TARGET_LEVEL_ID}).`);
      } else {
        console.warn(`target_level_id "${TARGET_LEVEL_ID}" isn't in the current top ${LEVEL_LIST_SIZE} — falling back to the normal staggered queue.`);
      }
    }
    if (!queue) {
      const neverDiscovered = levels.filter(l => !cache.levels[l.id]);
      const stale = levels
        .filter(l => cache.levels[l.id])
        .sort((a, b) => new Date(cache.levels[a.id].discoveredAt) - new Date(cache.levels[b.id].discoveredAt));
      queue = [...neverDiscovered, ...stale].slice(0, MAX_LEVELS_PER_RUN);
      console.log(`${neverDiscovered.length} never discovered, ${stale.length} due for a re-check. Processing ${queue.length} levels this run.`);
    }

    // AREDL verification-video lookups are plain HTTP, no YouTube quota — sequential, one per level.
    const videoUrlByLevel = new Map();
    for (const level of queue) {
      try {
        videoUrlByLevel.set(level.id, await fetchAredlVerificationVideo(level.id));
      } catch (e) {
        console.warn(`  skipped AREDL lookup for "${level.name}": ${e.message}`);
      }
    }

    // Batch-fetch verifier video stats, 50 at a time — same trick as views mode.
    const verifierIds = [...new Set([...videoUrlByLevel.values()].map(extractYouTubeId).filter(Boolean))];
    const verifierStats = new Map();
    const attemptedVerifierIds = new Set();
    for (let i = 0; i < verifierIds.length; i += 50) {
      if (quotaHit) break;
      if (unitsSpent + 1 > MAX_UNITS_PER_RUN) { console.log('Hit the unit budget fetching verifier stats, stopping early.'); break; }
      const chunk = verifierIds.slice(i, i + 50);
      chunk.forEach(id => attemptedVerifierIds.add(id));
      try {
        const data = await ytFetch('videos', { part: 'snippet,statistics', id: chunk.join(',') });
        for (const item of data.items || []) verifierStats.set(item.id, statsFromItem(item));
      } catch (e) {
        if (e.quota) { console.log('Quota hit fetching verifier stats — stopping.'); quotaHit = true; break; }
        console.warn(`  verifier stats batch failed: ${e.message}`);
      }
    }

    const now = new Date().toISOString();
    let processed = 0;
    for (const level of queue) {
      if (!videoUrlByLevel.has(level.id)) continue; // AREDL lookup failed above
      const videoUrl = videoUrlByLevel.get(level.id);
      const verifierId = videoUrl ? extractYouTubeId(videoUrl) : null;
      if (verifierId && !attemptedVerifierIds.has(verifierId)) continue; // quota/budget ran out before we could check this one — retry next run rather than recording a false negative

      const verifier = verifierId ? (verifierStats.get(verifierId) || null) : null;
      const showcase = bestShowcaseFor(level.level_id, levelIndex);
      cache.levels[level.id] = {
        name: level.name,
        position: level.position,
        verifier: verifier ? { ...verifier, viewsCheckedAt: now } : null,
        showcase: showcase ? { ...showcase, viewsCheckedAt: now } : null,
        discoveredAt: now,
      };
      processed++;
      console.log(`  #${level.position} ${level.name} — verifier ${verifier ? formatViews(verifier.viewCount) : '—'}, showcase ${showcase ? `${showcase.channel} (${formatViews(showcase.viewCount)})` : 'none found'}`);
    }

    const remaining = levels.length - Object.keys(cache.levels).length;
    console.log(`Done. Processed ${processed} levels this run, ${unitsSpent} units spent${quotaHit ? ' (stopped early: quota)' : ''}. ${remaining} levels still never-discovered.`);
  } finally {
    // Always persist whatever progress was made (channel index + any levels processed), even on quota/error.
    await saveCache(cache);
  }
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
