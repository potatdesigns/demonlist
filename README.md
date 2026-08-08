# Demonlist

An AREDL-powered extreme demon list for Geometry Dash, showing the **top 150** — Main List
(#1-75) + Extended List (#76-150) — rather than AREDL's full ~1600-level rated list (see
[Reducing to a top-150 list](#reducing-to-a-top-150-list) below for why and how). Pure HTML/CSS/JS,
no build step for the site itself — open `index.html` in a browser or host the folder anywhere static.
(A couple of small Node scripts + scheduled GitHub Actions maintain a few JSON files in the
background — see [Shared showcase/view-count cache](#shared-showcaseview-count-cache) and
[Shared AREDL level-list cache](#shared-aredl-level-list-cache) below.)

## Running it

Because it uses `fetch()`, most browsers block it under `file://`. Serve it locally instead:

```bash
cd demonlist
python3 -m http.server 8080
# then open http://localhost:8080
```

Any static host (GitHub Pages, Netlify, Vercel, etc.) works too — just upload the folder as-is.

## What it does

- **List page (`index.html`)** — pulls the top 150 of AREDL's live, currently-ranked list (AREDL
  itself has ~1600 rated extreme demons; see [Reducing to a top-150 list](#reducing-to-a-top-150-list))
  and renders it as a grid of cards: thumbnail (of the verification video), rank, name,
  creator(s), publisher, verifier, and — side by side — the verifier video's view count vs. the
  most-viewed *same-level* showcase's view count, with the higher number highlighted in gold.
  Paginated 75-at-a-time (5 columns x 15 rows at desktop width) with Prev/Next and a "page X of
  Y" jump box; **Main List** and **Extended List** buttons jump straight to page 1 (#1-75) and
  page 2 (#76-150). Search filters across the *entire* list, not just the current page, and the
  **Open rank** box takes you straight *into* that level's detail page (`AredlAPI.getIdByPosition()`
  resolves the rank to an id client-side, from the already-cached full list — no extra round trip)
  rather than just the list page it happens to sit on.
- **Detail page (`level.html`)** — click any card (or use Open rank) for the full picture: list
  ID, GD level ID, points, verifier, publisher, all creators, an embedded player for the official
  verification video, and an embedded player for the auto-discovered top showcase, with both view
  counts shown for direct comparison. A refresh icon next to that section lets a signed-in
  collaborator force a re-check of just this level (see
  [Manual refresh](#shared-showcaseview-count-cache) below).

## Reducing to a top-150 list

This app only tracks AREDL's top `CONFIG.LIST_SIZE` positions (150, matching the classic Main
List #1-75 + Extended List #76-150 split) rather than AREDL's full, ever-growing rated-extreme-
demon list (~1600 entries and counting). AREDL was kept as the data source — Pointercrate was
considered, but its own `/demons/listed/` endpoint isn't actually capped at 150 either anymore
(confirmed live: positions well past 600 still come back), and it sits behind a Cloudflare
managed challenge that hard-blocks plain server-to-server requests, which would have made every
scheduled cache refresh depend on a public CORS proxy's uptime. AREDL has neither problem, so
switching data sources wouldn't have bought anything — capping AREDL's own list does.

The cap is applied at the source, not just hidden in the UI, so the "managing 1600 levels" burden
this was added to avoid doesn't resurface in the cache files either:

- **`scripts/refresh-aredl-cache.mjs`** fetches AREDL's full list, sorts by position, and writes
  only the top `LEVEL_LIST_SIZE` (150) to `data/aredl-cache.json` — that file never has more than
  150 entries.
- **`scripts/refresh-yt-cache.mjs`** does the same for its own AREDL fetch, and additionally
  *prunes* `data/yt-cache.json` on every `discover` run: any level that previously made the top
  150 but has since been pushed out (new levels get inserted above existing ones, shifting
  positions down) has its cached entry deleted, rather than sitting there forever unused.
- **`js/api-aredl.js`**'s live-API fallback (used only if `data/aredl-cache.json` is missing or
  fails to load) applies the same `.slice(0, CONFIG.LIST_SIZE)`, so it can never show more than
  the cached snapshot would.

`CONFIG.LIST_SIZE` in `js/config.js` and the matching `LEVEL_LIST_SIZE` constants in both scripts
are the single knob if you ever want a different cutoff — keep all three in sync.

## Cache branch

The three scheduled cache-refresh workflows (`refresh-aredl-cache.yml`, `refresh-yt-cache.yml`,
`refresh-yt-views.yml`) publish their generated `data/*.json` files to a dedicated `cache` branch,
**not** `main`. `main` doesn't track `data/*.json` at all (see `.gitignore`) — the site fetches
both files straight from the `cache` branch via `raw.githubusercontent.com`
(`CONFIG.SHARED_YT_CACHE_URL` / `AREDL_CACHE_URL` in `js/config.js`, built from `GITHUB_REPO` +
`CACHE_BRANCH`; confirmed `raw.githubusercontent.com` sends `Access-Control-Allow-Origin: *`, so
this works as a plain cross-origin `fetch()`).

Why: with three workflows running as often as every 30 minutes, `main` was accumulating dozens of
bot commits a day, and a human's `git push` on `main` would get rejected ("remote contains work
you do not have") any time one of those had landed since the last pull — routine, not exceptional,
given the views workflow alone runs 48 times a day. Moving that churn to its own branch means
`main` only ever moves when a person moves it.

[`scripts/publish-cache-branch.sh`](scripts/publish-cache-branch.sh) is what each workflow calls
instead of a plain `git commit && git push`: it works from an isolated `git worktree` checked out
on `cache` (never touching whatever's checked out in the main job), re-fetches and hard-resets to
`origin/cache` right before every commit attempt, and retries (up to 5 times, with a short random
backoff) if the push is rejected — expected now, since the AREDL workflow and both YouTube
workflows all target this one branch (different files, but the same ref).

One consequence: `scripts/refresh-yt-cache.mjs`'s incremental discover logic (staggering, the
channel-index watermarks) and the views refresh both depend on the *existing* `data/yt-cache.json`
as their starting point. Since that file no longer sits in the `main` checkout, both YouTube
workflows fetch the current version from the `cache` branch (`git show
origin/cache:data/yt-cache.json`) as a step before running the script. `refresh-aredl-cache.mjs`
doesn't need this — it always regenerates its file from scratch.

Trade-off: `raw.githubusercontent.com` caches responses for ~5 minutes (`Cache-Control:
max-age=300`), negligible against the 30-minute/hourly/daily refresh cadences. Forks need to
update `GITHUB_REPO` in `js/config.js` (already noted there) and bootstrap their own `cache`
branch — an orphan branch containing just a `data/` directory is enough; running any of the
scripts locally and committing the output there once seeds it.

## Shared showcase/view-count cache

View counts and "find the showcase on YouTube" both need YouTube's Data API, which is
quota-limited (commonly 10,000 units/day, and a `search.list` call costs 100 of those; newer
projects can start out with a much lower search-specific sub-limit until Google raises it).
Even tracking only the top 150 (see [Reducing to a top-150 list](#reducing-to-a-top-150-list)),
every visitor doing their own lookups would burn through that fast and repeat the exact same
searches everyone else already ran — so there's no personal-key option here at all. `data/yt-cache.json` is a **shared, precomputed cache** published to the
[`cache` branch](#cache-branch) (not `main`), populated by
[`scripts/refresh-yt-cache.mjs`](scripts/refresh-yt-cache.mjs) on two separate schedules (see
below), and the site just fetches that one static JSON file (`js/shared-cache.js`) — **zero
YouTube API calls happen in the browser, ever.** A level whose showcase hasn't been found yet
just shows "Not cached yet".

The script runs in two modes, split because *which video is the showcase* and *how many views
it has* have very different costs and staleness needs:

- **`discover`** — figures out which video is the showcase for a level, by cross-referencing a
  local **channel video index** (`cache.channelIndex`) instead of searching YouTube per level.
  For each trusted showcase channel (see the algorithm below), the script walks its *uploads
  playlist* (`playlistItems.list`, 1 unit/50 videos — the playlist ID is just the channel ID with
  `UC` swapped for `UU`, no lookup needed) and fetches full title+description+stats for every new
  video (`videos.list`, 1 unit/50), extracting candidate GD level IDs (standalone 5-10 digit runs)
  from the text once and caching that per video. A channel only needs its *entire* history walked
  once (`backfillDone`); after that, each run just catches up to the newest video it already knows
  about (`newestVideoId`) — a handful of units per channel, most days. Indexing an entire channel's
  history from scratch costs on the order of a few hundred units total across all 9 channels — far
  cheaper than the old per-level `search.list` approach (100 units *per level*, ~163,000 units to
  cover the full list). Once the index exists, showcase-matching for every level is a free local
  map lookup, so `discover` covers every level every run; only a per-run level cap
  (`YT_CACHE_MAX_LEVELS`, default 150, now just AREDL courtesy rather than quota-driven) and the
  overall unit ceiling (`YT_CACHE_MAX_UNITS`, default 7000, split against `YT_CACHE_CHANNEL_BUDGET`
  for the indexing phase) still bound a single run. The script always stops cleanly on a quota
  error rather than writing bad data — a level whose verifier videos.list call got cut off by
  quota is left for the next run instead of being recorded with a false "no verifier found". Runs
  daily ([`refresh-yt-cache.yml`](.github/workflows/refresh-yt-cache.yml)); self-correcting if a
  run is skipped or the list grows.
- **`views`** (cheap, frequent) — once a level has a verifier/showcase video *identified*, its
  view count is refreshed independently of the (slow) discovery cycle: one batched
  `videos.list` call per 50 videos, so refreshing the *entire* list's view counts costs on the
  order of 60-70 units total. Runs every 30 minutes
  ([`refresh-yt-views.yml`](.github/workflows/refresh-yt-views.yml)), so the numbers shown on
  the site stay close to real-time even though which-video-is-the-showcase only gets
  (re-)checked once every few weeks.

Both workflows write the same file, so they share a `concurrency` group (only one runs at a
time) and both publish via [`scripts/publish-cache-branch.sh`](scripts/publish-cache-branch.sh)
(see [Cache branch](#cache-branch)), which retries on a rejected push rather than assuming it
won't happen.

**Manual refresh**: each detail page has a refresh icon (`js/cache-admin-ui.js`,
`mountLevelRefreshButton()`) next to "Verification vs. showcase" that copies that level's AREDL
internal id to the clipboard and opens the discover workflow's page on GitHub Actions
(`https://github.com/<repo>/actions/workflows/refresh-yt-cache.yml`) — paste the id into the
optional `target_level_id` input there to force a re-check of just that level, bypassing the
normal staggered queue (see `YT_CACHE_TARGET_LEVEL_ID` in `scripts/refresh-yt-cache.mjs`). This
isn't a one-click trigger, the same way the old site-wide version wasn't: GitHub's
`workflow_dispatch` API needs an authenticated request, and there's no safe way to expose that
from a public static site (embedding a token client-side would let anyone on the internet trigger
runs and burn the day's quota). The button is shown to every visitor since it's harmless either
way — GitHub's own permissions gate the actual "Run workflow" button to signed-in collaborators
with write access; a visitor without that access just ends up looking at a page they can't submit.

### Setting it up

1. Get a free key from the [Google Cloud Console](https://console.cloud.google.com/apis/credentials)
   (enable "YouTube Data API v3").
2. Add it as a repository secret: **Settings → Secrets and variables → Actions → New repository
   secret**, name `YOUTUBE_API_KEY`. Both workflows use it.
3. That's it — both workflows run on their own schedule, or trigger either manually from the
   **Actions** tab (the discover workflow also takes optional `max_levels`/`max_units`
   overrides for that one run).

You can also run either locally: `YOUTUBE_API_KEY=... node scripts/refresh-yt-cache.mjs` (discover)
or `YOUTUBE_API_KEY=... YT_CACHE_MODE=views node scripts/refresh-yt-cache.mjs` (views).

### Showcase-matching algorithm

`bestShowcaseFor()` in the script, run against the channel index described above:

1. The candidate pool is every video from a fixed allowlist of known showcase channels (see
   `SHOWCASE_CHANNELS` in the script) — there's no search step, so nothing outside the allowlist
   is ever considered, and nothing is excluded by title keyword (earlier versions filtered out
   titles containing "verification", but plenty of legitimate showcases use words like "verified"
   too, so that's gone).
2. A video counts as a candidate for a level if that level's numeric ID appears as a standalone
   5-10 digit run (not glued to other digits) anywhere in its title or description — extracted
   once per video when it's indexed, not re-scanned per level.
3. Take the highest-viewed video *per channel*, then the highest-viewed of those across
   channels is the winner.

The allowlist is currently: Nexus, Neiro, Viprin, Just a GD Player, IcedCave, fnm04, zof,
Newly Rated Extremes, and MindCap (resolved to channel IDs via `channels.list?forHandle=`, not
the search quota — see `SHOWCASE_CHANNELS` in the script). Note MindCap's handle is
`@mindcap.` *with* a trailing dot — `@mindcap` (no dot) is an unrelated, near-empty channel.

## Shared AREDL level-list cache

Separately from the YouTube data, `data/aredl-cache.json` is a snapshot of the top `LEVEL_LIST_SIZE`
(150) of AREDL's own `GET /levels` (the bare list — id, name, position, level_id, points, etc.;
see [Reducing to a top-150 list](#reducing-to-a-top-150-list) for why it's capped there rather
than the full list), published to the [`cache` branch](#cache-branch) hourly by
[`scripts/refresh-aredl-cache.mjs`](scripts/refresh-aredl-cache.mjs) /
[`refresh-aredl-cache.yml`](.github/workflows/refresh-aredl-cache.yml). `AredlAPI.fetchFullList()`
(`js/api-aredl.js`) reads that snapshot first and only falls back to a live AREDL call if it's
missing or fails to load — so instead of every single visitor's page load independently
re-fetching AREDL's full ~1600-entry list, there's one shared, periodically-refreshed, already-
trimmed-to-150 copy. This needs no API key (AREDL's list endpoint is public and free) and no
budget/staggering logic — it's cheap enough to just refresh the whole thing every run. Hourly is
comfortably ahead of how often levels actually get reordered/added ("every day or so"); nothing
about level *position* changes faster than that in practice.

This only covers the base list. Per-level detail (verification video, publisher, creators) —
which needs a separate `GET /levels/{id}` call per level — is unrelated and still fetched
live/lazily as cards scroll into view, same as before.

## CORS

AREDL's API sends proper CORS headers, so it's fetched directly — no proxy needed. The one
defensive measure kept around is `corsFetchJson()` (`js/utils.js`), which retries through a
public CORS proxy (`CONFIG.CORS_PROXIES` in `js/config.js`) if a direct request ever fails
outright; harmless if never triggered, useful insurance if AREDL's CORS setup ever changes.

## File layout

```
index.html                  list page markup
level.html                   detail page markup
assets/
  logo.png                   site logo — header mark + PNG favicon source (256px, downsized from the original)
  favicon.ico                multi-resolution (16/32/48) browser-tab icon, generated from logo.png
css/
  base.css                   design tokens, header, shared layout/states
  list.css                    card grid, pager, search/jump/list-filter controls
  detail.css                   detail page layout + dual video panels
js/
  config.js                  endpoints, storage keys, tunables — builds the cache branch's raw.githubusercontent.com URLs
  utils.js                     formatting/parsing helpers + corsFetchJson, shared by both pages
  api-aredl.js                  AREDL adapter (confirmed API shape, see note below) — reads the cache branch's aredl-cache.json first
  data-source.js                 thin pass-through to the AREDL adapter, paginated by page number
  shared-cache.js                 reads the cache branch's yt-cache.json (see above) — the only source of view counts/showcases
  cache-admin-ui.js               detail-page "refresh this level" control, see "Manual refresh" above
  list.js                           list page controller
  detail.js                          detail page controller
data/                        *.json gitignored on main — generated at runtime, published to the `cache` branch, see below
scripts/
  refresh-yt-cache.mjs        populates data/yt-cache.json — "discover" or "views" mode, see "Shared cache" above
  refresh-aredl-cache.mjs     populates data/aredl-cache.json, see "Shared AREDL cache" above
  publish-cache-branch.sh     what both scripts' workflows call to publish to the `cache` branch, see "Cache branch" above
.github/workflows/
  refresh-yt-cache.yml        daily — discover mode (find showcases); also accepts a manual per-level target, see "Manual refresh" above
  refresh-yt-views.yml        every 30 min — views mode (refresh view counts)
  refresh-aredl-cache.yml     hourly — refreshes the AREDL level-list snapshot
```

## A note on AREDL

AREDL's API (`api.aredl.net/v2/docs`) doesn't have plain-text docs — just an interactive
Scalar/OpenAPI page — so `api-aredl.js` (and `scripts/refresh-yt-cache.mjs`, which talks to the
same API) are built and confirmed directly against the open-source backend
([`All-Rated-Extreme-Demon-List/aredl-backend-v2`](https://github.com/All-Rated-Extreme-Demon-List/aredl-backend-v2))
and live responses. Two shape quirks worth knowing if you're touching either file:

- `GET /levels` (the list) only returns bare fields — no video, no thumbnail, no verifier, no
  creators, and `publisher` is just a `publisher_id` UUID. All of that lives on
  `GET /levels/{id}` (verification video + submitter under `verifications[0]`, publisher
  resolved) and a separate `GET /levels/{id}/creators`. List cards start bare and get
  hydrated with those once they scroll into view — see `AredlAPI.fetchExtras()` and the
  `hydrateCards()`/`hydrateAredlExtrasIfNeeded()` flow in `js/list.js`.
- `GET /levels` accepts `limit`/`offset` but silently ignores them — it always returns every
  level (~1600 of them). `api-aredl.js` reads the hourly-refreshed `data/aredl-cache.json`
  snapshot instead (already trimmed to the top 150, see
  [Reducing to a top-150 list](#reducing-to-a-top-150-list)), falling back to a live call sliced
  the same way if the snapshot is missing, caches it in memory for the session, and
  paginates/searches client-side from there.

If AREDL changes their API shape in the future, that GitHub repo's `src/aredl/levels/` and
`src/aredl/records/` directories are the place to re-check field names against.
