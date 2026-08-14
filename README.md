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

- **Home page (`index.html`)** — the actual landing page: intro, a "View the list" CTA, two
  spotlight cards (current #1, and a level "featured today" — a deterministic daily pick, seeded
  by the calendar date so it's stable through the day rather than re-rolling on reload, see
  `seededIndexForToday()` in `js/home.js`), a **recent changes** panel pulled live from AREDL's
  own `/changelog` endpoint (filtered to changes that touched this site's own top 150 — AREDL's
  full list runs to ~1600 levels, and its own `legacy` cutoff is much lower than 150, so this app
  defines "legacy" as "outside the top 150" independent of AREDL's definition — see
  `fetchChangelog()` in `js/api-aredl.js`). Each entry links by the level's own AREDL id
  (`level.html#id=<uuid>`, not `level.html#<position>`) — a changelog entry's recorded position is
  a snapshot from whenever that change happened, and any insertion/removal above it since then
  shifts what's actually sitting at that rank *now*; a plain rank link would silently send you to
  whichever level has since slid into that slot instead of the one the entry was actually about
  (see `getRouteParam()` in `js/detail.js`). Also a **Demonlist Roulette** teaser (see below).
- **List page (`list.html`)** — pulls the top 150 of AREDL's live, currently-ranked list (AREDL
  itself has ~1600 rated extreme demons; see [Reducing to a top-150 list](#reducing-to-a-top-150-list))
  and renders it as a grid of cards: thumbnail (of the verification video), rank, name,
  creator(s), publisher, verifier, and — side by side — the verifier video's view count vs. the
  most-viewed *same-level* showcase's view count, with the higher number highlighted in gold. Each
  card's accent color is a continuous gradient by rank (`positionColor()` in `js/utils.js`) —
  bright red at #1 (hardest) sweeping down through pink/magenta/violet to bright purple at #150
  (easiest), 11 key points roughly every 15 ranks, deliberately taking the *short* way around the
  hue wheel so it never crosses into orange/yellow/green/cyan/blue — rather than a handful of
  discrete difficulty buckets, so no two nearby ranks look identical. A level placed into the top
150 within the last week gets a **New** badge (card corner in card mode, inline in list mode — see
`AredlAPI.fetchNewLevelIds()`, also used on the detail page and the home page's spotlight cards).
Paginated 75-at-a-time
  (5 columns x 15 rows at desktop width) with Prev/Next and a "page X of Y" jump box; **Main List**
  and **Extended List**
  buttons jump straight to page 1 (#1-75) and page 2 (#76-150) without scrolling the page (they
  sit right where you're already looking, in the hero at the top — Prev/Next/the page-jump form
  live at the bottom of the grid instead, and still scroll back up, since staying put there would
  leave you looking at the tail end of a new page). Reflected in the URL too as a *hash*, not a
  query string — `#main` / `#extended`, a search as `#q=...` — synced via `history.pushState` so
  back/forward work and a specific view is shareable; see `writeUrlState()` in `js/list.js` for
  why a hash rather than `?...` or a true path (short version: a hash needs no server involvement
  at all, so it works identically on any host, unlike a path rewrite). The **Open rank** box takes
  you straight *into* that level's detail page rather than just the list page it sits on. A
  **Filters** dropdown (next to Open rank) narrows the grid to a verifier-view-count range and/or
  a showcase-view-count range, and a **Sort** dropdown reorders it by either video's view count,
  ascending or descending, instead of by rank — like search, both check the *entire* tracked list
  rather than just the current page, so either one also overrides pagination and the Main/Extended
  split while active (sorting by view count doesn't correspond to a fixed rank order the way
  Main/Extended's #1-75/#76-150 split does, so the two are mutually exclusive the same way
  search/filters already were). Unlike search/page, both are session-local only (not reflected in
  the URL or restored on back/forward) — a lens on top of whatever you're looking at rather than a
  view of its own worth bookmarking, and both are dropped whenever you navigate to a different
  page/search so they can't linger invisibly underneath a view that looks unfiltered/unsorted.
- **Detail page (`level.html`)** — click any card (or use Open rank) for the full picture: list
  ID, GD level ID, points, verifier, publisher, all creators, an embedded player for the official
  verification video, and an embedded player for the auto-discovered top showcase, with both view
  counts shown for direct comparison. Below that, a **position history** — every recorded position
  change for this level, newest first, with a ↑/↓ against the *previous* entry (lower position
  number is a rise, same direction the recent-changes panel's own "Raised"/"Lowered" use) and a
  date; anything past CONFIG.LIST_SIZE reads as **Legacy** rather than a raw AREDL position number,
  which wouldn't mean much on a site that only ranks the top CONFIG.LIST_SIZE itself. Data comes
  from `data/position-history.json` (`js/position-history.js`), populated by
  `scripts/refresh-aredl-cache.mjs` every time it runs — see
  [Shared AREDL level-list cache](#shared-aredl-level-list-cache) below. Its URL is just the level's rank as a hash fragment
  (`level.html#42`, resolved to the actual AREDL id via `AredlAPI.getIdByPosition()` before
  fetching anything) rather than AREDL's 36-character id or a `?id=`-style query string.
  **Previous/Next** boxes (also `ArrowLeft`/`ArrowRight`) jump straight to the adjacent rank,
  previewing its name before you click; since that's a `level.html#N` -> `level.html#M`
  same-document hash change rather than a real page load, `js/detail.js` listens for its own
  `hashchange`/`popstate` to re-render in place (the same reason `js/list.js` does for
  Main/Extended/search) rather than assuming a fresh navigation. A **Copy link** button and a
  **Random level** button sit in the header (`js/nav-actions.js`, also reachable as the `R`
  keyboard shortcut) — Copy link only on this page, Random on this page and the list page (there's
  nothing level-specific for the list page to copy). A refresh icon next to the video section lets
  any visitor force a re-check of just this level (see
  [Manual refresh](#shared-showcaseview-count-cache) below) — deliberately *only* this level, not
  the whole list; see [One-click refresh trigger](#one-click-refresh-trigger). The background is
  the verification video's own YouTube thumbnail, heavily blurred/darkened
  (`mountDetailBackground()` in `js/detail.js`) — the closest thing to "a picture of this level"
  available at all, since AREDL doesn't host level screenshots itself; tries the 1280x720
  `maxresdefault` thumbnail first, falling back to `hqdefault` when YouTube hasn't generated one
  (it silently serves a small gray placeholder with a real `200` status rather than a 404 for
  those, so this checks the loaded image's actual pixel width rather than trusting the response to
  fail).
- **Queue page (`queue.html`)** — reachable from its header's Home button (and `Ctrl+Alt+Q`), but
  still not linked from any *other* page's nav — an admin/curiosity view once you're there, rather
  than something surfaced as a primary destination. A plain top-to-bottom list
  (no cards, closer to AREDL's own changelog styling) showing the *actual* persisted
  showcase-discovery queue in its real stored order — not a fresh client-side re-sort — so it
  visibly shrinks as the discover workflow works through it and jumps back to ~150 once it
  refills (see [the queue behavior below](#shared-showcaseview-count-cache)) — read-only, no
  trigger lives here.
- **Stats page (`stats.html`)** — linked from the header (bar-chart icon), unlike the queue page.
  Averages, records, and six hand-built SVG charts (no charting library — this site has no build
  step to bring one in through) aggregated across the tracked list from the same two sources every
  other page already reads (AredlAPI's cached full list, SharedYtCache's whole-cache fetch):
  - A verifier-views-vs-showcase-views **scatter** (log/log, a `y=x` reference line so it's visible
    at a glance which side of "showcase out-viewed the verification video" a level falls on).
  - Two **donuts** — "Who leads" (share of levels where the showcase out-views the verifier, or
    doesn't; same gray/orange mapping as everywhere else on the page) and "Showcase channel share"
    (share of levels *won* by each channel, top 3 + an "Other" bucket, in three named hues — see
    the "why not the site's orange" comment in `js/stats.js`, and note this is the one place on the
    page using a real categorical palette, validated against the project's dataviz skill).
  - A **histogram** of the distribution of view counts (grouped columns, verifier vs. showcase, by
    log-scale bucket).
  - Average views **by rank bucket** (a two-line chart, 10 ranks per bucket).
  - **Total showcase views by channel** (horizontal bars).

  Three filters — **All/Main/Extended** range chips, a **channel** select, and a **verifier/showcase
  view-count range** panel (the same Filters UI as the list page, sharing its CSS, see
  `css/base.css`) — combine to scope the KPI row and every chart together. KPI tiles cover count,
  mean *and* median (the median is less skewed by the handful of outlier levels a mean isn't),
  records, a showcase win rate, and a log-scale Pearson correlation between the two view counts.
  Every chart has a hover tooltip (hit target larger than the mark, not just the painted pixels;
  testing caught the painted marks intercepting their own hover instead of the hit layer beneath —
  fixed with `pointer-events: none` on every decorative mark, see `js/stats.js`) and either a
  collapsed "View as table" fallback or, for the two donuts, a legend that already shows the whole
  (2-4 row) dataset directly — so nothing on the page is chart-only (`js/stats.js`).
- **Extreme Demon Roulette** (`roulette.html`/`js/roulette.js`, dice icon in the header everywhere
  else, linking here) — the actual community challenge format (created by npesta in 2020; see
  `aredl.net/games/roulette` and `matcool.github.io/extreme-demon-roulette` for the reference
  implementations this follows), not a random-level picker. Pick a range (Main/Extended/Both —
  Legacy isn't offered, since this site doesn't track anything past #150), then levels come up one
  at a time in random order from an in-memory shuffled pool; the percent required to clear starts
  at 1% and climbs to whatever you report clearing plus 1% each time (so overshooting the
  requirement raises the bar further, same as the real challenge's rules) — miss the requirement
  and the run ends, hit 100% and it's a win ("GG"). This site can't see into an actual Geometry
  Dash run, so it's a picker + tracker: you play the level for real, then report back what percent
  you got. The whole run (range, remaining pool, play-by-play history, current level and required
  percent) is saved to `localStorage` (`CONFIG.STORAGE.ROULETTE_RUN`) after every step, so a reload
  mid-run — these can span a long time — resumes exactly where it left off.
- **Keyboard shortcuts** (`js/shortcuts.js`, every page) — `Ctrl+Alt+M`/`E`/`Q`/`R`/`S` jump
  to Main list, Extended list, the queue page, a random level (`js/nav-actions.js`, shared with the
  header button), and the stats page; `?` alone opens a panel listing them all (also reachable via
  the floating `?` button, bottom-right). `Ctrl+Alt` rather than a bare letter or a single-modifier
  `Ctrl`-combo — the first cut of this feature used bare letters, which is the safe default for
  most sites (never reserved by the browser, unlike `Ctrl+Q`/`M`/`E`, which collide with real,
  JS-unoverridable browser/OS bindings — tab-close, window-minimize, address-bar search), but a
  bare letter can still fire from normal typing/browsing outside a tracked text field; `Ctrl+Alt`
  is essentially never reserved by anything (including Windows' own Alt-alone menu-accelerator
  behavior, which requiring *both* modifiers together sidesteps) while also never misfiring
  incidentally. `?` stays bare regardless — not a letter, and "press ? for help" is too established
  a convention (GitHub, Gmail, Slack) to bury behind a modifier. Suspended while a text field is
  focused, and `M`/`E` update the current page in place via a hash change when already on
  `list.html` rather than reloading. `level.html` also has its own `ArrowLeft`/`ArrowRight` for
  Previous/Next (see above), not listed in this panel since it's page-specific rather than
  site-wide.
- **Settings** (`js/settings.js`, gear icon, every page) — a slide-in side panel for six
  preferences, persisted to `localStorage` (`CONFIG.STORAGE.SETTINGS`) and applied immediately, no
  reload needed: **accent color** (six presets — Red/Orange/Yellow/Green/Blue/Pink, orange by
  default — retints `--primary`/`--primary-dark` sitewide, applied as inline styles on `:root` so
  every existing `var(--primary)` picks it up unchanged, plus the browser-tab favicon specifically
  (see `mascotFaviconDataUri()` in `js/utils.js` — a data: URI SVG rebuilt per accent change; the
  header's own brand mark stays the static `assets/logo.png`, by design, not tied to the accent).
  `--primary-on` switches the on-accent text color between near-black for the warm presets (orange,
  yellow) and white for the rest, see `ACCENT_PRESETS` in `js/settings.js`), **level display**
  (Cards or a denser AREDL-style List row layout on the list
  page), **default list on open** (Main/Extended — only affects a bare `list.html` with no page in
  the URL, never an explicit `#main`/`#extended` link), **open levels in a new tab**, **autoplay
  videos** (muted — browsers block unmuted autoplay outright, so this always pairs `autoplay=1`
  with `mute=1`), and **reduce motion** (the same effect `prefers-reduced-motion` already gets from
  the OS, opted into manually here). Reduce-motion and accent color are also set by a tiny inline
  `<script>` in every page's `<head>`, before `js/settings.js` itself loads, so a returning
  visitor's choices are already applied before first paint (the accent presets are duplicated in
  that inline script since it must run before `js/settings.js` does — keep both in sync). (A
  light-theme toggle briefly lived here too — cut, it didn't look good; see git history if it's
  ever worth revisiting.) No "remove cooldown" toggle either — the per-level refresh
  cooldown (`worker/src/index.js`, `COOLDOWN_SECONDS`, now 1 minute — see
  [One-click refresh trigger](#one-click-refresh-trigger)) is a single rate limit shared by every
  visitor, enforced server-side in Cloudflare KV specifically so no one visitor can trigger the
  discover workflow more than once per window; a client-side toggle can't honestly bypass that (the
  server rejects the request the same regardless of any local setting) — shortening the window
  itself, in the Worker's own config, is the honest version of the same request.

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
  map lookup.

  **The queue is persisted (`cache.queue` in `data/yt-cache.json`), not recomputed from scratch
  every run.** It's built fresh only when empty — levels with no showcase on file yet first
  (nothing to compare, and finding one is the valuable work), then the rest ascending by showcase
  view count — and then *drains* as levels actually get checked: each run takes a batch off the
  front (up to `YT_CACHE_MAX_LEVELS`, default 150) and removes whichever of those it successfully
  processed, manual single-level triggers (see [Manual refresh](#shared-showcaseview-count-cache)
  below) included — a level that was just manually checked is done for the cycle exactly like one
  the automatic batch checked, not re-queued to be checked again immediately. The empty check runs
  unconditionally at the *start* of every run, before deciding whether it's a manual single-level
  run or a normal batch one, specifically so a run (or a string of manual-only runs) can never
  leave the queue stuck empty just because none of them happened to take the batch-processing
  branch that owns removing from it. [`queue.html`](queue.html) shows this list in its real stored
  order, so it visibly shrinks run to run and jumps back to ~150 on refill — see `js/queue.js`.
  With `YT_CACHE_MAX_LEVELS` at its default of 150 (the full tracked list), a normal run typically
  drains and immediately needs refilling in the same run, so draining is only really visible if
  you lower that below 150 (spreading a full cycle across several days instead of finishing it
  every run — a real trade-off against freshness, not just a display setting).

  A level whose per-run batch got cut short (quota, or the `YT_CACHE_MAX_LEVELS` cap) stays in the
  queue rather than being marked done — retried next run instead of recorded with a false "no
  showcase". The script always stops cleanly on a quota error rather than writing bad data — a
  level whose verifier `videos.list` call got cut off by quota is left in the queue instead of
  being recorded with a false "no verifier found". Runs daily
  ([`refresh-yt-cache.yml`](.github/workflows/refresh-yt-cache.yml)); self-correcting if a run is
  skipped or the list grows (new/never-seen levels join the front of the queue immediately, not
  just at the next refill).

  Before resolving verifier stats, the script looks up each queued level's verification video on
  AREDL (`GET /levels/{id}`, plain HTTP, no YouTube quota) — and that step used to be a plain
  sequential `fetch()` with no retry at all. AREDL's per-level endpoints turn out to be genuinely
  rate-limited (confirmed live: bursts of concurrent requests to distinct levels draw `429`s with
  a `retry-after` header — unlike `GET /levels` itself, which has none), and once a discover run
  tripped it, every level queued *after* that point got silently dropped from the run with no
  retry — not a one-off miss, but a **persistent** gap, since the queue lands on roughly the same
  levels early each day and AREDL's limiter, once tripped, keeps rejecting immediate follow-ups.
  This is what caused a clean, stuck split where roughly the back third of the list never had a
  cache entry at all, day after day. Fixed the same way as the AREDL list-detail fetch above (see
  [Shared AREDL level-list cache](#shared-aredl-level-list-cache)): paced (`AREDL_PACE_MS`, 150ms
  between each sequential lookup) and retried on `429` with the `retry-after` wait floored at 2s.
  Confirmed live against the full 150-level list: 0 rate-limit hits with the pacing in place.
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

**Manual refresh**: a refresh icon on each detail page, next to "Verification vs. showcase"
(`js/cache-admin-ui.js`, `mountLevelRefreshButton()`), passes `target_level_id` to check that one
level immediately (see `YT_CACHE_TARGET_LEVEL_ID` in `scripts/refresh-yt-cache.mjs`) — removed
from the queue afterward exactly like a normal automatic check would be (see [the queue behavior
above](#shared-showcaseview-count-cache)), since it was just checked; re-queuing it to be checked
again soon would just be repeating what the trigger itself already did. There used to also be a
site-wide button that ran a normal queue-wide discover pass — removed, since it let any visitor
trigger an expensive full-list run on demand; only this narrower per-level version remains, and
the Worker below refuses to dispatch without a `target_level_id` even if called directly.
[`queue.html`](queue.html) (not linked anywhere in the UI — direct-URL-only) shows the current
queue order without being able to trigger anything.

This is a real one-click trigger, safe to show every visitor, *if* `CONFIG.TRIGGER_WORKER_URL` is
set — see [One-click refresh trigger](#one-click-refresh-trigger) just below. Left unset, it falls
back to copying the level id to the clipboard and opening the workflow's GitHub Actions page
instead — the same degraded-but-safe behavior the site shipped with before that Worker existed,
still gated by GitHub's own sign-in to whoever actually has write access to run it.

## One-click refresh trigger

Making the refresh button work for every visitor — not just signed-in collaborators — means
something has to be able to call GitHub's `workflow_dispatch` API with a token. That can't be the
browser: a token embedded in client-side JS is visible to anyone who views source, who could then
not just spam-trigger this workflow (burning the day's YouTube quota) but potentially misuse the
token for anything else it's scoped to. [`worker/`](worker/) is a small Cloudflare Worker that
solves this the standard way — it holds the token server-side and stands between visitors and
GitHub:

- **The token never reaches the browser.** The site's JS calls the Worker; the Worker calls
  GitHub. `js/config.js`'s `TRIGGER_WORKER_URL` is just the Worker's public URL — nothing
  privileged.
- **Level-specific only.** The Worker rejects any request without a `target_level_id` (`400`) —
  it can't be used to trigger a queue-wide run, whether that request comes from this site's UI or
  a direct call to the Worker itself.
- **Rate-limited.** A single global cooldown (`COOLDOWN_SECONDS`, default 60 = 1 minute),
  tracked as one Workers KV key, only started *after* a dispatch actually succeeds — see the
  comments in [`worker/src/index.js`](worker/src/index.js) for why a single shared cooldown is
  deliberate rather than something more elaborate (the resource being protected, a discover run
  for one level, is already cheap; this is abuse-proofing against button-mashing, not a hard
  security boundary — and KV's eventual consistency across Cloudflare's edge means it isn't a
  perfectly strict lock anyway, which is fine for what this needs to do).
- **Scoped narrowly.** The GitHub token this needs is a **fine-grained personal access token**
  scoped to this one repository, with **Actions: read and write** permission and nothing else —
  it can dispatch workflow runs, that's it. It cannot push code, read secrets, or touch other
  repos.

### Deploying it

1. Install [`wrangler`](https://developers.cloudflare.com/workers/wrangler/) (Cloudflare's CLI)
   and sign in: `npm install -g wrangler`, then `wrangler login` (opens a browser to authorize —
   creates a free Cloudflare account for you if you don't already have one).
2. From `worker/`, create the KV namespace used for rate-limiting: `wrangler kv namespace create
   RATE_LIMIT`. It prints an id — paste that into the `id` field of `wrangler.toml`'s
   `kv_namespaces` entry (replacing `REPLACE_WITH_KV_NAMESPACE_ID`).
3. Create a GitHub fine-grained PAT: **GitHub Settings → Developer settings → Personal access
   tokens → Fine-grained tokens → Generate new token**. Set **Repository access** to only this
   repo, and under **Permissions** set **Actions** to **Read and write** — leave everything else
   as No access.
4. Store it as a Worker secret (not in any file — `wrangler secret put` prompts for the value and
   uploads it directly): from `worker/`, run `wrangler secret put GITHUB_TOKEN`.
5. `wrangler deploy`. This prints the Worker's URL (`https://demonlist-cache-trigger.<your
   subdomain>.workers.dev` by default).
6. Set `TRIGGER_WORKER_URL` in `js/config.js` to that URL and deploy the site. The refresh button
   switches from the copy-and-open fallback to actually triggering runs the moment that's set.

If you fork this project, `wrangler.toml`'s `GITHUB_REPO` var needs updating to match (alongside
the other fork-specific spots — `GITHUB_REPO` in `js/config.js`, see [Cache branch](#cache-branch)).

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

`buildLevelIndex()` + `bestShowcaseFor()` in the script, run against the channel index described
above:

1. The candidate pool is every video from a fixed allowlist of known showcase channels (see
   `SHOWCASE_CHANNELS` in the script) — there's no search step, so nothing outside the allowlist
   is ever considered. Nothing is excluded by a *blanket* title keyword (earlier versions filtered
   out titles containing "verification", but plenty of legitimate showcases use words like
   "verified" too, so that's gone) — the only exclusion is a short, hand-maintained blacklist (see
   step 4) for specific videos/phrases confirmed to misbehave, not a guess at a keyword that might.
2. **ID matching:** a video counts as a candidate for a level if that level's numeric ID appears
   as a standalone 5-10 digit run (not glued to other digits) anywhere in its title or
   description — extracted once per video when it's indexed, not re-scanned per level.
3. **Name matching:** a video *also* counts as a candidate if the level's name appears as a whole
   word (case-insensitive; names under 4 characters are skipped as too likely to false-positive
   against unrelated common words) in its *title* — except for Nexus specifically, checked against
   the *description* instead, since his titles frequently don't name the level at all (see
   `nameMatchFieldFor()`/`SHOWCASE_CHANNELS` in the script; only Nexus's video descriptions are
   persisted in the cache at all, to avoid bloating it for the other 8 channels that don't need
   them). For Nexus that whole-word check is also anchored to his "Level: `<name>`" convention
   (`nameMatchPatternFor()`'s `'label'` mode) rather than a bare search over the whole description —
   his descriptions are long, boilerplate-heavy text (credits, hashtags, other level shoutouts), and
   a bare word search over all of it false-positived even worse than a title would (confirmed live:
   "Mayhem" matched a video that wasn't a Mayhem showcase, just mentioned it in passing). Every
   other channel still gets the plain whole-word check. Runs for every level, alongside ID matching,
   not just as a fallback when ID matching finds nothing — a showcase that never states the raw ID
   can legitimately be the most-viewed one for that level, and gating name matches out whenever
   *any* ID match already existed would mean a hugely popular name-only showcase loses to an
   obscure ID-bearing one every time, which is the wrong call more often than the alternative. The
   trade-off: this can still false-positive when a level's name is itself an ordinary word —
   confirmed live, a level named "UNKNOWN" matches (and, by view count, wins the pick for) an
   unrelated video titled "Best Unknown Layout I've Ever Played", beating every legitimate
   "UNKNOWN" showcase including the actual verification video. No length floor or word-boundary
   check rules that out generally; the "Level: `<name>`" anchor only fixes it for channels that
   happen to label things that consistently.
4. **Blacklist:** before either matching pass runs on a video, it's checked against
   `scripts/showcase-blacklist.json` — a specific video (by URL, most recently
   `7G0wRbf8usw`/`nhJlEVsR3vA`) or a title phrase (currently `"TOP 10 HARDEST"`) — and skipped
   entirely if either matches (`isBlacklisted()` in the script), contributing zero candidates for
   any level. For a "top 10 hardest" or similar compilation/listicle video, ID and name matching
   both work exactly as designed — it really does mention a dozen levels' names/IDs — the video
   just isn't a showcase *of* any single one of them, which no amount of tuning the matching regex
   fixes; a hand-maintained blacklist is the honest tool for "this specific video is a known bad
   match" rather than trying to generalize a rule from one bad case.
5. Take the highest-viewed video *per channel* among whichever candidates a level ended up with,
   then the highest-viewed of those across channels is the winner.

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
trimmed-to-150 copy.

Each of those 150 levels is then enriched with its own `GET /levels/{id}` detail (verification
video, resolved verifier/publisher) and `GET /levels/{id}/creators`, merged directly onto the same
cached object. Earlier versions of this cache only held the bare list — cards had to make their
own live per-level AREDL call just to get a thumbnail or verifier name, which is what caused a
black placeholder while that pending call resolved (and an "AREDL API..." error on the detail page
if it failed). That live-per-card model was reasonable back when the tracked list was AREDL's full
~1600 levels — pre-fetching detail for all of them on every refresh wasn't — but stopped being
reasonable once the list got capped at 150 (see above): 150 levels' worth of detail is a perfectly
ordinary thing to fetch once an hour server-side instead. `AredlAPI.fetchDemon()` (used for both
the lazy per-card hydration in `list.js` and the detail page) now reads straight from this cache
and only falls back to a live call for a level whose detail happened to be missing from the last
refresh — see `normalizeLevel()` in `js/api-aredl.js`.

**AREDL's per-level endpoints are actually rate-limited** (confirmed live: firing ~30 concurrent
requests to distinct levels was enough to draw several `429`s, each with a `retry-after` header —
unlike `GET /levels` itself, which has no documented limit and is what's used for the bare list).
`scripts/refresh-aredl-cache.mjs` fetches detail for those 150 levels at limited concurrency
(`CONCURRENCY = 4`, each level being 2 simultaneous requests) with a short pause between each
(`PACE_MS = 250`), and retries a `429` after waiting whatever `retry-after` says — floored at 2
seconds, since AREDL sometimes sends `retry-after: 0`, which taken literally just re-trips the
same limiter instantly. A level whose detail still fails after retries is written with just its
bare fields for that run; the client's live-fallback covers it individually rather than the whole
refresh failing. A full run currently takes on the order of a minute — comfortably fine for an
hourly job.

**Position history.** The same run also updates `data/position-history.json` — a
`{ levelId: [{ date, position }, ...] }` log, one entry appended per level *only when its position
actually changed* since the last recorded entry, not once per run (most runs, most levels don't
move — recording those as no-ops would just be noise). Tracks both the current top
`LEVEL_LIST_SIZE` and any level that already has history but has since dropped out of it, so its
record doesn't just stop the moment it leaves — the detail page is what turns a position past
`LEVEL_LIST_SIZE` into "Legacy" for display, the stored data keeps the real AREDL position either
way. Kept in full, all-time — never trimmed; a level only gets a new entry when it actually moves
(not once per run), so even years of history stays a small array, and there's no volume problem an
entry cap would actually be solving. Like `data/aredl-cache.json`, the workflow pulls the prior
copy from the `cache` branch before running
(the script needs it to know what "changed since last time" means) and publishes the updated copy
back alongside it.

### Watching for AREDL changes affecting the top 150

A change touching the top 150 — a new placement, or a `Raised`/`Lowered`/`Swapped`/`MovedToLegacy`
that lands in range — would otherwise leave `data/aredl-cache.json`'s positions stale for up to an
hour until `refresh-aredl-cache.yml`'s own schedule catches up, and a genuinely new level would
wait potentially days for the staggered `refresh-yt-cache.yml` discover queue to reach it (see
[Showcase-matching algorithm](#showcase-matching-algorithm)). `scripts/watch-new-levels.mjs` /
[`watch-new-levels.yml`](.github/workflows/watch-new-levels.yml) close both gaps: every 15 minutes
it polls AREDL's changelog (one page — cheap, not the full level list) for any change whose
recorded position(s) land at ≤ 150, since the last check (`data/new-level-watch.json`, published to
the [`cache` branch](#cache-branch) the same way the other refresh scripts publish their own
files). Any such change triggers `refresh-aredl-cache.yml` once for the run, so the site's cached
positions catch up immediately instead of waiting on the hourly schedule. A *new placement*
specifically — a level entering the top 150 for the first time, not just moving within it — also
triggers `refresh-yt-cache.yml`, scoped to just that level (`target_level_id`, the same input the
detail page's "refresh this level" button uses), so its verifier/showcase gets discovered right
away instead of waiting on the queue; a level that was already in the top 150 and just moved
already has one on file, so it doesn't get this second trigger. All dispatches fire via the GitHub
REST API using the workflow's own ambient `GITHUB_TOKEN` (granted `actions: write` in the
workflow's `permissions:` block) — dispatching a *different* workflow in the same repo from inside
a GitHub Actions run doesn't need a separate PAT the way triggering one from outside GitHub Actions
does (see [One-click refresh trigger](#one-click-refresh-trigger), which does need one — that
caller is the Cloudflare Worker, a different trust boundary entirely). A first-ever run just
records the current time and triggers nothing, so it doesn't replay AREDL's entire changelog
history the first time it runs.

## CORS

AREDL's API sends proper CORS headers, so it's fetched directly — no proxy needed. The one
defensive measure kept around is `corsFetchJson()` (`js/utils.js`), which retries through a
public CORS proxy (`CONFIG.CORS_PROXIES` in `js/config.js`) if a direct request ever fails
outright; harmless if never triggered, useful insurance if AREDL's CORS setup ever changes.

## File layout

```
index.html                  home page markup — intro, spotlight cards, recent changes, roulette teaser
list.html                    list page markup (formerly at index.html)
level.html                    detail page markup
queue.html                     read-only priority-queue view markup, see "What it does" above
stats.html                      averages/records/charts markup, see "What it does" above
roulette.html                    Extreme Demon Roulette's own page, see "What it does" above
assets/
  logo.png                   the header brand mark (32px, every page) and the PNG favicon source
  favicon.ico                multi-resolution (16/32/48) static fallback favicon, generated from
                              logo.png — used until js/settings.js swaps in the accent-tinted SVG one
                              (a hand-built recreation of the same mark, see mascotFaviconDataUri()
                              below — the header mark itself stays the static logo.png either way)
css/
  base.css                   design tokens, header, shared layout/states, range-chip group, settings panel
  list.css                    card grid, pager, search/jump/filter/sort controls, list-mode rows;
                               also loaded by index.html for the spotlight cards, see home.css below
  home.css                     home-page-only layout: hero, spotlight row, changes panel, roulette teaser
  roulette.css                  roulette.html's own layout: setup/play/end states, spin history
  detail.css                   detail page layout + dual video panels + Previous/Next
  queue.css                     plain-list row styling for queue.html
  stats.css                      KPI tiles, chart cards, SVG chart chrome, table-view fallback
js/
  config.js                  endpoints, storage keys, tunables — builds the cache branch's raw.githubusercontent.com URLs
  utils.js                     formatting/parsing helpers + corsFetchJson + positionColor() +
                                dominantColor()/resolveThumbnailColor() (per-thumbnail accent color,
                                localStorage-cached) + timeAgo() + mascotFaviconDataUri() (a hand-built
                                recreation of assets/logo.png as a data: URI favicon, tinted per the
                                accent setting — see "Settings" above), shared by all pages
  api-aredl.js                  AREDL adapter (confirmed API shape, see note below) — reads the cache
                                 branch's aredl-cache.json first; also fetchChangelog() (top-150-filtered
                                 recent changes, used by the home page)
  data-source.js                 thin pass-through to the AREDL adapter, paginated by page number
  shared-cache.js                 reads the cache branch's yt-cache.json (see above) — the only source of view counts/showcases
  position-history.js              reads the cache branch's position-history.json, used by the detail page
  cache-admin-ui.js               per-level refresh button, see "Manual refresh" above
  roulette.js                      roulette.html's own controller — the percent-climb challenge,
                                    localStorage-persisted run state, see "What it does" above
  nav-actions.js                   Home + Roulette (links to roulette.html) + Random level + Stats +
                                    Copy link header buttons, every page
  settings.js                       accent-color/display-mode/default-list/new-tab/autoplay/motion
                                     side panel + dynamic favicon, every page
  home.js                           home page controller — spotlight cards + recent-changes panel
  list.js                           list page controller — also owns the #main/#extended/#q= hash-URL sync
  detail.js                          detail page controller — also owns Previous/Next and its own hashchange/popstate re-render
  queue.js                           queue page controller — reads the real persisted queue (cache.queue), doesn't re-sort
  shortcuts.js                        Ctrl+Alt+M/E/Q/R/S + ? keyboard shortcuts and the shortcuts panel, every page
  stats.js                            stats page controller — averages/records/charts, see "What it does" above
data/                        *.json gitignored on main — generated at runtime, published to the `cache` branch, see below
scripts/
  refresh-yt-cache.mjs        populates data/yt-cache.json — "discover" or "views" mode, see "Shared cache" above
  refresh-aredl-cache.mjs     populates data/aredl-cache.json + data/position-history.json, see "Shared AREDL cache" above
  watch-new-levels.mjs        populates data/new-level-watch.json — polls AREDL's changelog for any
                               change touching the top 150 and triggers the two scripts above when
                               it finds one, see "Watching for AREDL changes affecting the top 150" above
  publish-cache-branch.sh     what all three scripts' workflows call to publish to the `cache` branch, see "Cache branch" above
  showcase-blacklist.json     hand-maintained video/title-phrase blacklist, see "Showcase-matching algorithm" above
.github/workflows/
  refresh-yt-cache.yml        daily — discover mode (find showcases); also accepts a manual per-level target, see "Manual refresh" above
  refresh-yt-views.yml        every 30 min — views mode (refresh view counts)
  refresh-aredl-cache.yml     hourly — refreshes the AREDL level-list snapshot
  watch-new-levels.yml        every 15 min — watches for AREDL changes affecting the top 150, see above
worker/                      Cloudflare Worker proxy so the refresh button works for every visitor, see "One-click refresh trigger" above
  src/index.js                 the Worker itself — rejects queue-wide requests, rate-limits, then calls GitHub's workflow_dispatch API
  wrangler.toml                 Cloudflare deploy config (KV binding, repo/workflow vars — no secrets)
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
  resolved) and a separate `GET /levels/{id}/creators`. `scripts/refresh-aredl-cache.mjs` fetches
  and merges both onto every cached level now (see
  [Shared AREDL level-list cache](#shared-aredl-level-list-cache)), so cards are hydrated on
  arrival in the normal case; `AredlAPI.fetchExtras()` and the
  `hydrateCards()`/`hydrateAredlExtrasIfNeeded()` flow in `js/list.js` are what's left as the
  live-fallback path for the rare level missing from the cache.
- `GET /levels` accepts `limit`/`offset` but silently ignores them — it always returns every
  level (~1600 of them). `api-aredl.js` reads the hourly-refreshed `data/aredl-cache.json`
  snapshot instead (already trimmed to the top 150, see
  [Reducing to a top-150 list](#reducing-to-a-top-150-list)), falling back to a live call sliced
  the same way if the snapshot is missing, caches it in memory for the session, and
  paginates/searches client-side from there.

If AREDL changes their API shape in the future, that GitHub repo's `src/aredl/levels/` and
`src/aredl/records/` directories are the place to re-check field names against.
