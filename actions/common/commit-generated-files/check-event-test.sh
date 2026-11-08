#!/usr/bin/env bash
# Drives check-event.sh through every branch. Usage: check-event-test.sh <path to check-event.sh>
set -euo pipefail

script="$1"
scratch="$(mktemp -d)"
trap 'rm -rf "${scratch}"' EXIT
failures=0

# run_case <name> <expected exit> <expected proceed> <expected outcome> VAR=value...
run_case() {
  local name="$1" want_exit="$2" want_proceed="$3" want_outcome="$4"
  shift 4
  : > "${scratch}/output"
  : > "${scratch}/summary"
  local status=0
  env -i PATH="${PATH}" GITHUB_OUTPUT="${scratch}/output" GITHUB_STEP_SUMMARY="${scratch}/summary" \
    EVENT_NAME=workflow_run RUN_EVENT=pull_request RUN_CONCLUSION=success \
    HEAD_REPOSITORY=owner/repo REPOSITORY=owner/repo HEAD_BRANCH=feature DEFAULT_BRANCH=main \
    "$@" bash "${script}" > /dev/null 2>&1 || status=$?

  local proceed outcome
  proceed="$(sed -n 's/^proceed=//p' "${scratch}/output")"
  outcome="$(sed -n 's/^outcome=//p' "${scratch}/output")"
  if [ "${status}" != "${want_exit}" ] || [ "${proceed}" != "${want_proceed}" ] || [ "${outcome}" != "${want_outcome}" ]; then
    echo "FAIL ${name}: exit ${status}, proceed '${proceed}', outcome '${outcome}'" \
      "(wanted exit ${want_exit}, proceed '${want_proceed}', outcome '${want_outcome}')"
    failures=$((failures + 1))
  else
    echo "ok   ${name}"
  fi
}

run_case 'successful run of a same-repository pull request' 0 true ''
run_case 'failed run still commits' 0 true '' RUN_CONCLUSION=failure
run_case 'not started by workflow_run' 1 '' '' EVENT_NAME=pull_request
run_case 'run started by push' 0 false skipped RUN_EVENT=push
run_case 'pull request from a fork' 0 false skipped HEAD_REPOSITORY=someone/repo
run_case 'no head repository' 0 false skipped HEAD_REPOSITORY=
run_case 'default branch' 0 false skipped HEAD_BRANCH=main
run_case 'no head branch' 0 false skipped HEAD_BRANCH=
run_case 'cancelled run' 0 false skipped RUN_CONCLUSION=cancelled
run_case 'skipped run' 0 false skipped RUN_CONCLUSION=skipped
run_case 'timed out run' 0 false skipped RUN_CONCLUSION=timed_out

if [ "${failures}" -ne 0 ]; then
  echo "::error::${failures} event filter case(s) failed."
  exit 1
fi
