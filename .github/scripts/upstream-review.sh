#!/usr/bin/env bash
set -euo pipefail

upstream_url='https://github.com/maillab/cloud-mail.git'
if git remote get-url upstream >/dev/null 2>&1; then
  test "$(git remote get-url upstream)" = "$upstream_url" || { echo 'Unexpected upstream URL; refusing.' >&2; exit 1; }
else
  git remote add upstream "$upstream_url"
fi
# Discover a real, non-prerelease tag from the fixed upstream, not a hardcoded version.
tag=$(git ls-remote --tags --refs upstream | awk '{sub("refs/tags/", "", $2); print $2}' | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | sort -V | tail -n 1)
[[ "$tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo 'No stable upstream tag found.' >&2; exit 1; }
ref="refs/remotes/upstream/release-${tag}"
git fetch --no-tags upstream "refs/tags/${tag}:${ref}"
git fetch origin main
release=$(git rev-parse "${ref}^{commit}")
branch="automation/upstream-review-${tag}"
echo "Latest upstream stable: ${tag} (${release})"
if git merge-base --is-ancestor "$release" origin/main; then
  echo 'The latest stable release is already integrated into main.'
  exit 0
fi
if [[ "${UPSTREAM_REVIEW_DRY_RUN:-0}" == 1 ]]; then
  echo "Dry run: would review ${tag} on ${branch}; no commit, push or PR."
  exit 0
fi
# A closed unmerged PR represents a deliberate review decision; do not recreate it.
existing=$(gh pr list --base main --head "$branch" --state all --json number --jq '.[0].number // empty')
if [[ -n "$existing" ]]; then
  echo "Review PR #${existing} already exists; preserving all human changes."
  exit 0
fi
if git ls-remote --exit-code --heads origin "$branch" >/dev/null 2>&1; then
  echo 'Review branch already exists; preserving it and opening a draft PR.'
else
  git switch -c "$branch" origin/main
  base=$(git merge-base HEAD "$release") || { echo 'No shared ancestry; refusing unrelated-history replacement.' >&2; exit 1; }
  if ! git -c user.name='upstream-review[bot]' -c user.email='upstream-review@users.noreply.github.com' merge --no-ff --no-edit "$release"; then
    # Never commit conflict markers into application files. Keep a reviewable
    # upstream patch and explanation while leaving production source unchanged.
    git merge --abort
    mkdir -p .github/upstream-patches
    git diff --binary "$base" "$release" > ".github/upstream-patches/${tag}.patch"
    printf '# Upstream %s requires manual conflict resolution\n\nSource application files were not changed. Review the adjacent patch and merge upstream commit `%s` manually, preserving local customizations, resource bindings and user data. This branch must not deploy.\n' "$tag" "$release" > ".github/upstream-patches/${tag}.md"
    git add .github/upstream-patches
    git -c user.name='upstream-review[bot]' -c user.email='upstream-review@users.noreply.github.com' commit -m "chore: review upstream ${tag} conflicts [skip ci]"
  fi
  git push origin "HEAD:refs/heads/${branch}"
fi
gh pr create --draft --base main --head "$branch" \
  --title "chore: review upstream ${tag}" \
  --body "Upstream: maillab/cloud-mail ${tag}, commit ${release}. Draft for human review only. Review all source/schema changes, preserved customizations and resource bindings. Run tests and back up the existing D1 before any migration. Resolve any recorded conflict patch manually. This workflow never deploys or merges automatically."
