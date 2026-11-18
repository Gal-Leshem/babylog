#!/usr/bin/env bash
# Takes a commit that is already on `dev` all the way to production, and stops at the first failure.
#   usage: bash scripts/ship.sh <sha7>      (run it in the background: it waits for CI, about 4 + 4 minutes)
# 1. waits until BOTH `dev` reports for that commit (test and server) exist and say "success"; otherwise stops before main;
# 2. pushes the same commit to `main`;
# 3. waits for the `main` test, server and prod reports (all "success"), then for the live site to serve the commit;
# 4. prints the live-test and production lines from the reports.
# The site address is derived from the git remote (no address is written here).
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"
H=${1:?usage: ship.sh <sha7>}
remote=$(git remote get-url origin | sed -E 's#\.git$##')
owner=$(basename "$(dirname "$remote")")
repo=$(basename "$remote")
site="https://$(echo "$owner" | tr '[:upper:]' '[:lower:]').github.io/$repo/version.json"

fetch() { git fetch -q origin '+refs/heads/ci-status:refs/remotes/origin/ci-status' 2>/dev/null; }
# report commit for <job> <ref>, or nothing
rep() {
  for c in $(git log origin/ci-status --format='%h %s' | grep "report: $1 $H" | awk '{print $1}'); do
    git show "$c:reports/$1.json" | grep -q "\"ref\": \"$2\"" && { echo "$c"; return; }
  done
}
status() { git show "$1:reports/$2.json" | grep -o '"status": "[a-z]*"' | head -1 | cut -d'"' -f4; }
wait_for() { # wait_for <ref> <jobs...>
  local ref=$1; shift
  for _ in $(seq 1 90); do
    fetch
    local all=1
    for j in "$@"; do
      c=$(rep "$j" "$ref")
      if [ -z "$c" ]; then all=0; continue; fi
      s=$(status "$c" "$j")
      if [ "$s" != success ]; then
        echo "$ref $j: $s"
        git show "$c:reports/$j.json" | grep -E "FAIL|Error|failed" | head -12
        return 1
      fi
    done
    [ $all = 1 ] && { echo "$ref: $* all success"; return 0; }
    sleep 20
  done
  echo "$ref: timed out"
  return 1
}

wait_for dev test server || { echo "STOPPED BEFORE MAIN"; exit 1; }
git push -q origin "$H:refs/heads/main" && echo "pushed to main"
wait_for main test server prod || { echo "MAIN FAILED"; exit 1; }
V=''
for _ in $(seq 1 30); do V=$(curl -sS "$site?x=$RANDOM"); echo "$V" | grep -q "$H" && break; sleep 10; done
echo "site: $V"
git show "$(rep server main):reports/server.json" | grep -E "LIVE TEST|answers from this build"
git show "$(rep prod main):reports/prod.json" | grep -E "prod server deployed"
echo "done $H"
