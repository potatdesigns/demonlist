/* =====================================================================
   CACHE-REFRESH TRIGGER (Cloudflare Worker)

   Lets any site visitor actually trigger the showcase-discovery workflow
   (refresh-yt-cache.yml) — either for one level (target_level_id) or a
   normal queue-wide run — without needing a GitHub sign-in. The GitHub
   token that can do that lives only here, as a Worker secret, never in
   the browser; visitors call this Worker, and this Worker calls GitHub.

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

   Required bindings (see wrangler.toml / README):
     KV namespace  RATE_LIMIT     — cooldown tracking
     secret        GITHUB_TOKEN   — fine-grained PAT, "Actions: read and
                                     write" on this one repo, nothing else
     var           GITHUB_REPO    — "owner/repo"
     var           WORKFLOW_FILE  — e.g. "refresh-yt-cache.yml"
     var           GIT_REF        — branch the workflow lives on, e.g. "main"
     var           COOLDOWN_SECONDS (optional, default 600)
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

async function checkAndSetCooldown(env) {
  const key = 'last_dispatch_at';
  const cooldownSeconds = parseInt(env.COOLDOWN_SECONDS || '600', 10);
  const last = await env.RATE_LIMIT.get(key);
  const now = Date.now();

  if (last) {
    const elapsedSeconds = (now - parseInt(last, 10)) / 1000;
    if (elapsedSeconds < cooldownSeconds) {
      return { ok: false, retryAfterSeconds: Math.ceil(cooldownSeconds - elapsedSeconds) };
    }
  }

  // TTL a little past the cooldown itself, just so a stale key can't
  // linger indefinitely if something odd happens.
  await env.RATE_LIMIT.put(key, String(now), { expirationTtl: cooldownSeconds + 60 });
  return { ok: true };
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

    const cooldown = await checkAndSetCooldown(env);
    if (!cooldown.ok) {
      return json({ ok: false, error: 'rate_limited', retryAfterSeconds: cooldown.retryAfterSeconds }, 429);
    }

    try {
      await dispatchWorkflow(env, targetLevelId);
      return json({ ok: true, targetLevelId });
    } catch (err) {
      return json({ ok: false, error: err.message }, 502);
    }
  },
};
