#!/usr/bin/env bash
# Drives read-pulls.sh, and check-fork.sh on its output, against a stand-in `gh` that serves the
# shapes GitHub returns: the list endpoint without `maintainer_can_modify`, the single pull request
# with it. Usage: read-pulls-test.sh <path to read-pulls.sh> <path to check-fork.sh>
set -euo pipefail

reader="$1"
checker="$2"
scratch="$(mktemp -d)"
trap 'rm -rf "${scratch}"' EXIT
mkdir -p "${scratch}/bin" "${scratch}/api"
failures=0

# The stand-in serves "${scratch}/api/<path with / as _>.json" and fails for anything else, or for
# every request while "${scratch}/api/fail" exists.
cat > "${scratch}/bin/gh" << 'EOF'
#!/usr/bin/env bash
set -euo pipefail
[ ! -e "${GH_FIXTURES}/fail" ] || exit 1
path=''
for arg in "$@"; do
  case "${arg}" in repos/*) path="${arg}" ;; esac
done
file="${GH_FIXTURES}/${path//\//_}.json"
[ -f "${file}" ] || exit 1
cat "${file}"
EOF
chmod +x "${scratch}/bin/gh"

# listed <number> <head repository> <head branch>: a pull request as the list endpoint returns it.
listed() {
  printf '{"number":%s,"head":{"repo":{"full_name":"%s"},"ref":"%s"}}' "$1" "$2" "$3"
}

# full <number> <head repository> <head branch> <maintainer_can_modify>: as the single endpoint does.
full() {
  printf '{"number":%s,"head":{"repo":{"full_name":"%s"},"ref":"%s"},"maintainer_can_modify":%s}' "$1" "$2" "$3" "$4"
}

# run_case <name> <expected proceed> <expected outcome> <list JSON> [<number>=<full JSON>...]
run_case() {
  local name="$1" want_proceed="$2" want_outcome="$3" list="$4"
  shift 4
  rm -f "${scratch}/api/"*
  printf '%s' "${list}" > "${scratch}/api/repos_owner_repo_pulls.json"
  local entry
  for entry in "$@"; do
    if [ "${entry}" = fail ]; then
      : > "${scratch}/api/fail"
    else
      printf '%s' "${entry#*=}" > "${scratch}/api/repos_owner_repo_pulls_${entry%%=*}.json"
    fi
  done
  : > "${scratch}/output"
  : > "${scratch}/summary"
  local common=(PATH="${scratch}/bin:${PATH}" GH_FIXTURES="${scratch}/api" REPOSITORY=owner/repo
    HEAD_REPOSITORY=someone/repo HEAD_BRANCH=feature)
  if ! env -i "${common[@]}" bash "${reader}" > "${scratch}/pulls" 2> /dev/null; then
    : > "${scratch}/pulls"
  fi
  local status=0
  env -i "${common[@]}" PULLS_FILE="${scratch}/pulls" GITHUB_OUTPUT="${scratch}/output" \
    GITHUB_STEP_SUMMARY="${scratch}/summary" bash "${checker}" > /dev/null 2>&1 || status=$?

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

run_case 'allowed edits are read from the full pull request' true '' \
  "[$(listed 7 someone/repo feature)]" "7=$(full 7 someone/repo feature true)"
run_case 'edits not allowed' false skipped \
  "[$(listed 7 someone/repo feature)]" "7=$(full 7 someone/repo feature false)"
run_case 'no open pull request' false skipped '[]'
run_case 'only another branch is listed' false skipped "[$(listed 7 someone/repo other)]"
run_case 'only the matching one is read' true '' \
  "[$(listed 6 someone/repo other),$(listed 7 someone/repo feature)]" "7=$(full 7 someone/repo feature true)"
run_case 'a failed read of the full pull request skips' false skipped "[$(listed 7 someone/repo feature)]"
run_case 'a failed list skips' false skipped "[$(listed 7 someone/repo feature)]" fail

if [ "${failures}" -ne 0 ]; then
  echo "::error::${failures} pull request read case(s) failed."
  exit 1
fi
