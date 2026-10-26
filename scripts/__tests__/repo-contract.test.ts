import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import {
  collectRunBlocks,
  effectiveCommands,
  findStrictShellViolations,
  requiresStrictShell,
  STRICT_SHELL_PREAMBLE,
  type RunBlock,
} from '../lib/workflow-contract.js';

// Repo-wide contracts checked against the real files on disk. Without `set -euo pipefail`, a failing
// `gh api` or `grep` in the middle of a `run:` block is swallowed and the step still exits green, so
// a broken verification reports success. This suite makes that a build failure instead.

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const WORKFLOWS_DIR = path.join(REPO_ROOT, '.github', 'workflows');

function readWorkflow(file: string): string {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- files enumerated from a fixed directory
  return fs.readFileSync(path.join(WORKFLOWS_DIR, file), 'utf8');
}

// Sorted explicitly: readdir order differs between Windows and Linux, and an unsorted `describe.each`
// would report the same failures in a different order on each platform.
const workflowFiles = fs
  .readdirSync(WORKFLOWS_DIR)
  .filter((file) => /\.ya?ml$/.test(file))
  .sort();

interface StrictShellExemption {
  /** Offending blocks in the file when it was exempted. */
  known: number;
  reason: string;
}

/**
 * Workflows that pre-date this contract.
 *
 * THIS LIST MUST ONLY EVER SHRINK. `known` is a ratchet, not a quota: a *new* offending block in an
 * exempt file still fails the suite, and a file whose offenders have all been fixed fails as a stale
 * entry until its line is deleted. Never raise a number and never add a key for new work.
 */
const STRICT_SHELL_EXEMPTIONS: Readonly<Record<string, StrictShellExemption>> = {
  'release-please.yml': { known: 3, reason: 'Release plumbing; pre-dates the contract.' },
  'security.yml': { known: 1, reason: 'Security scanning; pre-dates the contract.' },
  'verify-action-common-create-pull-request.yaml': {
    known: 7,
    reason: 'Shell assertions awaiting the TypeScript e2e port.',
  },
  'verify-action-common-render-template-and-commit.yaml': {
    known: 4,
    reason: 'Shell assertions awaiting the TypeScript e2e port.',
  },
  'verify-action-helper-verify-branch-name.yaml': {
    known: 1,
    reason: 'Shell assertions awaiting the TypeScript e2e port.',
  },
  'verify-action-java-gradle-setup-base-environment.yaml': {
    known: 5,
    reason: 'Shell assertions awaiting the TypeScript e2e port.',
  },
  'verify-action-test-setup-e2e.yaml': { known: 4, reason: 'Shell assertions awaiting the TypeScript e2e port.' },
};

function describeViolation(block: RunBlock): string {
  return `${block.location} (${block.name ?? 'unnamed step'})`;
}

describe('strict shell contract', () => {
  it('discovers the workflows', () => {
    expect(workflowFiles.length).toBeGreaterThan(0);
  });

  describe.each(workflowFiles)('%s', (file) => {
    it(`every multi-command run block opens with '${STRICT_SHELL_PREAMBLE}'`, () => {
      const allowance = STRICT_SHELL_EXEMPTIONS[file]?.known ?? 0;
      const offenders = findStrictShellViolations(readWorkflow(file)).map(describeViolation);

      expect(offenders.length, `offending run blocks:\n${offenders.join('\n')}`).toBeLessThanOrEqual(allowance);
    });
  });

  describe.each(Object.keys(STRICT_SHELL_EXEMPTIONS))('exemption for %s', (file) => {
    it('names a workflow that still exists', () => {
      expect(workflowFiles).toContain(file);
    });

    it('is still earned, and must be deleted once it is not', () => {
      expect(findStrictShellViolations(readWorkflow(file)).length).toBeGreaterThan(0);
    });
  });
});

describe('strict shell contract rules', () => {
  const workflowWith = (step: string) => `name: t\njobs:\n  j:\n    steps:\n${step}`;

  it('exempts a single-command block, whose exit code is already the step exit code', () => {
    expect(requiresStrictShell('bun run lint\n')).toBe(false);
    expect(findStrictShellViolations(workflowWith('      - run: exit 1\n'))).toEqual([]);
  });

  it('flags a multi-command block that omits the preamble', () => {
    const violations = findStrictShellViolations(
      workflowWith('      - name: Check\n        run: |\n          a\n          b\n'),
    );

    expect(violations.map(describeViolation)).toEqual(['jobs.j.steps[0] (Check)']);
  });

  it('accepts the preamble behind blank lines and comments', () => {
    expect(
      findStrictShellViolations(
        workflowWith('      - run: |\n          # why\n\n          set -euo pipefail\n          a\n'),
      ),
    ).toEqual([]);
  });

  it('treats a backslash-continued command as one command', () => {
    expect(effectiveCommands('gh api foo \\\n  --jq .bar\n')).toEqual(['gh api foo --jq .bar']);
  });

  it('collapses a folded scalar to one command', () => {
    expect(requiresStrictShell('curl -sSL https://example.test | bash -s -- --flag value\n')).toBe(false);
  });

  it('ignores steps whose shell cannot express the preamble', () => {
    expect(collectRunBlocks(workflowWith('      - run: |\n          a\n          b\n        shell: pwsh\n'))).toEqual(
      [],
    );
  });

  it('honours a job-level default shell', () => {
    const workflow = `name: t\njobs:\n  j:\n    defaults:\n      run:\n        shell: python\n    steps:\n      - run: |\n          a\n          b\n`;

    expect(collectRunBlocks(workflow)).toEqual([]);
  });
});

// A job that can mint an OIDC token can authenticate as this repository to whatever trusts that token
// (Codecov today). On a pull request, any repository code a job runs is code the pull request wrote,
// so such a job must only run third-party actions pinned by the workflow and shell steps that invoke
// no project tooling. Test suites and builds belong in a job without the permission, which hands its
// output over as an artifact.
describe('OIDC isolation contract', () => {
  type Permissions = Record<string, string> | string | undefined;

  interface Step {
    name?: string;
    run?: string;
    uses?: string;
  }

  interface Job {
    permissions?: Permissions;
    steps?: Step[];
  }

  /**
   * Whether a job's token can mint an OIDC token. A job's own `permissions` replace the workflow's
   * entirely, so the workflow-level block only applies to a job that has none. `write-all` grants
   * `id-token: write` with everything else; `read-all` and an absent block (the repository default)
   * never include it.
   */
  function grantsIdToken(jobPermissions: Permissions, workflowPermissions: Permissions): boolean {
    const effective = jobPermissions ?? workflowPermissions;
    if (typeof effective === 'string') {
      return effective === 'write-all';
    }
    return effective?.['id-token'] === 'write';
  }

  /**
   * The only shell lines an OIDC job may run: strict mode, an exit, and an `echo` of literal text with
   * `${NAME}` expansions. An allow-list rather than a list of forbidden tools, because there is no
   * complete list of ways to run code from a checkout (`source`, `.`, an interpreter, a script path,
   * a command substitution inside an otherwise harmless line). Each alternative of the echo pattern
   * starts on a different character, so it cannot backtrack.
   */
  const APPROVED_RUN_LINES = [
    /^set -euo pipefail$/,
    /^exit \d+$/,
    /^echo "(?:[^"$`\\]|\$\{[A-Za-z_][A-Za-z0-9_]*\})*"$/,
  ];

  function isApprovedRunStep(run: string): boolean {
    return run
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '' && !line.startsWith('#'))
      .every((line) => APPROVED_RUN_LINES.some((pattern) => pattern.test(line)));
  }

  function oidcJobs(file: string): [string, Job][] {
    const doc = parse(readWorkflow(file)) as { permissions?: Permissions; jobs?: Record<string, Job> } | null;
    return Object.entries(doc?.jobs ?? {}).filter(([, job]) => grantsIdToken(job.permissions, doc?.permissions));
  }

  it('finds the Codecov upload job, so the scan below is not vacuous', () => {
    expect(oidcJobs('scripts-ci.yml').map(([id]) => id)).toEqual(['coverage']);
  });

  describe.each(workflowFiles)('%s', (file) => {
    it('runs no repository code in a job that holds id-token: write', () => {
      for (const [id, job] of oidcJobs(file)) {
        for (const [index, step] of (job.steps ?? []).entries()) {
          const where = `jobs.${id}.steps[${index}] (${step.name ?? 'unnamed step'})`;

          expect(step.uses?.startsWith('./') ?? false, `${where} runs a local action`).toBe(false);
          expect(step.uses ?? '', `${where} installs a toolchain`).not.toMatch(/setup-(?:bun|node|python|java)/);
          expect(isApprovedRunStep(step.run ?? ''), `${where} runs a shell line outside the allow-list`).toBe(true);
        }
      }
    });
  });

  describe('effective permissions', () => {
    it.each([
      ['a job-level grant', { 'id-token': 'write' }, undefined, true],
      ['a workflow-level grant the job inherits', undefined, { 'id-token': 'write' }, true],
      ['write-all on the job', 'write-all', undefined, true],
      ['write-all on the workflow, inherited', undefined, 'write-all', true],
      ['a job block that replaces a workflow grant', { contents: 'read' }, { 'id-token': 'write' }, false],
      ['an empty job block that replaces write-all', {}, 'write-all', false],
      ['read-all', 'read-all', undefined, false],
      ['the repository default', undefined, undefined, false],
    ] as const)('treats %s correctly', (_case, job, workflow, expected) => {
      expect(grantsIdToken(job, workflow)).toBe(expected);
    });
  });

  describe('run step allow-list', () => {
    it.each([
      'set -euo pipefail\necho "::error::Coverage Tests finished as \'${TESTS_RESULT}\'."\nexit 1',
      '# comment only\n\nexit 0',
    ])('accepts %j', (run) => {
      expect(isApprovedRunStep(run)).toBe(true);
    });

    it.each([
      'set -euo pipefail\nbun run test',
      './scripts/upload.sh',
      'source scripts/upload.sh',
      '. scripts/upload.sh',
      'bash scripts/upload.sh',
      'echo "$(./scripts/upload.sh)"',
      'echo "`./scripts/upload.sh`"',
      'echo "ok" && ./scripts/upload.sh',
      'echo "$GITHUB_TOKEN"',
    ])('rejects %j', (run) => {
      expect(isApprovedRunStep(run)).toBe(false);
    });
  });
});
