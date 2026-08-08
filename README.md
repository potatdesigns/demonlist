# GD Demonlist

A Pointercrate/AREDL-style extreme demon list for Geometry Dash. Pure HTML/CSS/JS,
no build step, no backend — open `index.html` in a browser or host the folder anywhere static.

## Running it

Because it uses `fetch()`, most browsers block it under `file://`. Serve it locally instead:

```bash
cd gd-demonlist
python3 -m http.server 8080
# then open http://localhost:8080
```

Any static host (GitHub Pages, Netlify, Vercel, etc.) works too — just upload the folder as-is.

## What it does

- **List page (`index.html`)** — pulls the live, currently-ranked demon list from Pointercrate
  (or AREDL, via the toggle) and renders it as a grid of cards: thumbnail (of the verification
  video), rank, name, creator(s), verifier, and — side by side — the verifier video's view
  count vs. the most-viewed *same-level* showcase's view count, with the higher number
  highlighted in gold.
- **Detail page (`level.html`)** — click any card for the full picture: list ID, GD level ID,
  requirement %, verifier, publisher, all creators, an embedded player for the official
  verification video, and an embedded player for the auto-discovered top showcase, with
  both view counts shown for direct comparison.

## Why you need a YouTube API key

Pointercrate/AREDL give you the verification video URL directly, so that part needs no key —
same for the thumbnail, which is just `i.ytimg.com/vi/<id>/mqdefault.jpg` derived from that
video URL, no API call involved. But **view counts** and **"find the most popular showcase on
YouTube"** both require calling YouTube's own Data API — there's no way around that without
Google's API. Click the key icon in the header, paste in a free key from the
[Google Cloud Console](https://console.cloud.google.com/apis/credentials) (enable "YouTube
Data API v3"), and it's stored only in your browser's `localStorage` — sent straight from
your browser to Google, nothing routes through a third party. Without a key, the site still
works fully for browsing the list and details; the view-count/showcase panels just show an
"add key" prompt instead.

**Quota protection** (`js/youtube.js`): `search.list` calls cost 100 quota units apiece against
a default 10,000/day budget, so this is the part most likely to get rate-limited if left naive.
To avoid that: showcase results are cached hard (`YT_CACHE_TTL_MS`, 6h) and looked up before
any network call; the search itself starts with a single specific query and only escalates to
broader query variants if that first one turns up no same-level match; verifier-video stats for
a batch of cards that come into view together are fetched in one `videos.list` call instead of
one per card (that endpoint is 1 unit regardless of how many IDs you batch into it); every
YouTube call funnels through a small concurrency-limited, spaced queue (`YT_MAX_CONCURRENT`,
`YT_MIN_INTERVAL_MS`) so a fast scroll can't fire a burst all at once; and if YouTube ever does
report `quotaExceeded`/`dailyLimitExceeded`, that's cached in `localStorage` and every further
call fails fast with one clear message instead of retrying and hammering the same 403 for the
rest of the session.

Showcase discovery searches YouTube for the level and requires the result to actually be *of
that level* before it's eligible at all — every significant word of the level name must appear
in the candidate's title, or the numeric GD level ID must appear in the title/description
(lesser-known levels' showcases often cite the ID). Uploads that look like a raw verification
video are dropped, known showcase channels are preferred when present (see
`SHOWCASE_CHANNELS` in `js/config.js` — edit that list freely), and otherwise the highest view
count among same-level matches wins. It's still a heuristic — YouTube search doesn't expose a
way to guarantee *the* canonical showcase — but the same-level requirement means it can no
longer return some unrelated popular video that merely shared a search term.

## CORS

AREDL's API sends proper CORS headers, so it's fetched directly. **Pointercrate's does not** —
its backend (open source at `stadust/pointercrate`) registers no CORS fairing at all, so a
plain cross-origin `fetch()` from anywhere other than pointercrate.com itself gets silently
blocked by the browser before the response body is even readable (that's the "Failed to fetch"
this app used to throw for the Pointercrate source). Since there's no backend here to work
around that server-side, `corsFetchJson()` (`js/utils.js`) transparently retries through a
public CORS proxy (`CONFIG.CORS_PROXIES` in `js/config.js`, currently allorigins.win) whenever
a direct request fails outright. That proxy always answers HTTP 200 regardless of the real
upstream status, so the adapters sanity-check the parsed JSON shape rather than trust `res.ok`
on a proxied response.

## File layout

```
index.html            list page markup
level.html             detail page markup
css/
  base.css             design tokens, header, shared layout/states
  list.css              card grid + view-count comparison chips
  detail.css             detail page layout + dual video panels
js/
  config.js            endpoints, storage keys, tunables
  utils.js               formatting/parsing helpers shared by both pages
  api-pointercrate.js     Pointercrate adapter (confirmed API shape)
  api-aredl.js             AREDL adapter (confirmed API shape, see note below)
  data-source.js            routes list.js/detail.js to whichever adapter is active
  youtube.js                 YouTube Data API wrapper + localStorage cache
  ytkey-ui.js                  the "add API key" modal, shared by both pages
  list.js                       list page controller
  detail.js                      detail page controller
```

## A note on AREDL

Pointercrate's API is fully and publicly documented in plain text
(pointercrate.com/documentation), so `api-pointercrate.js` is built directly against
confirmed field names. AREDL's API (`api.aredl.net/v2/docs`) doesn't have plain-text docs —
just an interactive Scalar/OpenAPI page — so `api-aredl.js` is instead built and confirmed
directly against the open-source backend
([`All-Rated-Extreme-Demon-List/aredl-backend-v2`](https://github.com/All-Rated-Extreme-Demon-List/aredl-backend-v2))
and live responses. Two shape quirks worth knowing if you're touching that file:

- `GET /levels` (the list) only returns bare fields — no video, no thumbnail, no verifier, no
  creators, and `publisher` is just a `publisher_id` UUID. All of that lives on
  `GET /levels/{id}` (verification video + submitter under `verifications[0]`, publisher
  resolved) and a separate `GET /levels/{id}/creators`. List cards start bare and get
  hydrated with those once they scroll into view — see `AredlAPI.fetchExtras()` and the
  `hydrateCards()`/`hydrateAredlExtrasIfNeeded()` flow in `js/list.js`.
- `GET /levels` accepts `limit`/`offset` but silently ignores them — it always returns every
  level (~1600 of them). `api-aredl.js` fetches that full list once per session, caches it in
  memory, and paginates client-side.

If AREDL changes their API shape in the future, that GitHub repo's `src/aredl/levels/` and
`src/aredl/records/` directories are the place to re-check field names against.
