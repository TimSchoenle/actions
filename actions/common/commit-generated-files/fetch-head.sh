#!/usr/bin/env bash
# Makes WORKSPACE a repository whose HEAD is HEAD_SHA, fetched from REPOSITORY on SERVER_URL, without
# checking anything out. commit-patch reads only git objects, so a fork's commit never has to be
# written to disk: nothing from it can be run or read as a file, and actions/checkout's refusal to
# check out fork code in a workflow_run job is respected rather than overridden.
set -euo pipefail

if [[ ! "${HEAD_SHA}" =~ ^[0-9a-f]{40}$ ]]; then
  echo "::error::'${HEAD_SHA}' is not a commit SHA."
  exit 1
fi

git -C "${WORKSPACE}" init -q
git -C "${WORKSPACE}" fetch -q --depth=1 --no-tags "${SERVER_URL}/${REPOSITORY}.git" "${HEAD_SHA}"
git -C "${WORKSPACE}" update-ref --no-deref HEAD "${HEAD_SHA}"
