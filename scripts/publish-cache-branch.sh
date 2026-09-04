#!/usr/bin/env bash
# =====================================================================
# PUBLISH TO THE CACHE BRANCH
#
# Publishes generated data file(s) to the `cache` branch instead of
# `main` — used by all three refresh-*.yml workflows after they've
# regenerated their file(s) in the main checkout's data/ directory
# (main itself no longer tracks these; see .gitignore). Keeping the
# every-30-min/hourly/daily bot commits off `main` means a human's
# `git push` on main never gets rejected by "remote contains work you
# do not have" from a cache refresh that landed in between — see the
# "Cache branch" section in README.md.
#
# Works from an isolated `git worktree` on the `cache` branch, separate
# from the main checkout, so it never touches whatever's checked out
# there. Re-fetches and hard-resets to origin/cache right before every
# commit attempt, and retries on a rejected push — the aredl workflow
# and the two yt workflows all target this same branch now (different
# files, but still the same ref), so a race between them is expected,
# not exceptional.
#
# Usage: publish-cache-branch.sh "<commit message>" <file> [file ...]
# (file paths relative to the repo root, e.g. data/aredl-cache.json)
# =====================================================================
set -euo pipefail

MSG=$1
shift
FILES=("$@")

REPO_ROOT=$(git rev-parse --show-toplevel)
WORKTREE=$(mktemp -d)
trap 'git -C "$REPO_ROOT" worktree remove --force "$WORKTREE" >/dev/null 2>&1 || true' EXIT

git -C "$REPO_ROOT" fetch origin cache
git -C "$REPO_ROOT" worktree add "$WORKTREE" cache >/dev/null

for attempt in 1 2 3 4 5; do
  git -C "$WORKTREE" fetch origin cache
  git -C "$WORKTREE" reset --hard origin/cache

  for f in "${FILES[@]}"; do
    mkdir -p "$WORKTREE/$(dirname "$f")"
    cp "$REPO_ROOT/$f" "$WORKTREE/$f"
  done

  # Stage before diffing, not after — `git diff` (unstaged, against the
  # index) silently ignores untracked paths entirely, so a file being
  # published for the very first time never showed up as a "change" and
  # this exited early without ever publishing it. `git diff --cached`
  # (against HEAD) correctly reports a brand-new staged file as an
  # addition.
  git -C "$WORKTREE" add "${FILES[@]}"
  if git -C "$WORKTREE" diff --cached --quiet -- "${FILES[@]}"; then
    echo "No changes to publish."
    exit 0
  fi

  git -C "$WORKTREE" config user.name "github-actions[bot]"
  git -C "$WORKTREE" config user.email "github-actions[bot]@users.noreply.github.com"
  git -C "$WORKTREE" commit -q -m "$MSG"

  if git -C "$WORKTREE" push origin cache; then
    echo "Published to the cache branch."
    exit 0
  fi

  echo "Push rejected (attempt $attempt/5) — another workflow likely raced us on the cache branch. Retrying..."
  sleep $((RANDOM % 5 + 1))
done

echo "Failed to publish after 5 attempts." >&2
exit 1
