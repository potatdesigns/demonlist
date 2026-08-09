/* =====================================================================
   CACHE ADMIN UI
   Refresh controls for the showcase-discovery workflow (refresh-yt-cache.yml,
   see scripts/refresh-yt-cache.mjs) — a site-wide "refresh the queue" button
   (header, both pages) and a per-level "refresh this level" button (detail
   page, next to "Verification vs. showcase"). Both run the exact same
   workflow; the only difference is whether a `target_level_id` is sent —
   see scripts/refresh-yt-cache.mjs for how that's used to jump one level
   to the front of the queue, bypassing the normal priority order. Either
   way, the workflow always writes through the same discover logic, so
   both kinds of trigger update the queue's priority ordering for next time,
   not just the one thing they targeted.

   Two ways this can actually run a trigger:

   1. CONFIG.TRIGGER_WORKER_URL set — calls that Cloudflare Worker
      (see worker/), which holds a GitHub token server-side and rate-limits
      requests. This is a real one-click trigger, safe to show to every
      visitor, because the token never reaches the browser. See
      worker/src/index.js and README's "One-click refresh trigger".
   2. CONFIG.TRIGGER_WORKER_URL unset (not deployed yet) — falls back to
      copying the level id (if any) to the clipboard and opening the
      workflow's GitHub Actions page, same as before. GitHub's own auth
      still gates the actual "Run workflow" button there to signed-in
      collaborators with write access — safe to show to everyone, just not
      a one-click trigger for anyone who isn't one.
   ===================================================================== */

const CacheAdminUI = (() => {
  const ICON = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/></svg>`;
  const CHECK = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>`;
  const SPIN = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" class="icon-spin"><path d="M21 12a9 9 0 1 1-2.64-6.36"/></svg>`;
  const WARN = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4"/><circle cx="12" cy="12" r="9"/><path d="M12 16h.01"/></svg>`;

  function flash(btn, { icon, title, ms = 2500 }, revertTo) {
    clearTimeout(btn._resetTimer);
    btn.innerHTML = icon;
    btn.title = title;
    btn._resetTimer = setTimeout(() => {
      btn.innerHTML = revertTo.icon;
      btn.title = revertTo.title;
    }, ms);
  }

  /** Actually-visible status message (not just a hover-only title) — appears under the button, auto-hides. Errors get more time on screen since they're the ones worth actually reading. */
  function showStatus(statusEl, message, isError) {
    clearTimeout(statusEl._hideTimer);
    statusEl.textContent = message;
    statusEl.classList.toggle('error', !!isError);
    statusEl.classList.add('visible');
    statusEl._hideTimer = setTimeout(() => statusEl.classList.remove('visible'), isError ? 9000 : 5000);
  }

  async function triggerViaWorker(workerUrl, targetLevelId) {
    const res = await fetch(workerUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(targetLevelId ? { targetLevelId } : {}),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 429) {
      const mins = Math.ceil((data.retryAfterSeconds || 0) / 60);
      return { ok: false, message: `Already triggered recently — try again in ~${mins}m` };
    }
    if (!res.ok || !data.ok) {
      return { ok: false, message: data.error || `Trigger failed (${res.status})` };
    }
    return { ok: true };
  }

  async function fallbackCopyAndOpen(targetLevelId) {
    const url = `https://github.com/${CONFIG.GITHUB_REPO}/actions/workflows/refresh-yt-cache.yml`;
    if (targetLevelId) {
      try { await navigator.clipboard.writeText(String(targetLevelId)); } catch { /* clipboard unavailable — still open the link */ }
    }
    window.open(url, '_blank', 'noopener');
    return { ok: true, fallback: true };
  }

  /**
   * @param container  element to append the button into
   * @param opts.levelId  AREDL internal id to target — omit for a queue-wide run
   * @param opts.label    accessible label, e.g. "Refresh this level's videos" / "Refresh showcase queue"
   */
  function mountRefreshButton(container, { levelId = null, label = 'Refresh showcase cache' } = {}) {
    if (!container) return;

    const idleTitle = CONFIG.TRIGGER_WORKER_URL
      ? label
      : `${label} (copies the level id and opens the workflow page — needs repo write access to run)`;

    const wrap = document.createElement('span');
    wrap.className = 'refresh-btn-wrap';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'icon-btn';
    btn.setAttribute('aria-label', label);
    btn.title = idleTitle;
    btn.innerHTML = ICON;

    const statusEl = document.createElement('div');
    statusEl.className = 'refresh-status';
    statusEl.setAttribute('role', 'status');

    btn.addEventListener('click', async () => {
      if (btn.disabled) return;
      btn.disabled = true;
      btn.innerHTML = SPIN;

      try {
        const result = CONFIG.TRIGGER_WORKER_URL
          ? await triggerViaWorker(CONFIG.TRIGGER_WORKER_URL, levelId)
          : await fallbackCopyAndOpen(levelId);

        if (result.ok && !result.fallback) {
          flash(btn, { icon: CHECK, title: 'Refresh triggered' }, { icon: ICON, title: idleTitle });
          showStatus(statusEl, 'Refresh triggered — check back in a few minutes.', false);
        } else if (result.ok && result.fallback) {
          const msg = levelId ? 'Level ID copied — paste it into "target_level_id" on the workflow page.' : 'Opened the workflow page.';
          flash(btn, { icon: CHECK, title: msg }, { icon: ICON, title: idleTitle });
          showStatus(statusEl, msg, false);
        } else {
          flash(btn, { icon: WARN, title: result.message }, { icon: ICON, title: idleTitle });
          showStatus(statusEl, result.message, true);
        }
      } catch (err) {
        const msg = `Couldn't reach the refresh trigger: ${err.message}`;
        flash(btn, { icon: WARN, title: msg }, { icon: ICON, title: idleTitle });
        showStatus(statusEl, msg, true);
      } finally {
        btn.disabled = false;
      }
    });

    wrap.appendChild(btn);
    wrap.appendChild(statusEl);
    container.appendChild(wrap);
  }

  return {
    mountRefreshButton,
    mountLevelRefreshButton: (container, levelId) => mountRefreshButton(container, { levelId, label: "Refresh this level's videos" }),
    mountQueueRefreshButton: (container) => mountRefreshButton(container, { label: 'Refresh showcase queue' }),
  };
})();
