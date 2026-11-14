#!/usr/bin/env bash
# Prints the latest sanitized pipeline reports from the ci-status branch.
# usage: scripts/read-ci.sh [job ...]   (default: test server pages)   VERBOSE=1 shows all log sections
set -uo pipefail
git fetch -q origin '+refs/heads/ci-status:refs/remotes/origin/ci-status' 2>&1 | grep -v -i "acknowledg\|negotiation"
jobs=("$@"); [ ${#jobs[@]} -eq 0 ] && jobs=(test server pages)
for j in "${jobs[@]}"; do
  echo "=== $j"
  git show "origin/ci-status:reports/$j.json" 2>/dev/null | python3 -c "
import json, os, sys
d = json.load(sys.stdin)
print(d['job'], d['status'], d['sha'], d['at'])
quiet = ('install','build-app','build-server','typecheck','playwright-install')
for k, v in d['logs'].items():
    if d['status'] == 'success' and k in quiet and not os.environ.get('VERBOSE'): continue
    print('--', k); print('\n'.join(v[-16:]))
" || echo "(no report yet)"
done
git ls-tree -r --name-only origin/ci-status 2>/dev/null | grep envs || true
