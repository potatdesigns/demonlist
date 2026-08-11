#!/usr/bin/env node
/* =====================================================================
   WATCH FOR AREDL CHANGES AFFECTING THE TOP 150

   Polls AREDL's changelog (cheap — one page, not the full ~1600-level
   list) for anything touching the tracked top LEVEL_LIST_SIZE since the
   last run — not just new placements: a Raised/Lowered/Swapped/
   MovedToLegacy affecting a position ≤ LEVEL_LIST_SIZE means
   data/aredl-cache.json's positions are stale too, same as an addition
   would. Any such change:

     1. Triggers refresh-aredl-cache.yml once per run (not once per
        change) — so data/aredl-cache.json, and every card/detail page
        reading it, picks up the new positions right away instead of
        waiting up to an hour for that workflow's own schedule.

   And specifically for a new placement (a level entering the top 150
   for the first time, not just moving within it):

     2. Also triggers refresh-yt-cache.yml's discover mode scoped to
        just that level (target_level_id) — so its verifier/showcase
        gets found immediately instead of waiting for the staggered
        daily queue to reach it, same as the detail page's "refresh
        this level" button. Only placements get this one — a level
        that was already in the top 150 and just moved already has a
        verifier/showcase on file, nothing new to discover for it. Safe
        to fire in parallel with (1): that script fetches its own live
        AREDL level list rather than reading data/aredl-cache.json, so
        it doesn't need (1) to have finished first — see
        fetchAredlLevels() in refresh-yt-cache.mjs.

   State (data/new-level-watch.json: { lastCheckedAt }) is what "since
   the last run" is measured against, published to the cache branch the
   same way the other refresh scripts publish their own files. A first
   run (no prior state) just records "now" and triggers nothing — the
   point is catching new changes going forward, not replaying whatever's
   already in AREDL's changelog history.

   Requires GITHUB_TOKEN with `actions: write` on this repo — the
   calling workflow's own ambient secrets.GITHUB_TOKEN is enough.
   Dispatching a *different* workflow via the REST API in the same repo
   doesn't need a separate PAT the way triggering one from *outside*
   GitHub Actions does (see worker/src/index.js, which does need one —
   different caller, different trust boundary).

   Usage: node scripts/watch-new-levels.mjs
   ===================================================================== */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE_PATH = path.join(__dirname, '..', 'data', 'new-level-watch.json');
const AREDL_BASE = 'https://api.aredl.net/v2/api/aredl';

// Keep in sync with CONFIG.LIST_SIZE in js/config.js / LEVEL_LIST_SIZE in
// refresh-aredl-cache.mjs — this app only tracks the top this-many.
const LEVEL_LIST_SIZE = 150;

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO = process.env.GITHUB_REPO; // "owner/repo"
const GIT_REF = process.env.GIT_REF || 'main';

async function fetchJson(url) {
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`${url} returned ${res.status}`);
  return res.json();
}

async function dispatchWorkflow(workflowFile, inputs = {}) {
  const url = `https://api.github.com/repos/${GITHUB_REPO}/actions/workflows/${workflowFile}/dispatches`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'demonlist-watch-new-levels',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ref: GIT_REF, inputs }),
  });
  if (res.status !== 204) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Dispatching ${workflowFile} failed (${res.status}): ${detail.slice(0, 300)}`);
  }
  console.log(`  dispatched ${workflowFile}${Object.keys(inputs).length ? ' with ' + JSON.stringify(inputs) : ''}`);
}

async function loadState() {
  try {
    return JSON.parse(await readFile(STATE_PATH, 'utf8'));
  } catch {
    return {};
  }
}

/** Every numeric rank a changelog action references, whatever its shape (Placed only has new_position; Raised/Lowered/MovedToLegacy have both; Swapped nests its position under upper_position) — same helper as changelogPositions() in js/api-aredl.js, duplicated here since this runs standalone in Node, not the browser. */
function changelogPositions(entry) {
  const variant = Object.values(entry.action || {})[0] || {};
  return [variant.new_position, variant.old_position, variant.upper_position].filter(Number.isFinite);
}

async function main() {
  if (!GITHUB_TOKEN || !GITHUB_REPO) {
    throw new Error('GITHUB_TOKEN and GITHUB_REPO must both be set.');
  }

  const state = await loadState();
  const isFirstRun = !state.lastCheckedAt;
  const since = state.lastCheckedAt ? new Date(state.lastCheckedAt) : null;

  // One page (20 entries) is comfortably more than could land between
  // two runs of this workflow short of an extraordinary event, so
  // there's no need to page further back.
  const page = await fetchJson(`${AREDL_BASE}/changelog?page=1`);
  const entries = Array.isArray(page.data) ? page.data : [];

  let newest = since;
  const relevantChanges = [];
  const newPlacements = [];
  for (const entry of entries) {
    const createdAt = new Date(entry.created_at);
    if (!newest || createdAt > newest) newest = createdAt;
    if (since && createdAt <= since) continue; // already seen last run

    const positions = changelogPositions(entry);
    if (!positions.length || Math.min(...positions) > LEVEL_LIST_SIZE) continue; // didn't touch the top 150 at all
    relevantChanges.push(entry);

    const [type, action] = Object.entries(entry.action || {})[0] || [null, {}];
    if (type === 'Placed' && Number.isFinite(action.new_position) && action.new_position <= LEVEL_LIST_SIZE) {
      newPlacements.push({ id: entry.affected_level?.id, name: entry.affected_level?.name, position: action.new_position });
    }
  }

  if (isFirstRun) {
    console.log('First run — recording the current watermark without triggering anything (avoids replaying all of changelog history).');
  } else if (!relevantChanges.length) {
    console.log('No changes touching the top 150 since the last check.');
  } else {
    console.log(`${relevantChanges.length} change(s) touching the top ${LEVEL_LIST_SIZE} — refreshing the AREDL cache.`);
    await dispatchWorkflow('refresh-aredl-cache.yml');

    if (newPlacements.length) {
      console.log(`  ${newPlacements.length} of those were new placements: ${newPlacements.map(p => `"${p.name}" at #${p.position}`).join(', ')}`);
      for (const p of newPlacements) {
        if (p.id) await dispatchWorkflow('refresh-yt-cache.yml', { target_level_id: p.id });
        else console.warn(`  skipping yt-cache trigger for "${p.name}" — changelog entry had no level id`);
      }
    }
  }

  await mkdir(path.dirname(STATE_PATH), { recursive: true });
  await writeFile(STATE_PATH, JSON.stringify({ lastCheckedAt: (newest || new Date()).toISOString() }, null, 2) + '\n');
  console.log(`Watermark now ${(newest || new Date()).toISOString()}.`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
