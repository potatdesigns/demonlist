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
  Search filters across the *entire* list, not just whatever page happens to be loaded, and a
  "jump to rank" box plus quick range chips get you anywhere in the list without endless
  "Load more" clicking.
- **Detail page (`level.html`)** — click any card for the full picture: list ID, GD level ID,
  points, verifier, publisher, all creators, an embedded player for the official verification
  video, and an embedded player for the auto-discovered top showcase, with both view counts
  shown for direct comparison.

## Shared showcase/view-count cache

View counts and "find the best showcase on YouTube" both need YouTube's Data API, which is
quota-limited (10,000 units/day by default, and a `search.list` call — the expensive part of
showcase discovery — costs 100 of those). With ~1600 levels, every visitor doing their own
lookups with their own key would burn through that fast and repeat the exact same searches
everyone else already ran.

Instead, `data/yt-cache.json` is a **shared, precomputed cache** committed to this repo,
populated by [`scripts/refresh-yt-cache.mjs`](scripts/refresh-yt-cache.mjs) running on a
schedule via [`.github/workflows/refresh-yt-cache.yml`](.github/workflows/refresh-yt-cache.yml).
The site fetches this one static JSON file (`js/shared-cache.js`) and, for any level it covers,
shows those numbers directly — **zero personal API usage** for the vast majority of browsing.

- **Staggered, not all at once**: each run processes whichever levels have gone longest without
  a check (never-checked first, then oldest-`checkedAt`-first), capped by a per-run unit budget
  safely under the daily quota. Running daily naturally spreads a full pass across roughly
  3-4 weeks for AREDL's current size — self-correcting if a run is skipped or the list grows,
  no day-of-week bucketing needed.
- **One key, not everyone's**: the workflow uses a single key stored as a repo secret
  (`YOUTUBE_API_KEY`), so the pooled daily quota gets spent deliberately by one controlled
  process instead of being absorbed by whichever visitor happens to have added their own.
- **Personal key = on-demand fallback only**: if you add your own key via the header's key
  icon, it's only ever used for a level the shared cache hasn't reached yet (brand new, or not
  due for its staggered refresh) — never as the default path. Without a key, those levels just
  show "Not cached yet" instead of an error.

### Setting it up

1. Get a free key from the [Google Cloud Console](https://console.cloud.google.com/apis/credentials)
   (enable "YouTube Data API v3").
2. Add it as a repository secret: **Settings → Secrets and variables → Actions → New repository
   secret**, name `YOUTUBE_API_KEY`.
3. That's it — the workflow runs daily on its own, or trigger it manually from the **Actions**
   tab (`Refresh shared YouTube cache` → *Run workflow*; it also takes optional `max_levels`/
   `max_units` overrides for that one run).

You can also run it locally: `YOUTUBE_API_KEY=... node scripts/refresh-yt-cache.mjs`.

Showcase discovery requires the result to actually be *of that level* before it's eligible at
all — every significant word of the level name must appear in the candidate's title, or the
numeric GD level ID must appear in the title/description (lesser-known levels' showcases often
cite the ID). Uploads that look like a raw verification video are dropped, known showcase
channels are preferred when present (`SHOWCASE_CHANNELS` in `js/config.js`, kept in sync with
the same list in the refresh script), and otherwise the highest view count among same-level
matches wins. This logic lives in two places that must be kept in sync by hand (there's no
shared module system here — the browser files are plain `<script>` globals, the refresh script
is a standalone Node ESM file): `findBestShowcase()`/`matchesLevel()` in `js/youtube.js` for the
personal-key live fallback, and the same functions ported into
`scripts/refresh-yt-cache.mjs` for the scheduled crawl.

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
  list.css                    card grid, view-count chips, search/jump/range controls
  detail.css                   detail page layout + dual video panels
js/
  config.js                  endpoints, storage keys, tunables
  utils.js                     formatting/parsing helpers + corsFetchJson, shared by both pages
  api-aredl.js                  AREDL adapter (confirmed API shape, see note below)
  data-source.js                 thin pass-through to the AREDL adapter
  shared-cache.js                 reads data/yt-cache.json (see above)
  youtube.js                       YouTube Data API wrapper — personal-key on-demand fallback
  ytkey-ui.js                       the "add API key" modal, shared by both pages
  list.js                            list page controller
  detail.js                           detail page controller
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
