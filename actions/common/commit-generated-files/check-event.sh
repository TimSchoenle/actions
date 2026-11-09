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
elif [ "${fork}" = "false" ] && [ "${HEAD_BRANCH}" = "${DEFAULT_BRANCH}" ]; then
  reason="the run is for the default branch"
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
