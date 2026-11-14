#!/usr/bin/env bash
# usage: report.sh <job>   (JOB_STATUS comes from the workflow)
set -uo pipefail
job="$1"
bash scripts/status-branch.sh init || exit 0
node scripts/ci-report.mjs "$job" "${JOB_STATUS:-unknown}" || exit 0
bash scripts/status-branch.sh publish "report: ${job} ${GITHUB_SHA:0:7}" || echo "report could not be published"
exit 0
