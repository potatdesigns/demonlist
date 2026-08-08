# Demonlist

An AREDL-powered extreme demon list for Geometry Dash. Pure HTML/CSS/JS,
no build step for the site itself — open `index.html` in a browser or host the folder anywhere static.
(A small Node script + a scheduled GitHub Action maintain one JSON file in the background — see
[Shared showcase/view-count cache](#shared-showcaseview-count-cache) below.)

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

View counts and "find the best showcase on YouTube" both need YouTube's Data API, which is
quota-limited (commonly 10,000 units/day, and a `search.list` call — the expensive part of
showcase discovery — costs 100 of those; newer projects can start out with a much lower
search-specific sub-limit until Google raises it). With ~1600 levels, every visitor doing their
own lookups would burn through that fast and repeat the exact same searches everyone else
already ran — so there's no personal-key option here at all. `data/yt-cache.json` is a
**shared, precomputed cache** committed to this repo, populated by
[`scripts/refresh-yt-cache.mjs`](scripts/refresh-yt-cache.mjs) running on a schedule via
[`.github/workflows/refresh-yt-cache.yml`](.github/workflows/refresh-yt-cache.yml), and the site
just fetches that one static JSON file (`js/shared-cache.js`) — **zero YouTube API calls happen
in the browser, ever.** A level the cache hasn't reached yet just shows "Not cached yet".

- **Staggered, not all at once**: each run processes whichever levels have gone longest without
  a check (never-checked first, then oldest-`checkedAt`-first), capped by a per-run unit budget
  (`YT_CACHE_MAX_UNITS`, default 7000) safely under the daily quota. Each level costs a flat
  ~202 units (two fixed `search.list` queries, always both — see below — plus a couple 1-unit
  `videos.list` calls), so at the default budget and the standard 10,000-unit quota that's
  roughly **34 new levels per day**, meaning a full first pass over ~1600 levels takes **about
  45 days** — a hard limit of YouTube's quota, not something the staggering logic can shortcut.
  If your key's search quota is capped even lower (some newer projects start around 100
  units/day — effectively one search call), coverage will be much slower until Google raises
  it; the script always stops cleanly on a quota error rather than writing bad data (see the
  comments in the script for how). Running daily is self-correcting either way if a run is
  skipped or the list grows — no date-bucketing needed.
- **One key for everyone**: the workflow uses a single key stored as a repo secret
  (`YOUTUBE_API_KEY`), so the whole site's quota usage is one deliberate, controlled process
  instead of N visitors each burning their own.

### Setting it up

1. Get a free key from the [Google Cloud Console](https://console.cloud.google.com/apis/credentials)
   (enable "YouTube Data API v3").
2. Add it as a repository secret: **Settings → Secrets and variables → Actions → New repository
   secret**, name `YOUTUBE_API_KEY`.
3. That's it — the workflow runs daily on its own, or trigger it manually from the **Actions**
   tab (`Refresh shared YouTube cache` → *Run workflow*; it also takes optional `max_levels`/
   `max_units` overrides for that one run).

You can also run it locally: `YOUTUBE_API_KEY=... node scripts/refresh-yt-cache.mjs`.

Showcase discovery (`findBestShowcase()` in the script) runs exactly two fixed queries every
time — `<level name> GD showcase` and `<GD level ID> showcase` — and merges the results. The
only eligibility check is whether the numeric GD level ID appears in a candidate's title or
description; nothing is excluded by keyword (earlier versions filtered out titles containing
"verification", but plenty of legitimate showcases use words like "verified" too, so that's
gone) and there's no channel allowlist (any channel is equally eligible). Among whatever passes
the ID check, the highest view count wins.

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
  api-aredl.js                  AREDL adapter (confirmed API shape, see note below)
  data-source.js                 thin pass-through to the AREDL adapter, paginated by page number
  shared-cache.js                 reads data/yt-cache.json (see above) — the only source of view counts/showcases
  list.js                           list page controller
  detail.js                          detail page controller
data/
  yt-cache.json               the shared cache itself — committed, machine-updated, don't hand-edit
scripts/
  refresh-yt-cache.mjs        populates data/yt-cache.json — see "Shared cache" above
.github/workflows/
  refresh-yt-cache.yml        runs the script on a schedule and commits the result
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
  level (~1600 of them). `api-aredl.js` fetches that full list once per session, caches it in
  memory, and paginates/searches client-side from there.

If AREDL changes their API shape in the future, that GitHub repo's `src/aredl/levels/` and
`src/aredl/records/` directories are the place to re-check field names against.
