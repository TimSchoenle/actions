import { fileURLToPath } from 'node:url';

import { runAction } from 'actions-e2e';
import { describe, expect, it } from 'vitest';

import type { ActionInput, ActionOutput } from '../src/generated/action-io.js';
import type { ProvidedInputs } from 'actions-e2e';

/**
 * End-to-end cases for `actions/helper/verify-branch-name`, replacing the five matrix jobs of
 * `verify-action-helper-verify-branch-name.yaml` — 52 cases that previously cost 52 runner slots.
 *
 * This action reaches nothing but its own inputs, so the cases need no token and no scratch
 * repository.
 *
 * One job stays in the workflow: `verify-payload-fallback` asserts that the `${{ github.event.… }}`
 * defaults in `action.yaml` resolve from a real `pull_request` payload. Only the runner can
 * evaluate those, so no harness can stand in for it.
 */

const ACTION_DIRECTORY = fileURLToPath(new URL('..', import.meta.url));

interface Case {
  name: string;
  inputs: ProvidedInputs<ActionInput>;
  /** Whether the action is expected to exit non-zero, which `error_on_failure` controls. */
  fails?: boolean;
  /** The outputs asserted on. Only the ones a group cares about are listed. */
  outputs?: Partial<Record<ActionOutput, string>>;
}

async function verify({ inputs, fails, outputs }: Case): Promise<void> {
  const result = await runAction<ActionInput, ActionOutput>({
    actionDirectory: ACTION_DIRECTORY,
    inputs,
    expect: fails === true ? 'failure' : 'success',
  });

  if (outputs !== undefined) {
    expect(result.outputs).toMatchObject(outputs);
  }
}

/** Every pattern shape the action must match or reject, including POSIX classes. */
const PATTERN_CASES: Case[] = [
  {
    name: 'Feature branch with prefix pattern',
    inputs: {
      branch_pattern: '^feature/.*',
      head_ref: 'feature/add-new-feature',
      head_repo_full_name: 'owner/repo',
      base_repo_full_name: 'owner/repo',
      reject_forks: 'false',
      error_on_failure: 'false',
    },
    outputs: { verified: 'true', branch_pattern_verified: 'true', fork_verified: 'true' },
  },
  {
    name: 'Feature branch with escaped prefix pattern',
    inputs: {
      branch_pattern: '^feature\\/.*',
      head_ref: 'feature/add-new-feature',
      head_repo_full_name: 'owner/repo',
      base_repo_full_name: 'owner/repo',
      reject_forks: 'false',
      error_on_failure: 'false',
    },
    outputs: { verified: 'true', branch_pattern_verified: 'true', fork_verified: 'true' },
  },
  {
    name: 'Feature branch pattern mismatch',
    inputs: {
      branch_pattern: '^feature/.*',
      head_ref: 'bugfix/fix-something',
      head_repo_full_name: 'owner/repo',
      base_repo_full_name: 'owner/repo',
      reject_forks: 'false',
      error_on_failure: 'false',
    },
    outputs: { verified: 'false', branch_pattern_verified: 'false', fork_verified: 'true' },
  },
  {
    name: 'Bugfix branch with prefix pattern',
    inputs: {
      branch_pattern: '^(bugfix|hotfix)/.*',
      head_ref: 'bugfix/critical-fix',
      head_repo_full_name: 'owner/repo',
      base_repo_full_name: 'owner/repo',
      reject_forks: 'false',
      error_on_failure: 'false',
    },
    outputs: { verified: 'true', branch_pattern_verified: 'true', fork_verified: 'true' },
  },
  {
    name: 'Hotfix branch with prefix pattern',
    inputs: {
      branch_pattern: '^(bugfix|hotfix)/.*',
      head_ref: 'hotfix/urgent-fix',
      head_repo_full_name: 'owner/repo',
      base_repo_full_name: 'owner/repo',
      reject_forks: 'false',
      error_on_failure: 'false',
    },
    outputs: { verified: 'true', branch_pattern_verified: 'true', fork_verified: 'true' },
  },
  {
    name: 'Release-please branch pattern match',
    inputs: {
      branch_pattern: '^release-please--branches--.*$',
      head_ref: 'release-please--branches--main',
      head_repo_full_name: 'owner/repo',
      base_repo_full_name: 'owner/repo',
      reject_forks: 'false',
      error_on_failure: 'false',
    },
    outputs: { verified: 'true', branch_pattern_verified: 'true', fork_verified: 'true' },
  },
  {
    name: 'Release-please branch pattern mismatch',
    inputs: {
      branch_pattern: '^release-please--branches--.*$',
      head_ref: 'release-please-main',
      head_repo_full_name: 'owner/repo',
      base_repo_full_name: 'owner/repo',
      reject_forks: 'false',
      error_on_failure: 'false',
    },
    outputs: { verified: 'false', branch_pattern_verified: 'false', fork_verified: 'true' },
  },
  {
    name: 'Semantic version pattern v1.2.3',
    inputs: {
      branch_pattern: '^v[0-9]+\\.[0-9]+\\.[0-9]+$',
      head_ref: 'v1.2.3',
      head_repo_full_name: 'owner/repo',
      base_repo_full_name: 'owner/repo',
      reject_forks: 'false',
      error_on_failure: 'false',
    },
    outputs: { verified: 'true', branch_pattern_verified: 'true', fork_verified: 'true' },
  },
  {
    name: 'Semantic version pattern mismatch',
    inputs: {
      branch_pattern: '^v[0-9]+\\.[0-9]+\\.[0-9]+$',
      head_ref: 'v1.2',
      head_repo_full_name: 'owner/repo',
      base_repo_full_name: 'owner/repo',
      reject_forks: 'false',
      error_on_failure: 'false',
    },
    outputs: { verified: 'false', branch_pattern_verified: 'false', fork_verified: 'true' },
  },
  {
    name: 'Branch with underscores',
    inputs: {
      branch_pattern: '^feature/[a-z_-]+$',
      head_ref: 'feature/my_feature_name',
      head_repo_full_name: 'owner/repo',
      base_repo_full_name: 'owner/repo',
      reject_forks: 'false',
      error_on_failure: 'false',
    },
    outputs: { verified: 'true', branch_pattern_verified: 'true', fork_verified: 'true' },
  },
  {
    name: 'Branch with dashes',
    inputs: {
      branch_pattern: '^feature/[a-z_-]+$',
      head_ref: 'feature/my-feature-name',
      head_repo_full_name: 'owner/repo',
      base_repo_full_name: 'owner/repo',
      reject_forks: 'false',
      error_on_failure: 'false',
    },
    outputs: { verified: 'true', branch_pattern_verified: 'true', fork_verified: 'true' },
  },
  {
    name: 'Branch with numbers',
    inputs: {
      branch_pattern: '^feature/[a-z0-9-]+$',
      head_ref: 'feature/issue-123',
      head_repo_full_name: 'owner/repo',
      base_repo_full_name: 'owner/repo',
      reject_forks: 'false',
      error_on_failure: 'false',
    },
    outputs: { verified: 'true', branch_pattern_verified: 'true', fork_verified: 'true' },
  },
  {
    name: 'Branch with issue number pattern',
    inputs: {
      branch_pattern: '^(feature|bugfix)/issue-[0-9]+$',
      head_ref: 'feature/issue-456',
      head_repo_full_name: 'owner/repo',
      base_repo_full_name: 'owner/repo',
      reject_forks: 'false',
      error_on_failure: 'false',
    },
    outputs: { verified: 'true', branch_pattern_verified: 'true', fork_verified: 'true' },
  },
  {
    name: 'Case sensitive match (lowercase)',
    inputs: {
      branch_pattern: '^feature/.*',
      head_ref: 'feature/test',
      head_repo_full_name: 'owner/repo',
      base_repo_full_name: 'owner/repo',
      reject_forks: 'false',
      error_on_failure: 'false',
    },
    outputs: { verified: 'true', branch_pattern_verified: 'true', fork_verified: 'true' },
  },
  {
    name: 'Case sensitive mismatch (uppercase)',
    inputs: {
      branch_pattern: '^feature/.*',
      head_ref: 'Feature/test',
      head_repo_full_name: 'owner/repo',
      base_repo_full_name: 'owner/repo',
      reject_forks: 'false',
      error_on_failure: 'false',
    },
    outputs: { verified: 'false', branch_pattern_verified: 'false', fork_verified: 'true' },
  },
  {
    name: 'Multiple alternatives with slashes',
    inputs: {
      branch_pattern: '^(feature|bugfix|hotfix|chore)/.*',
      head_ref: 'chore/update-deps',
      head_repo_full_name: 'owner/repo',
      base_repo_full_name: 'owner/repo',
      reject_forks: 'false',
      error_on_failure: 'false',
    },
    outputs: { verified: 'true', branch_pattern_verified: 'true', fork_verified: 'true' },
  },
  {
    name: 'Pattern with dots and slashes',
    inputs: {
      branch_pattern: '^release/v[0-9]+\\.[0-9]+\\.[0-9]+$',
      head_ref: 'release/v2.5.1',
      head_repo_full_name: 'owner/repo',
      base_repo_full_name: 'owner/repo',
      reject_forks: 'false',
      error_on_failure: 'false',
    },
    outputs: { verified: 'true', branch_pattern_verified: 'true', fork_verified: 'true' },
  },
  {
    name: 'Pattern with optional suffix',
    inputs: {
      branch_pattern: '^main(-[a-z]+)?$',
      head_ref: 'main-staging',
      head_repo_full_name: 'owner/repo',
      base_repo_full_name: 'owner/repo',
      reject_forks: 'false',
      error_on_failure: 'false',
    },
    outputs: { verified: 'true', branch_pattern_verified: 'true', fork_verified: 'true' },
  },
  {
    name: 'Pattern matching main without suffix',
    inputs: {
      branch_pattern: '^main(-[a-z]+)?$',
      head_ref: 'main',
      head_repo_full_name: 'owner/repo',
      base_repo_full_name: 'owner/repo',
      reject_forks: 'false',
      error_on_failure: 'false',
    },
    outputs: { verified: 'true', branch_pattern_verified: 'true', fork_verified: 'true' },
  },
  {
    name: 'No pattern provided (auto-pass)',
    inputs: {
      branch_pattern: '',
      head_ref: 'any-branch-name',
      head_repo_full_name: 'owner/repo',
      base_repo_full_name: 'owner/repo',
      reject_forks: 'false',
      error_on_failure: 'false',
    },
    outputs: { verified: 'true', branch_pattern_verified: 'true', fork_verified: 'true' },
  },
  {
    name: 'Branch with forward slashes',
    inputs: {
      branch_pattern: '^users/[a-z]+/feature/.*',
      head_ref: 'users/john/feature/new-thing',
      head_repo_full_name: 'owner/repo',
      base_repo_full_name: 'owner/repo',
      reject_forks: 'false',
      error_on_failure: 'false',
    },
    outputs: { verified: 'true', branch_pattern_verified: 'true', fork_verified: 'true' },
  },
  {
    name: 'Exact branch name match',
    inputs: {
      branch_pattern: '^main$',
      head_ref: 'main',
      head_repo_full_name: 'owner/repo',
      base_repo_full_name: 'owner/repo',
      reject_forks: 'false',
      error_on_failure: 'false',
    },
    outputs: { verified: 'true', branch_pattern_verified: 'true', fork_verified: 'true' },
  },
  {
    name: 'Exact branch name mismatch',
    inputs: {
      branch_pattern: '^main$',
      head_ref: 'main-dev',
      head_repo_full_name: 'owner/repo',
      base_repo_full_name: 'owner/repo',
      reject_forks: 'false',
      error_on_failure: 'false',
    },
    outputs: { verified: 'false', branch_pattern_verified: 'false', fork_verified: 'true' },
  },
  {
    name: 'POSIX character class match',
    inputs: {
      branch_pattern: '^release/[[:digit:]]+$',
      head_ref: 'release/42',
      head_repo_full_name: 'owner/repo',
      base_repo_full_name: 'owner/repo',
      reject_forks: 'false',
      error_on_failure: 'false',
    },
    outputs: { verified: 'true', branch_pattern_verified: 'true', fork_verified: 'true' },
  },
  {
    name: 'POSIX character class mismatch',
    inputs: {
      branch_pattern: '^release/[[:digit:]]+$',
      head_ref: 'release/candidate',
      head_repo_full_name: 'owner/repo',
      base_repo_full_name: 'owner/repo',
      reject_forks: 'false',
      error_on_failure: 'false',
    },
    outputs: { verified: 'false', branch_pattern_verified: 'false', fork_verified: 'true' },
  },
  {
    name: 'Mixed POSIX and literal character classes',
    inputs: {
      branch_pattern: '^[[:alpha:]]+/[[:alnum:]_-]+$',
      head_ref: 'feature/issue_42-fix',
      head_repo_full_name: 'owner/repo',
      base_repo_full_name: 'owner/repo',
      reject_forks: 'false',
      error_on_failure: 'false',
    },
    outputs: { verified: 'true', branch_pattern_verified: 'true', fork_verified: 'true' },
  },
];

describe('verify-branch-name: branch patterns', () => {
  it.each(PATTERN_CASES)('$name', verify);
});

/** Head and base repository comparison, which is exact and case-sensitive. */
const FORK_CASES: Case[] = [
  {
    name: 'Same repo with reject_forks=true',
    inputs: {
      branch_pattern: '.*',
      head_ref: 'test-branch',
      head_repo_full_name: 'owner/repo',
      base_repo_full_name: 'owner/repo',
      reject_forks: 'true',
      error_on_failure: 'false',
    },
    outputs: { verified: 'true', fork_verified: 'true' },
  },
  {
    name: 'Fork with reject_forks=true',
    inputs: {
      branch_pattern: '.*',
      head_ref: 'test-branch',
      head_repo_full_name: 'forker/repo',
      base_repo_full_name: 'owner/repo',
      reject_forks: 'true',
      error_on_failure: 'false',
    },
    outputs: { verified: 'false', fork_verified: 'false' },
  },
  {
    name: 'Same repo with reject_forks=false',
    inputs: {
      branch_pattern: '.*',
      head_ref: 'test-branch',
      head_repo_full_name: 'owner/repo',
      base_repo_full_name: 'owner/repo',
      reject_forks: 'false',
      error_on_failure: 'false',
    },
    outputs: { verified: 'true', fork_verified: 'true' },
  },
  {
    name: 'Fork with reject_forks=false',
    inputs: {
      branch_pattern: '.*',
      head_ref: 'test-branch',
      head_repo_full_name: 'forker/repo',
      base_repo_full_name: 'owner/repo',
      reject_forks: 'false',
      error_on_failure: 'false',
    },
    outputs: { verified: 'true', fork_verified: 'true' },
  },
  {
    name: 'Repos with similar names (same owner)',
    inputs: {
      branch_pattern: '.*',
      head_ref: 'test-branch',
      head_repo_full_name: 'owner/repo-fork',
      base_repo_full_name: 'owner/repo',
      reject_forks: 'true',
      error_on_failure: 'false',
    },
    outputs: { verified: 'false', fork_verified: 'false' },
  },
  {
    name: 'Repos with similar names (different owner)',
    inputs: {
      branch_pattern: '.*',
      head_ref: 'test-branch',
      head_repo_full_name: 'owner2/repo',
      base_repo_full_name: 'owner/repo',
      reject_forks: 'true',
      error_on_failure: 'false',
    },
    outputs: { verified: 'false', fork_verified: 'false' },
  },
  {
    name: 'Case sensitive repo names',
    inputs: {
      branch_pattern: '.*',
      head_ref: 'test-branch',
      head_repo_full_name: 'Owner/Repo',
      base_repo_full_name: 'owner/repo',
      reject_forks: 'true',
      error_on_failure: 'false',
    },
    outputs: { verified: 'false', fork_verified: 'false' },
  },
];

describe('verify-branch-name: fork detection', () => {
  it.each(FORK_CASES)('$name', verify);
});

/** Whether a failed verification exits non-zero, which `error_on_failure` decides. */
const ERROR_CASES: Case[] = [
  {
    name: 'error_on_failure=false with all passing',
    inputs: {
      branch_pattern: '^feature/.*',
      head_ref: 'feature/test',
      head_repo_full_name: 'owner/repo',
      base_repo_full_name: 'owner/repo',
      reject_forks: 'false',
      error_on_failure: 'false',
    },
    outputs: { verified: 'true' },
  },
  {
    name: 'error_on_failure=false with branch mismatch',
    inputs: {
      branch_pattern: '^feature/.*',
      head_ref: 'bugfix/test',
      head_repo_full_name: 'owner/repo',
      base_repo_full_name: 'owner/repo',
      reject_forks: 'false',
      error_on_failure: 'false',
    },
    outputs: { verified: 'false' },
  },
  {
    name: 'error_on_failure=false with fork rejection',
    inputs: {
      branch_pattern: '^feature/.*',
      head_ref: 'feature/test',
      head_repo_full_name: 'forker/repo',
      base_repo_full_name: 'owner/repo',
      reject_forks: 'true',
      error_on_failure: 'false',
    },
    outputs: { verified: 'false' },
  },
  {
    name: 'error_on_failure=true with all passing',
    inputs: {
      branch_pattern: '^feature/.*',
      head_ref: 'feature/test',
      head_repo_full_name: 'owner/repo',
      base_repo_full_name: 'owner/repo',
      reject_forks: 'false',
      error_on_failure: 'true',
    },
    outputs: { verified: 'true' },
  },
  {
    name: 'error_on_failure=true with failure (should exit 1)',
    inputs: {
      branch_pattern: '^feature/.*',
      head_ref: 'bugfix/test',
      head_repo_full_name: 'owner/repo',
      base_repo_full_name: 'owner/repo',
      reject_forks: 'false',
      error_on_failure: 'true',
    },
    fails: true,
    outputs: { verified: 'false' },
  },
];

describe('verify-branch-name: error handling', () => {
  it.each(ERROR_CASES)('$name', verify);
});

/** The four ways branch and fork verification can agree or disagree. */
const COMBINED_CASES: Case[] = [
  {
    name: 'Both pass: pattern match + same repo',
    inputs: {
      branch_pattern: '^feature/.*',
      head_ref: 'feature/test',
      head_repo_full_name: 'owner/repo',
      base_repo_full_name: 'owner/repo',
      reject_forks: 'true',
      error_on_failure: 'false',
    },
    outputs: { verified: 'true', branch_pattern_verified: 'true', fork_verified: 'true' },
  },
  {
    name: 'Branch fail + fork pass',
    inputs: {
      branch_pattern: '^feature/.*',
      head_ref: 'bugfix/test',
      head_repo_full_name: 'owner/repo',
      base_repo_full_name: 'owner/repo',
      reject_forks: 'false',
      error_on_failure: 'false',
    },
    outputs: { verified: 'false', branch_pattern_verified: 'false', fork_verified: 'true' },
  },
  {
    name: 'Branch pass + fork fail',
    inputs: {
      branch_pattern: '^feature/.*',
      head_ref: 'feature/test',
      head_repo_full_name: 'forker/repo',
      base_repo_full_name: 'owner/repo',
      reject_forks: 'true',
      error_on_failure: 'false',
    },
    outputs: { verified: 'false', branch_pattern_verified: 'true', fork_verified: 'false' },
  },
  {
    name: 'Both fail: pattern mismatch + fork',
    inputs: {
      branch_pattern: '^feature/.*',
      head_ref: 'bugfix/test',
      head_repo_full_name: 'forker/repo',
      base_repo_full_name: 'owner/repo',
      reject_forks: 'true',
      error_on_failure: 'false',
    },
    outputs: { verified: 'false', branch_pattern_verified: 'false', fork_verified: 'false' },
  },
  {
    name: 'No pattern + same repo (both auto-pass)',
    inputs: {
      branch_pattern: '',
      head_ref: 'any-branch',
      head_repo_full_name: 'owner/repo',
      base_repo_full_name: 'owner/repo',
      reject_forks: 'false',
      error_on_failure: 'false',
    },
    outputs: { verified: 'true', branch_pattern_verified: 'true', fork_verified: 'true' },
  },
  {
    name: 'No pattern + fork allowed',
    inputs: {
      branch_pattern: '',
      head_ref: 'any-branch',
      head_repo_full_name: 'forker/repo',
      base_repo_full_name: 'owner/repo',
      reject_forks: 'false',
      error_on_failure: 'false',
    },
    outputs: { verified: 'true', branch_pattern_verified: 'true', fork_verified: 'true' },
  },
  {
    name: 'No pattern + fork rejected',
    inputs: {
      branch_pattern: '',
      head_ref: 'any-branch',
      head_repo_full_name: 'forker/repo',
      base_repo_full_name: 'owner/repo',
      reject_forks: 'true',
      error_on_failure: 'false',
    },
    outputs: { verified: 'false', branch_pattern_verified: 'true', fork_verified: 'false' },
  },
];

describe('verify-branch-name: combined scenarios', () => {
  it.each(COMBINED_CASES)('$name', verify);
});

/** Inputs the action must reject outright rather than treat as a failed check. */
const VALIDATION_CASES: Case[] = [
  {
    name: 'Invalid reject_forks value',
    inputs: {
      branch_pattern: '.*',
      head_ref: 'test',
      head_repo_full_name: 'owner/repo',
      base_repo_full_name: 'owner/repo',
      reject_forks: 'invalid',
      error_on_failure: 'false',
    },
    fails: true,
  },
  {
    name: 'Invalid regex pattern',
    inputs: {
      branch_pattern: '^feature/(',
      head_ref: 'feature/test',
      head_repo_full_name: 'owner/repo',
      base_repo_full_name: 'owner/repo',
      reject_forks: 'true',
      error_on_failure: 'false',
    },
    fails: true,
  },
  {
    name: 'Catastrophically backtracking pattern',
    inputs: {
      branch_pattern: '^(a+)+$',
      head_ref: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa!',
      head_repo_full_name: 'owner/repo',
      base_repo_full_name: 'owner/repo',
      reject_forks: 'true',
      error_on_failure: 'false',
    },
    fails: true,
  },
  {
    name: 'Invalid error_on_failure value',
    inputs: {
      branch_pattern: '.*',
      head_ref: 'test',
      head_repo_full_name: 'owner/repo',
      base_repo_full_name: 'owner/repo',
      reject_forks: 'true',
      error_on_failure: 'invalid',
    },
    fails: true,
  },
  {
    name: 'Valid reject_forks=true',
    inputs: {
      branch_pattern: '.*',
      head_ref: 'test',
      head_repo_full_name: 'owner/repo',
      base_repo_full_name: 'owner/repo',
      reject_forks: 'true',
      error_on_failure: 'false',
    },
  },
  {
    name: 'Valid reject_forks=false',
    inputs: {
      branch_pattern: '.*',
      head_ref: 'test',
      head_repo_full_name: 'owner/repo',
      base_repo_full_name: 'owner/repo',
      reject_forks: 'false',
      error_on_failure: 'false',
    },
  },
  {
    name: 'Valid error_on_failure=true',
    inputs: {
      branch_pattern: '.*',
      head_ref: 'test',
      head_repo_full_name: 'owner/repo',
      base_repo_full_name: 'owner/repo',
      reject_forks: 'false',
      error_on_failure: 'true',
    },
  },
];

describe('verify-branch-name: input validation', () => {
  it.each(VALIDATION_CASES)('$name', verify);
});
