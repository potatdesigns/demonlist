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
  (or AREDL, via the toggle) and renders it as a grid of cards: thumbnail, rank, name,
  creator(s), verifier, and — side by side — the verifier video's view count vs. the
  most-viewed showcase's view count, with the higher number highlighted in gold.
- **Detail page (`level.html`)** — click any card for the full picture: list ID, GD level ID,
  requirement %, verifier, publisher, all creators, an embedded player for the official
  verification video, and an embedded player for the auto-discovered top showcase, with
  both view counts shown for direct comparison.

## Why you need a YouTube API key

Pointercrate/AREDL give you the verification video URL directly, so that part needs no key.
But **view counts** and **"find the most popular showcase on YouTube"** both require calling
YouTube's own Data API — there's no way around that without Google's API. Click the key icon
in the header, paste in a free key from the
[Google Cloud Console](https://console.cloud.google.com/apis/credentials) (enable "YouTube
Data API v3"), and it's stored only in your browser's `localStorage` — sent straight from
your browser to Google, nothing routes through a third party. Without a key, the site still
works fully for browsing the list and details; the view-count/showcase panels just show an
"add key" prompt instead.

Showcase discovery works by searching `"<level name> GD showcase"` and `"<level name>
Geometry Dash"`, filtering out uploads that look like raw verification videos, preferring
known showcase channels (see `SHOWCASE_CHANNELS` in `js/config.js` — edit that list freely),
and otherwise falling back to the single highest view count found. It's a heuristic, not
guaranteed to always be *the* most-viewed showcase in existence — YouTube search doesn't
expose a perfect way to guarantee that — but in practice it finds the right video for
well-known levels.

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
  api-aredl.js             AREDL adapter (best-effort, see note below)
  data-source.js            routes list.js/detail.js to whichever adapter is active
  youtube.js                 YouTube Data API wrapper + localStorage cache
  ytkey-ui.js                  the "add API key" modal, shared by both pages
  list.js                       list page controller
  detail.js                      detail page controller
```

## A note on AREDL

Pointercrate's API is fully and publicly documented in plain text
(pointercrate.com/documentation), so `api-pointercrate.js` is built directly against
confirmed field names. AREDL's API (`api.aredl.net/v2/docs`) is real and public but its
schema is only published through an interactive API-explorer page rather than plain docs, so
`api-aredl.js` is a **best-effort** mapping, deliberately isolated in that one file with
comments pointing at exactly what to check/patch if a field name turns out to be off. If the
AREDL toggle shows an error, that's almost certainly the fix needed.
