#!/usr/bin/env bash
# Prints, as one JSON array, every open pull request of REPOSITORY that comes from HEAD_REPOSITORY's
# HEAD_BRANCH, each read in full: the list endpoint leaves out `maintainer_can_modify`, which
# check-fork.sh decides on. Exits non-zero when any request fails.
set -euo pipefail

list="$(gh api -X GET "repos/${REPOSITORY}/pulls" -f state=open -f head="${HEAD_REPOSITORY%%/*}:${HEAD_BRANCH}" -f per_page=100)"
numbers="$(jq -r --arg repo "${HEAD_REPOSITORY}" --arg branch "${HEAD_BRANCH}" \
  '.[] | select(.head.repo.full_name == $repo and .head.ref == $branch) | .number' <<< "${list}")"

for number in ${numbers}; do
  gh api "repos/${REPOSITORY}/pulls/${number}"
done | jq -s '.'
