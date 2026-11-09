#!/usr/bin/env bash
# Decides whether a fork's pull request branch may be committed to. GitHub lets the App push there
# only while the pull request allows edits by maintainers, which a fork owned by an organization
# cannot, and the workflow_run event does not say whether it does, so the open pull requests are
# read instead.
#
# PULLS_FILE holds the JSON array GitHub returns for the open pull requests from HEAD_REPOSITORY's
# owner and HEAD_BRANCH, or is empty when that request failed. Writes `proceed=true` to
# GITHUB_OUTPUT when the matching pull request allows edits; otherwise `outcome=skipped` and
# `proceed=false`, with the reason in the step summary. A skip leaves the verdict red, and the
# verdict tells the contributor to regenerate the files and push.
set -euo pipefail

reason=''
if [ ! -s "${PULLS_FILE}" ]; then
  reason="the open pull requests of ${REPOSITORY} could not be read"
else
  allowed="$(jq -r --arg repo "${HEAD_REPOSITORY}" --arg branch "${HEAD_BRANCH}" '
    [ .[] | select(.head.repo.full_name == $repo and .head.ref == $branch) ]
    | if length == 0 then "none" else (any(.[]; .maintainer_can_modify == true) | tostring) end
  ' "${PULLS_FILE}" 2> /dev/null || echo invalid)"
  case "${allowed}" in
    true) ;;
    none) reason="no open pull request comes from ${HEAD_REPOSITORY}:${HEAD_BRANCH}" ;;
    false) reason="the pull request from ${HEAD_REPOSITORY} does not allow edits by maintainers" ;;
    *) reason="the open pull requests of ${REPOSITORY} could not be read" ;;
  esac
fi

if [ -n "${reason}" ]; then
  echo "Nothing to commit: ${reason}." | tee -a "${GITHUB_STEP_SUMMARY}"
  echo "outcome=skipped" >> "${GITHUB_OUTPUT}"
  echo "proceed=false" >> "${GITHUB_OUTPUT}"
else
  echo "proceed=true" >> "${GITHUB_OUTPUT}"
fi
