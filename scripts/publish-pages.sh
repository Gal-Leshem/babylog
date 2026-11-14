#!/usr/bin/env bash
# Publishes ./dist to the gh-pages branch as a single fresh commit (GitHub Pages serves that branch).
set -euo pipefail
test -f dist/index.html || { echo "dist/ is missing: build first" >&2; exit 1; }
short="${GITHUB_SHA:-local}"; short="${short:0:7}"
rm -rf .pages-tmp
git worktree prune
git worktree add -q -f --detach .pages-tmp
cd .pages-tmp
git checkout -q --orphan gh-pages
git rm -rfq --ignore-unmatch .
cp -a ../dist/. .
touch .nojekyll
printf '{"commit":"%s"}\n' "$short" > version.json
git add -A
git commit -q -m "deploy ${short}"
git push -q -f origin HEAD:refs/heads/gh-pages
echo "published ${short} to gh-pages"
