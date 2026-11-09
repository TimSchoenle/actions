#!/usr/bin/env bash
# Decides the Generated Files verdict and explains it.
#
# FAILED_JOBS and PENDING_JOBS come from the helper's evaluate mode, MERGED_HAS_CHANGES from the
# merged patch. HEAD_REPOSITORY and REPOSITORY tell a fork's pull request apart: the commit job
# never pushes to a fork, so its contributor has to regenerate the files and push them instead of
# waiting for a commit that will not come.
set -euo pipefail

passed=true
fork=false
if [ -n "${HEAD_REPOSITORY:-}" ] && [ "${HEAD_REPOSITORY}" != "${REPOSITORY:-}" ]; then
  fork=true
fi

if [ -n "${FAILED_JOBS:-}" ]; then
  echo "::error::These generator jobs failed or were cancelled: ${FAILED_JOBS}."
  passed=false
fi
if [ "${MERGED_HAS_CHANGES:-}" = "true" ]; then
  if [ "${fork}" = "true" ]; then
    echo "::error::Generated files are out of date (${PENDING_JOBS:-}). This pull request comes from a fork, which the commit job does not push to: regenerate the files locally, or apply this run's generated-files patch, and push."
  else
    echo "::error::Generated files are out of date (${PENDING_JOBS:-}). The commit job adds them to this branch, and the run on that commit decides."
  fi
  passed=false
fi

echo "passed=${passed}" >> "$GITHUB_OUTPUT"
if [ "${passed}" = "true" ]; then
  echo "Every generated file is up to date." >> "$GITHUB_STEP_SUMMARY"
else
  {
    echo "Generated files are not up to date."
    if [ -n "${FAILED_JOBS:-}" ]; then echo "- Failed: ${FAILED_JOBS}"; fi
    if [ "${MERGED_HAS_CHANGES:-}" = "true" ]; then
      if [ "${fork}" = "true" ]; then
        echo "- Regenerate and push (fork pull request): ${PENDING_JOBS:-}"
      else
        echo "- Waiting for the commit job: ${PENDING_JOBS:-}"
      fi
    fi
  } >> "$GITHUB_STEP_SUMMARY"
  exit 1
fi
