#!/usr/bin/env bash
# Drives check-fork.sh through every branch. Usage: check-fork-test.sh <path to check-fork.sh>
set -euo pipefail

script="$1"
scratch="$(mktemp -d)"
trap 'rm -rf "${scratch}"' EXIT
failures=0

# pull <head repository> <head branch> <maintainer_can_modify>: one pull request as GitHub lists it.
pull() {
  printf '{"head":{"repo":{"full_name":"%s"},"ref":"%s"},"maintainer_can_modify":%s}' "$1" "$2" "$3"
}

# run_case <name> <pulls JSON> <expected proceed> <expected outcome> VAR=value...
run_case() {
  local name="$1" pulls="$2" want_proceed="$3" want_outcome="$4"
  shift 4
  : > "${scratch}/output"
  : > "${scratch}/summary"
  printf '%s' "${pulls}" > "${scratch}/pulls"
  local status=0
  env -i PATH="${PATH}" GITHUB_OUTPUT="${scratch}/output" GITHUB_STEP_SUMMARY="${scratch}/summary" \
    PULLS_FILE="${scratch}/pulls" REPOSITORY=owner/repo HEAD_REPOSITORY=someone/repo HEAD_BRANCH=feature \
    "$@" bash "${script}" > /dev/null 2>&1 || status=$?

  local proceed outcome
  proceed="$(sed -n 's/^proceed=//p' "${scratch}/output")"
  outcome="$(sed -n 's/^outcome=//p' "${scratch}/output")"
  if [ "${status}" != 0 ] || [ "${proceed}" != "${want_proceed}" ] || [ "${outcome}" != "${want_outcome}" ]; then
    echo "FAIL ${name}: exit ${status}, proceed '${proceed}', outcome '${outcome}'" \
      "(wanted exit 0, proceed '${want_proceed}', outcome '${want_outcome}')"
    failures=$((failures + 1))
  else
    echo "ok   ${name}"
  fi
}

run_case 'fork allows edits' "[$(pull someone/repo feature true)]" true ''
run_case 'fork does not allow edits' "[$(pull someone/repo feature false)]" false skipped
run_case 'no open pull request' '[]' false skipped
run_case 'only another branch is open' "[$(pull someone/repo other true)]" false skipped
run_case 'only another fork is open' "[$(pull else/repo feature true)]" false skipped
run_case 'the matching one among others' "[$(pull someone/repo other false),$(pull someone/repo feature true)]" true ''
run_case 'any matching one allowing edits is enough' "[$(pull someone/repo feature true),$(pull someone/repo feature false)]" true ''
run_case 'missing maintainer edits counts as not allowed' '[{"head":{"repo":{"full_name":"someone/repo"},"ref":"feature"}}]' false skipped
run_case 'the read failed' '' false skipped
run_case 'the response is not JSON' 'Bad Gateway' false skipped
run_case 'the response is not a list' '{"message":"Not Found"}' false skipped

if [ "${failures}" -ne 0 ]; then
  echo "::error::${failures} fork check case(s) failed."
  exit 1
fi
