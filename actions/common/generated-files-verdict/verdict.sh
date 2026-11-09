#!/usr/bin/env bash
# Decides the Generated Files verdict and explains it.
#
# FAILED_JOBS and PENDING_JOBS come from the helper's evaluate mode, MERGED_HAS_CHANGES from the
# merged patch. HEAD_REPOSITORY and REPOSITORY tell a fork's pull request apart, and
# MAINTAINER_CAN_MODIFY whether it allows edits by maintainers. The commit job pushes to a fork only
# when it does; otherwise its contributor has to regenerate the files and push them instead of
# waiting for a commit that will not come.
set -euo pipefail

passed=true
# same: the commit job pushes to this repository's branch; fork: to a fork that allows edits by
# maintainers; manual: nothing pushes, the contributor has to.
target=same
if [ -n "${HEAD_REPOSITORY:-}" ] && [ "${HEAD_REPOSITORY}" != "${REPOSITORY:-}" ]; then
  if [ "${MAINTAINER_CAN_MODIFY:-}" = "true" ]; then
    target=fork
  else
    target=manual
  fi
fi

if [ -n "${FAILED_JOBS:-}" ]; then
  echo "::error::These generator jobs failed or were cancelled: ${FAILED_JOBS}."
  passed=false
fi
if [ "${MERGED_HAS_CHANGES:-}" = "true" ]; then
  case "${target}" in
    same) echo "::error::Generated files are out of date (${PENDING_JOBS:-}). The commit job adds them to this branch, and the run on that commit decides." ;;
    fork) echo "::error::Generated files are out of date (${PENDING_JOBS:-}). This fork allows edits by maintainers, so the commit job adds them to its branch where this repository commits to forks, and the run on that commit decides once a maintainer has approved it if GitHub asks. If no bot commit appears, regenerate the files locally, or apply this run's generated-files patch, and push." ;;
    manual) echo "::error::Generated files are out of date (${PENDING_JOBS:-}). This pull request comes from a fork that does not allow edits by maintainers, so the commit job cannot push to it: regenerate the files locally, or apply this run's generated-files patch, and push. Allowing edits by maintainers lets the commit job do this after later pushes." ;;
  esac
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
      case "${target}" in
        same) echo "- Waiting for the commit job: ${PENDING_JOBS:-}" ;;
        fork) echo "- Waiting for the commit job (fork allowing edits by maintainers): ${PENDING_JOBS:-}" ;;
        manual) echo "- Regenerate and push (fork not allowing edits by maintainers): ${PENDING_JOBS:-}" ;;
      esac
    fi
  } >> "$GITHUB_STEP_SUMMARY"
  exit 1
fi
