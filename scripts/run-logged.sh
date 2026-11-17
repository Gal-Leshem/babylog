#!/usr/bin/env bash
# Runs a command, keeping its output in .ci-logs/<label>.log (for the sanitized CI report)
# while still printing it. Preserves the command's exit code.
# usage: run-logged.sh <label> <command...>
set -o pipefail
label="$1"; shift
mkdir -p .ci-logs
echo "+ $*" | tee ".ci-logs/${label}.log"
start=$(date +%s)
"$@" 2>&1 | tee -a ".ci-logs/${label}.log"
code=${PIPESTATUS[0]}
# how long the step took (the reports keep the last lines of each log, so this line is always there)
echo "took $(( $(date +%s) - start ))s" | tee -a ".ci-logs/${label}.log"
exit "$code"
