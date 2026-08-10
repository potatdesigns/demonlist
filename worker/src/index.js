/* =====================================================================
   CACHE-REFRESH TRIGGER (Cloudflare Worker)

   Lets any site visitor actually trigger the showcase-discovery workflow
   (refresh-yt-cache.yml) for a single level (target_level_id required —
   see the check below) without needing a GitHub sign-in. The GitHub
   token that can do that lives only here, as a Worker secret, never in
   the browser; visitors call this Worker, and this Worker calls GitHub.

   Deliberately can't trigger a queue-wide run (no target_level_id) —
   that used to be allowed, but letting any visitor kick off an expensive
   full-list discover run on demand was too much power to hand out
   publicly. This is enforced here, not just left to the site's UI, so a
   request straight to this Worker (bypassing the site entirely) can't do
   it either.

   Rate-limited by a single global cooldown (COOLDOWN_SECONDS, shared by
   both level-specific and queue-wide triggers, tracked as one KV key) —
   simple on purpose. The actual resource being protected is cheap (a
   discover run costs on the order of a few hundred YouTube quota units
   at most, see scripts/refresh-yt-cache.mjs), so this isn't a hard
   security boundary, just abuse-proofing against someone mashing the
   button. KV is eventually consistent across Cloudflare's edge, so a
   request landing on two different edge locations within the same
   propagation window could in principle slip past the cooldown together
   — acceptable for this; it's not protecting anything that valuable.

   The cooldown is only recorded after a *successful* dispatch (see
   markDispatched(), called only in the success branch below) — it used
   to be set unconditionally up front, which meant a failed attempt (bad
   GITHUB_TOKEN, GitHub outage, whatever) burned the same cooldown
   window a successful run would have, blocking even an immediate retry
   right after fixing the underlying problem. A failure now costs
   nothing but itself.

   Required bindings (see wrangler.toml / README):
     KV namespace  RATE_LIMIT     — cooldown tracking
     secret        GITHUB_TOKEN   — fine-grained PAT, "Actions: read and
                                     write" on this one repo, nothing else
     var           GITHUB_REPO    — "owner/repo"
     var           WORKFLOW_FILE  — e.g. "refresh-yt-cache.yml"
     var           GIT_REF        — branch the workflow lives on, e.g. "main"
     var           COOLDOWN_SECONDS (optional, default 60)
   ===================================================================== */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

/** Seconds still remaining on the cooldown, or 0 if a dispatch is allowed right now. Read-only — does not itself start a new cooldown. */
async function getCooldownRemaining(env) {
  const cooldownSeconds = parseInt(env.COOLDOWN_SECONDS || '60', 10);
  const last = await env.RATE_LIMIT.get('last_dispatch_at');
  if (!last) return 0;
  const elapsedSeconds = (Date.now() - parseInt(last, 10)) / 1000;
  return Math.max(0, Math.ceil(cooldownSeconds - elapsedSeconds));
}

/** Starts a fresh cooldown window — call only after a dispatch actually succeeds. */
async function markDispatched(env) {
  const cooldownSeconds = parseInt(env.COOLDOWN_SECONDS || '60', 10);
  // TTL a little past the cooldown itself, just so a stale key can't
  // linger indefinitely if something odd happens.
  await env.RATE_LIMIT.put('last_dispatch_at', String(Date.now()), { expirationTtl: cooldownSeconds + 60 });
}

async function dispatchWorkflow(env, targetLevelId) {
  const url = `https://api.github.com/repos/${env.GITHUB_REPO}/actions/workflows/${env.WORKFLOW_FILE}/dispatches`;
  const inputs = targetLevelId ? { target_level_id: targetLevelId } : {};

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'demonlist-cache-trigger-worker',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ref: env.GIT_REF || 'main', inputs }),
  });

  if (res.status !== 204) {
    const detail = await res.text().catch(() => '');
    throw new Error(`GitHub dispatch failed (${res.status}): ${detail.slice(0, 300)}`);
  }
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }
    if (request.method !== 'POST') {
      return json({ ok: false, error: 'Method not allowed — POST only.' }, 405);
    }

    let body = {};
    try {
      const text = await request.text();
      if (text) body = JSON.parse(text);
    } catch {
      return json({ ok: false, error: 'Malformed JSON body.' }, 400);
    }

    const targetLevelId = typeof body.targetLevelId === 'string' && body.targetLevelId.trim()
      ? body.targetLevelId.trim()
      : null;

    if (!targetLevelId) {
      return json({ ok: false, error: 'Queue-wide refresh is disabled — target_level_id is required.' }, 400);
    }

    const remaining = await getCooldownRemaining(env);
    if (remaining > 0) {
      return json({ ok: false, error: 'rate_limited', retryAfterSeconds: remaining }, 429);
    }

    try {
      await dispatchWorkflow(env, targetLevelId);
      await markDispatched(env); // only start the cooldown once we know it actually worked
      return json({ ok: true, targetLevelId });
    } catch (err) {
      return json({ ok: false, error: err.message }, 502);
    }
  },
};
