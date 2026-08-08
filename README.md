# Demonlist

An AREDL-powered extreme demon list for Geometry Dash. Pure HTML/CSS/JS,
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

- **List page (`index.html`)** — pulls the full, live, currently-ranked AREDL list (~1600 levels)
  and renders it as a grid of cards: thumbnail (of the verification video), rank, name,
  creator(s), publisher, verifier, and — side by side — the verifier video's view count vs. the
  most-viewed *same-level* showcase's view count, with the higher number highlighted in gold.
  Paginated 75-at-a-time (5 columns x 15 rows at desktop width) with Prev/Next and a "page X of
  Y" jump box; **Main List** and **Extended List** buttons jump straight to page 1 (#1-75) and
  page 2 (#76-150). Search filters across the *entire* list, not just the current page, and the
  "jump to rank" box takes you straight to whichever page contains that rank.
- **Detail page (`level.html`)** — click any card for the full picture: list ID, GD level ID,
  points, verifier, publisher, all creators, an embedded player for the official verification
  video, and an embedded player for the auto-discovered top showcase, with both view counts
  shown for direct comparison.

## Shared showcase/view-count cache

View counts and "find the showcase on YouTube" both need YouTube's Data API, which is
quota-limited (commonly 10,000 units/day, and a `search.list` call costs 100 of those; newer
projects can start out with a much lower search-specific sub-limit until Google raises it).
With ~1600 levels, every visitor doing their own lookups would burn through that fast and
repeat the exact same searches everyone else already ran — so there's no personal-key option
here at all. `data/yt-cache.json` is a **shared, precomputed cache** committed to this repo,
populated by [`scripts/refresh-yt-cache.mjs`](scripts/refresh-yt-cache.mjs) on two separate
schedules (see below), and the site just fetches that one static JSON file
(`js/shared-cache.js`) — **zero YouTube API calls happen in the browser, ever.** A level whose
showcase hasn't been found yet just shows "Not cached yet".

The script runs in two modes, split because *which video is the showcase* and *how many views
it has* have very different costs and staleness needs:

- **`discover`** (expensive, staggered) — figures out which video is the showcase for a level.
  Processes whichever levels have gone longest without a check (never-checked first, then
  oldest-`discoveredAt`-first), capped by a per-run unit budget (`YT_CACHE_MAX_UNITS`, default
  7000) safely under the daily quota. Each level costs ~102 units (one `search.list` call —
  see the algorithm below — plus a couple 1-unit `videos.list` calls), so at the default budget
  and the standard 10,000-unit quota that's roughly **68 new levels per day**, meaning a full
  first pass over ~1600 levels takes **about 3-4 weeks** — a hard limit of YouTube's quota, not
  something the staggering can shortcut. If your key's search quota is capped even lower (some
  newer projects start around 100 units/day — effectively one search call total), coverage will
  be much slower until Google raises it; the script always stops cleanly on a quota error
  rather than writing bad data. Runs daily
  ([`refresh-yt-cache.yml`](.github/workflows/refresh-yt-cache.yml)); self-correcting if a run
  is skipped or the list grows.
- **`views`** (cheap, frequent) — once a level has a verifier/showcase video *identified*, its
  view count is refreshed independently of the (slow) discovery cycle: one batched
  `videos.list` call per 50 videos, so refreshing the *entire* list's view counts costs on the
  order of 60-70 units total. Runs every 30 minutes
  ([`refresh-yt-views.yml`](.github/workflows/refresh-yt-views.yml)), so the numbers shown on
  the site stay close to real-time even though which-video-is-the-showcase only gets
  (re-)checked once every few weeks.

Both workflows write the same file, so they share a `concurrency` group (only one runs at a
time) and rebase before pushing.

**Manual refresh**: the header's refresh icon links to the discover workflow's page on GitHub
Actions (`https://github.com/<repo>/actions/workflows/refresh-yt-cache.yml`) rather than
triggering it directly — GitHub's `workflow_dispatch` API needs an authenticated request, and
there's no safe way to expose a one-click trigger from a public static site (embedding a token
client-side would let anyone on the internet trigger runs and burn the day's quota). The link
is shown to everyone since it's harmless either way: GitHub's own permissions gate the actual
"Run workflow" button to signed-in collaborators with write access.

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

`findBestShowcase()` in the script:

1. Search YouTube for **the bare numeric GD level ID and nothing else** — no level name, no
   "showcase"/"GD" keywords.
2. Keep only results from a fixed allowlist of known showcase channels (see
   `SHOWCASE_CHANNELS` in the script) — everyone else is discarded regardless of views. Nothing
   is excluded by title keyword (earlier versions filtered out titles containing
   "verification", but plenty of legitimate showcases use words like "verified" too, so that's
   gone).
3. Of what's left, drop anything where the ID doesn't actually appear in the title or
   description (search relevance isn't a guaranteed substring match).
4. Take the highest-viewed video *per channel*, then the highest-viewed of those across
   channels is the winner.

The allowlist is currently: Nexus, Neiro, Viprin, Just a GD Player, IcedCave, fnm04, zof, and
Newly Rated Extremes (resolved to channel IDs via `channels.list?forHandle=`, not the
search quota). **Mindcap is not included** — the handle given for it (`@mindcap`) resolves to
an unrelated, near-empty channel (1 video, 14 subscribers), almost certainly not the intended
one; add it once the correct handle/channel ID is confirmed.

## Shared AREDL level-list cache

Separately from the YouTube data, `data/aredl-cache.json` is a snapshot of AREDL's own
`GET /levels` (the bare list — id, name, position, level_id, points, etc.), refreshed hourly by
[`scripts/refresh-aredl-cache.mjs`](scripts/refresh-aredl-cache.mjs) /
[`refresh-aredl-cache.yml`](.github/workflows/refresh-aredl-cache.yml). `AredlAPI.fetchFullList()`
(`js/api-aredl.js`) reads that snapshot first and only falls back to a live AREDL call if it's
missing or fails to load — so instead of every single visitor's page load independently
re-fetching the same ~1600-entry list from AREDL, there's one shared, periodically-refreshed
copy. This needs no API key (AREDL's list endpoint is public and free) and no budget/staggering
logic — it's cheap enough to just refresh the whole thing every run. Hourly is comfortably
ahead of how often levels actually get reordered/added ("every day or so"); nothing about level
*position* changes faster than that in practice.

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
css/
  base.css                   design tokens, header, shared layout/states
  list.css                    card grid, pager, search/jump/list-filter controls
  detail.css                   detail page layout + dual video panels
js/
  config.js                  endpoints, storage keys, tunables
  utils.js                     formatting/parsing helpers + corsFetchJson, shared by both pages
  api-aredl.js                  AREDL adapter (confirmed API shape, see note below) — reads data/aredl-cache.json first
  data-source.js                 thin pass-through to the AREDL adapter, paginated by page number
  shared-cache.js                 reads data/yt-cache.json (see above) — the only source of view counts/showcases
  cache-admin-ui.js               header link to the discover workflow's GitHub Actions page
  list.js                           list page controller
  detail.js                          detail page controller
data/
  yt-cache.json               shared YouTube cache — committed, machine-updated, don't hand-edit
  aredl-cache.json            shared AREDL level-list snapshot — committed, machine-updated, don't hand-edit
scripts/
  refresh-yt-cache.mjs        populates data/yt-cache.json — "discover" or "views" mode, see "Shared cache" above
  refresh-aredl-cache.mjs     populates data/aredl-cache.json, see "Shared AREDL cache" above
.github/workflows/
  refresh-yt-cache.yml        daily — discover mode (find showcases)
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
  level (~1600 of them). `api-aredl.js` reads that full list from the hourly-refreshed
  `data/aredl-cache.json` snapshot (falling back to a live call if it's missing), caches it in
  memory for the session, and paginates/searches client-side from there.

If AREDL changes their API shape in the future, that GitHub repo's `src/aredl/levels/` and
`src/aredl/records/` directories are the place to re-check field names against.
