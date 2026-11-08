#!/usr/bin/env bash
# Decides whether the triggering workflow_run is one to commit for. Reads the event fields from the
# environment, so the verify workflow can drive every branch without a real workflow_run.
#
# Writes `proceed=true` to GITHUB_OUTPUT when it is; otherwise `outcome=skipped` and `proceed=false`,
# with the reason in the step summary. Exits 1 when the job was not started by workflow_run at all.
set -euo pipefail

if [ "${EVENT_NAME}" != "workflow_run" ]; then
  echo "::error::commit-generated-files runs from a workflow_run job; this job was started by ${EVENT_NAME}."
  exit 1
fi

# A finished run, not a cancelled or skipped one: another job failing does not make the patch wrong,
# and the verdict job itself fails whenever there is something to commit. Never the default branch,
# and never a fork's branch, which this repository's token cannot and must not write to.
reason=''
if [ "${RUN_EVENT}" != "pull_request" ]; then
  reason="the run was started by ${RUN_EVENT}, not a pull request"
elif [ -z "${HEAD_REPOSITORY}" ] || [ "${HEAD_REPOSITORY}" != "${REPOSITORY}" ]; then
  reason="the pull request comes from ${HEAD_REPOSITORY:-an unknown repository}"
elif [ -z "${HEAD_BRANCH}" ]; then
  reason="the run names no branch"
elif [ "${HEAD_BRANCH}" = "${DEFAULT_BRANCH}" ]; then
  reason="the run is for the default branch"
elif [ "${RUN_CONCLUSION}" != "success" ] && [ "${RUN_CONCLUSION}" != "failure" ]; then
  reason="the run ended ${RUN_CONCLUSION}"
fi

if [ -n "${reason}" ]; then
  echo "Nothing to commit: ${reason}." | tee -a "${GITHUB_STEP_SUMMARY}"
  echo "outcome=skipped" >> "${GITHUB_OUTPUT}"
  echo "proceed=false" >> "${GITHUB_OUTPUT}"
else
  echo "proceed=true" >> "${GITHUB_OUTPUT}"
fi
