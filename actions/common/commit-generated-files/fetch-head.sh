#!/usr/bin/env bash
# Makes WORKSPACE a repository whose HEAD is HEAD_SHA, fetched from REPOSITORY on SERVER_URL, without
# checking anything out. commit-patch reads only git objects, so the pull request's files never
# have to be written to disk: nothing from them can be run or read as a file, and for a fork,
# actions/checkout's refusal to check out fork code in a workflow_run job is respected rather than
# overridden.
set -euo pipefail

if [[ ! "${HEAD_SHA}" =~ ^[0-9a-f]{40}$ ]]; then
  echo "::error::'${HEAD_SHA}' is not a commit SHA."
  exit 1
fi

git -C "${WORKSPACE}" init -q

# The job token, as actions/checkout sends it, so a private repository can be fetched too. It goes
# through the environment rather than the command line or a config file, and nothing persists it.
if [ -n "${GITHUB_TOKEN:-}" ]; then
  export GIT_CONFIG_COUNT=1
  export GIT_CONFIG_KEY_0="http.${SERVER_URL}/.extraheader"
  GIT_CONFIG_VALUE_0="AUTHORIZATION: basic $(printf 'x-access-token:%s' "${GITHUB_TOKEN}" | base64 -w0)"
  export GIT_CONFIG_VALUE_0
fi
git -C "${WORKSPACE}" fetch -q --depth=1 --no-tags "${SERVER_URL}/${REPOSITORY}.git" "${HEAD_SHA}"
git -C "${WORKSPACE}" update-ref --no-deref HEAD "${HEAD_SHA}"
