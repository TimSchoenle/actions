#!/usr/bin/env bash
# Decides whether the triggering workflow_run is one to commit for. Reads the event fields from the
# environment, so the verify workflow can drive every branch without a real workflow_run.
#
# Writes `proceed=true` to GITHUB_OUTPUT when it is, with `fork=true` when the pull request comes
# from a fork, whose branch is committed to only once check-fork.sh has confirmed it allows edits by
# maintainers. Otherwise writes `outcome=skipped` and `proceed=false`, with the reason in the step
# summary. Exits 1 when the job was not started by workflow_run at all.
set -euo pipefail

if [ "${EVENT_NAME}" != "workflow_run" ]; then
  echo "::error::commit-generated-files runs from a workflow_run job; this job was started by ${EVENT_NAME}."
  exit 1
fi

# Whether the branch matches one of EXCLUDED_BRANCHES: whitespace-separated shell patterns, in which
# * also matches "/". Pathname expansion is off while splitting, so a pattern is never matched
# against files in the working directory.
is_excluded() {
  local patterns pattern
  set -f
  read -r -d '' -a patterns <<< "${EXCLUDED_BRANCHES:-}" || true
  set +f
  for pattern in "${patterns[@]}"; do
    # shellcheck disable=SC2053 # the right-hand side is a pattern on purpose
    if [[ "${HEAD_BRANCH}" == ${pattern} ]]; then
      return 0
    fi
  done
  return 1
}

# Whether the branch is a plain branch name. A name starting with refs/ passes the string comparison
# with the default branch below while it may resolve to that branch on the write, and any name
# git check-ref-format --branch refuses is no branch the commit can address safely.
is_plain_branch() {
  [[ "${HEAD_BRANCH}" != refs/* ]] && git check-ref-format --branch "${HEAD_BRANCH}" > /dev/null 2>&1
}

fork=false
if [ -n "${HEAD_REPOSITORY}" ] && [ "${HEAD_REPOSITORY}" != "${REPOSITORY}" ]; then
  fork=true
fi

# A finished run, not a cancelled or skipped one: another job failing does not make the patch wrong,
# and the verdict job itself fails whenever there is something to commit. Never this repository's
# default branch. A fork's branch belongs to the fork, so its name alone rules nothing out there.
# A fork runs its own copy of the generators, which need not settle: a fork whose head is already a
# bot commit gets no further one, so it cannot drive the App into committing after every commit.
reason=''
if [ "${RUN_EVENT}" != "pull_request" ]; then
  reason="the run was started by ${RUN_EVENT}, not a pull request"
elif [ -z "${HEAD_REPOSITORY}" ]; then
  reason="the run names no head repository"
elif [ -z "${HEAD_BRANCH}" ]; then
  reason="the run names no branch"
elif ! is_plain_branch; then
  reason="the branch name is not a plain branch name git accepts"
elif [ "${fork}" = "false" ] && [ "${HEAD_BRANCH}" = "${DEFAULT_BRANCH}" ]; then
  reason="the run is for the default branch"
elif [ "${fork}" = "false" ] && is_excluded; then
  reason="the branch matches excluded_branches"
elif [ "${fork}" = "true" ] && [[ "${HEAD_AUTHOR_EMAIL:-}" == *"[bot]@users.noreply.github.com" ]]; then
  reason="the fork's head commit is already a bot's"
elif [ "${RUN_CONCLUSION}" != "success" ] && [ "${RUN_CONCLUSION}" != "failure" ]; then
  reason="the run ended ${RUN_CONCLUSION}"
fi

if [ -n "${reason}" ]; then
  echo "Nothing to commit: ${reason}." | tee -a "${GITHUB_STEP_SUMMARY}"
  echo "outcome=skipped" >> "${GITHUB_OUTPUT}"
  echo "proceed=false" >> "${GITHUB_OUTPUT}"
else
  echo "proceed=true" >> "${GITHUB_OUTPUT}"
  echo "fork=${fork}" >> "${GITHUB_OUTPUT}"
fi
