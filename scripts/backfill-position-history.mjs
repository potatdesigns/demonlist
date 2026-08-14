#!/usr/bin/env node
/* =====================================================================
   BACKFILL POSITION HISTORY (one-off / manual)

   scripts/refresh-aredl-cache.mjs's incremental hourly diffing only has
   data/position-history.json entries from whenever that feature first
   started running — nothing further back. This reconstructs the *real*
   history instead, straight from AREDL's own changelog (currently
   ~3200+ entries, going back to August 2022): walks every page oldest-
   first, extracts each event's resulting position for the affected
   level (Placed/Raised/Lowered/MovedToLegacy all carry `new_position`
   directly; `Swapped` is skipped whenever it can't be unambiguously
   resolved to the affected level — see resolveSwapPosition() — rather
   than guessed at), and merges the result into whatever
   data/position-history.json already has (union per level, re-sorted,
   duplicate-position runs collapsed), so nothing already recorded is
   lost or overwritten.

   NOT part of the regular hourly refresh — walking ~160 changelog pages
   is comparatively expensive, and the changelog's own past doesn't
   change, so there's no reason to re-walk all of it every hour (see
   scripts/refresh-aredl-cache.mjs's own much cheaper incremental
   approach for that). Re-run this by hand only if you want to
   re-verify against the full log, e.g. after a long gap in the hourly
   job, or to pick up any Swapped events a future version can resolve
   that this one couldn't.

   Usage: node scripts/backfill-position-history.mjs
   ===================================================================== */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HISTORY_PATH = path.join(__dirname, '..', 'data', 'position-history.json');
const AREDL_BASE = 'https://api.aredl.net/v2/api/aredl';
const PACE_MS = 150;

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
    throw new Error(`${url} returned ${res.status}`);
  }
}

/** For a Swapped event, the affected level ends up at either upper_position or upper_position+1 (a swap always trades two adjacent positions) — resolved only when affected_level unambiguously matches exactly one side, never guessed. AREDL's `other_level` field has been observed to sometimes just duplicate `upper_level` rather than naming the actual other participant, which is exactly the ambiguous case this refuses to resolve. */
function resolveSwapPosition(entry, action) {
  const affectedId = entry.affected_level?.id;
  if (!affectedId) return null;
  const isUpper = action.upper_level?.id === affectedId;
  const isOther = action.other_level?.id === affectedId;
  if (isUpper && !isOther) return action.upper_position;
  if (isOther && !isUpper) return action.upper_position + 1;
  return null;
}

function positionAfter(entry) {
  const [type, action] = Object.entries(entry.action || {})[0] || [null, {}];
  switch (type) {
    case 'Placed':
    case 'Raised':
    case 'Lowered':
    case 'MovedToLegacy':
      return Number.isFinite(action.new_position) ? action.new_position : null;
    case 'Swapped':
      return resolveSwapPosition(entry, action);
    default:
      return null;
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
  return all;
}

async function loadExistingHistory() {
  try {
    const parsed = JSON.parse(await readFile(HISTORY_PATH, 'utf8'));
    return parsed.history && typeof parsed.history === 'object' ? parsed.history : {};
  } catch {
    return {};
  }
}

async function main() {
  const entries = await fetchAllChangelogEntries();
  console.log(`Fetched ${entries.length} changelog entries total.`);

  entries.sort((a, b) => new Date(a.created_at) - new Date(b.created_at)); // oldest-first

  const existingHistory = await loadExistingHistory();
  const fromChangelog = {};
  let skippedSwaps = 0, resolvedEvents = 0;

  for (const entry of entries) {
    const id = entry.affected_level?.id;
    if (!id) continue;
    const position = positionAfter(entry);
    if (position === null) {
      const [type] = Object.entries(entry.action || {})[0] || [null];
      if (type === 'Swapped') skippedSwaps++;
      continue;
    }
    resolvedEvents++;
    const date = entry.created_at.slice(0, 10);
    const list = fromChangelog[id] || (fromChangelog[id] = []);
    const last = list[list.length - 1];
    if (last && last.position === position && last.date === date) continue; // same-day no-op
    list.push({ date, position });
  }

  // Union with whatever the hourly script already recorded — its
  // entries might extend a little past this changelog fetch, or catch
  // something a skipped Swapped event missed — then re-collapse any
  // consecutive duplicate positions the merge introduces.
  const allIds = new Set([...Object.keys(fromChangelog), ...Object.keys(existingHistory)]);
  const finalHistory = {};
  for (const id of allIds) {
    const combined = [...(fromChangelog[id] || []), ...(existingHistory[id] || [])];
    combined.sort((a, b) => a.date.localeCompare(b.date));
    const collapsed = [];
    for (const e of combined) {
      const last = collapsed[collapsed.length - 1];
      if (last && last.position === e.position) continue;
      collapsed.push(e);
    }
    finalHistory[id] = collapsed;
  }

  console.log(`Resolved ${resolvedEvents} position-changing events (skipped ${skippedSwaps} ambiguous Swapped events) across ${Object.keys(finalHistory).length} levels.`);

  await mkdir(path.dirname(HISTORY_PATH), { recursive: true });
  await writeFile(HISTORY_PATH, JSON.stringify({ generatedAt: new Date().toISOString(), history: finalHistory }, null, 2) + '\n');
  console.log(`Wrote ${HISTORY_PATH}.`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
