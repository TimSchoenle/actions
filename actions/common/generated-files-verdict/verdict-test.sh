#!/usr/bin/env bash
# Drives verdict.sh through every branch. Usage: verdict-test.sh <path to verdict.sh>
set -euo pipefail

script="$1"
scratch="$(mktemp -d)"
trap 'rm -rf "${scratch}"' EXIT
failures=0

# run_case <name> <expected exit> <expected passed> <expected text in the log> VAR=value...
run_case() {
  local name="$1" want_exit="$2" want_passed="$3" want_text="$4"
  shift 4
  : > "${scratch}/output"
  : > "${scratch}/summary"
  local status=0
  env -i PATH="${PATH}" GITHUB_OUTPUT="${scratch}/output" GITHUB_STEP_SUMMARY="${scratch}/summary" \
    FAILED_JOBS= PENDING_JOBS= MERGED_HAS_CHANGES=false \
    HEAD_REPOSITORY=owner/repo REPOSITORY=owner/repo \
    "$@" bash "${script}" > "${scratch}/log" 2>&1 || status=$?

  local passed
  passed="$(sed -n 's/^passed=//p' "${scratch}/output")"
  if [ "${status}" != "${want_exit}" ] || [ "${passed}" != "${want_passed}" ] \
    || ! grep -qF -- "${want_text}" "${scratch}/log" "${scratch}/summary"; then
    echo "FAIL ${name}: exit ${status}, passed '${passed}'" \
      "(wanted exit ${want_exit}, passed '${want_passed}', text '${want_text}')"
    sed 's/^/    /' "${scratch}/log" "${scratch}/summary"
    failures=$((failures + 1))
  else
    echo "ok   ${name}"
  fi
}

run_case 'nothing pending' 0 true 'Every generated file is up to date.'
run_case 'a generator failed' 1 false 'failed or were cancelled: docs.' FAILED_JOBS=docs
run_case 'pending on a branch of this repository' 1 false 'The commit job adds them to this branch' \
  MERGED_HAS_CHANGES=true PENDING_JOBS='docs lock'
run_case 'pending on a fork' 1 false 'comes from a fork, which the commit job does not push to' \
  MERGED_HAS_CHANGES=true PENDING_JOBS='docs' HEAD_REPOSITORY=someone/repo
run_case 'fork summary names the remedy' 1 false '- Regenerate and push (fork pull request): docs' \
  MERGED_HAS_CHANGES=true PENDING_JOBS='docs' HEAD_REPOSITORY=someone/repo
run_case 'no head repository is not a fork' 1 false '- Waiting for the commit job: docs' \
  MERGED_HAS_CHANGES=true PENDING_JOBS='docs' HEAD_REPOSITORY=
run_case 'clean fork passes' 0 true 'Every generated file is up to date.' HEAD_REPOSITORY=someone/repo
run_case 'failed and pending together' 1 false '- Failed: lint' \
  FAILED_JOBS=lint MERGED_HAS_CHANGES=true PENDING_JOBS='docs'

if [ "${failures}" -ne 0 ]; then
  echo "::error::${failures} verdict case(s) failed."
  exit 1
fi
