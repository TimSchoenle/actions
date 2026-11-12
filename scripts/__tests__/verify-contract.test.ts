import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import { DOCS_FILE_NAME, validateDocsFile } from '../lib/action-docs/docs-file.js';
import { parseActionManifest } from '../lib/action-docs/manifest.js';
import { ROOT_DIR, scanSorted } from '../lib/utils.js';
import { selectTargets } from '../lib/verify/affected.js';
import { findDrift, generate } from '../lib/verify/generate.js';
import {
  actionTokenPermissions,
  E2E_ALLOWED_ENDPOINTS,
  e2eJobId,
  INSTALL_ALLOWED_ENDPOINTS,
  missingTokenInputScopes,
  workspaceMemberDirectories,
  workspaceModulePaths,
} from '../lib/verify/jobs.js';
import { shardFile, SUMMARY_JOB_NAME, VERIFY_WORKFLOW } from '../lib/verify/render.js';
import { jobValue, readSources } from '../lib/verify/source.js';
import { E2E_DIRECTORY, hasE2eCases } from '../lib/verify/target-inputs.js';

import type { PlanEvent } from '../lib/verify/affected.js';
import type { ActionDocs } from '../lib/action-docs/docs-file.js';

/**
 * Contract between the actions, their Verify sources and the generated Verify workflows.
 *
 * Every action reaches CI through a target of `.github/workflows/verify.yaml`, generated from the
 * sources in `.github/verify/`. What can go wrong silently is checked here: an action without cases,
 * a source and an action's cases that disagree, a generated file edited by hand, a token wider than it
 * should be, and a generated workflow growing toward a limit GitHub enforces by refusing to run it.
 */

/**
 * GitHub refuses to start a run whose caller reaches more than 50 distinct reusable workflows, and
 * one whose workflow file is larger than 500 KB. The budgets leave room to notice before either.
 */
const MAX_SHARDS = 45;
const MAX_WORKFLOW_BYTES = 450_000;

/**
 * Actions with no end-to-end cases, each with the reason.
 *
 * This list may only ever shrink. A composite action cannot be driven by the harness — only the
 * runner can invoke one — so those keep hand-written workflows; anything else in this list is a gap.
 */
const E2E_EXEMPTIONS: Record<string, string> = {
  'actions/bun/setup-cached': 'composite: wraps setup-bun and actions/cache, which only the runner can run',
  'actions/common/create-pull-request': 'composite: orchestrates create-branch, commit-changes and the PR call',
  'actions/common/render-template-and-commit': 'composite: orchestrates render-template and commit-changes',
  'actions/java-gradle/auto-spotless': 'composite: sets up Java and Gradle, runs spotless, then create-patch',
  'actions/java-gradle/coverage-codecov': 'composite: checks out, sets up Java and Gradle, then uploads to Codecov',
  'actions/java-gradle/setup-base-environment': 'composite: sets up Java, Gradle and their caches',
  'actions/rust/auto-format': 'composite: sets up rustfmt, runs cargo fmt, then create-patch',
  'actions/rust/cargo-check': 'composite: checks out inputs.repository as its own first step',
  'actions/rust/clippy': 'composite: checks out inputs.repository as its own first step',
  'actions/rust/coverage-codecov': 'composite: checks out, measures with cargo-llvm-cov, then uploads to Codecov',
  'actions/rust/test': 'composite: checks out inputs.repository as its own first step',
  'actions/test/setup-e2e': 'composite: the harness for the workflows that still need one',
};

/**
 * Suites whose token deliberately lacks a scope `docs.yaml` lists on a token input, each with why.
 *
 * Without an entry here, a token narrower than the action's documented needs reads as drift. With
 * one, the narrowing is a decision someone wrote down. `missing` lists the exact entries the reason
 * covers, so a gap added later is not waved through by a reason written for a different one.
 */
const NARROWER_TOKEN_SUITES: Record<string, { missing: string[]; reason: string }> = {
  'actions/maintenance/auto-approve-pr': {
    missing: ['contents: read (input token)'],
    reason:
      'docs.yaml needs it only on a private repository; the scratch repository is public, and the reviewing identity is kept to pull-requests: write',
  },
  'actions/maintenance/ensure-actions-are-executed': {
    missing: ['actions: read (input token)'],
    reason:
      'only the jobs fallback reads actions, and it needs GITHUB_RUN_ID, which the harness does not pass, so every case reads check runs alone',
  },
  'actions/release/install-built-actions': {
    missing: ['actions: read (input github-token)'],
    reason:
      'the cases drive the helper over a staged directory; the artifact record lookup runs in the Install And Refuse extra job, with the job token and actions: read',
  },
  'actions/release/publish-build-commit': {
    missing: [
      'actions: read (input github-token)',
      'pull-requests: write (input token)',
      'issues: write (input token)',
    ],
    reason:
      'the cases drive the helper in publish mode over a staged directory, without an artifact record or a pull request; the Dry Run Through The Runner extra job reads the artifact with actions: read',
  },
  'actions/maintenance/wipe-cache': {
    missing: ['actions: read (input token)', 'actions: write (input token)'],
    reason: 'every case stops before the cache API, so the suite runs on metadata: read and never deletes a cache',
  },
};

/** Parses a YAML file, naming it in the error a syntax mistake would otherwise throw anonymously. */
function parseYamlFile(file: string): unknown {
  try {
    return parse(fs.readFileSync(path.join(ROOT_DIR, file), 'utf8'));
  } catch (error) {
    throw new Error(`${file}: not valid YAML: ${(error as Error).message}`, { cause: error });
  }
}

/** Reads and validates an action's `docs.yaml`, or `undefined` when it has none. */
function docsOf(actionPath: string): ActionDocs | undefined {
  const file = `${actionPath}/${DOCS_FILE_NAME}`;
  if (!fs.existsSync(path.join(ROOT_DIR, file))) {
    return undefined;
  }
  const manifest = parseActionManifest(
    fs.readFileSync(path.join(ROOT_DIR, actionPath, 'action.yaml'), 'utf8'),
    `${actionPath}/action.yaml`,
  );
  const result = validateDocsFile(parseYamlFile(file), {
    file,
    inputNames: new Set(manifest.inputs.map((input) => input.name)),
  });
  if (!result.ok) {
    throw new Error(result.problems.join('\n'));
  }

  return result.docs;
}

/**
 * Sources whose jobs run harden-runner in audit mode, with how many such steps each has. They moved
 * from hand-written workflows that already audited. THIS LIST MAY ONLY SHRINK: lower a count when a
 * job starts blocking, and delete the entry at zero.
 */
const AUDITING_SOURCES: Readonly<Record<string, number>> = {
  '.github/verify/bun-setup-cached.yaml': 3,
  '.github/verify/common-create-pull-request.yaml': 4,
  '.github/verify/common-render-template-and-commit.yaml': 4,
  '.github/verify/configs-checkstyle.yaml': 1,
  '.github/verify/configs-renovate.yaml': 1,
  '.github/verify/helm-update-chart-version.yaml': 7,
  '.github/verify/java-gradle-auto-spotless.yaml': 1,
  '.github/verify/java-gradle-coverage-codecov.yaml': 4,
  '.github/verify/java-gradle-setup-base-environment.yaml': 1,
  '.github/verify/rust-auto-format.yaml': 1,
  '.github/verify/rust-coverage-codecov.yaml': 3,
  '.github/verify/terrace-helm-sync.yaml': 1,
  '.github/verify/test-setup-e2e.yaml': 1,
};

const SOURCES = readSources(ROOT_DIR);

/** How many steps of a source's jobs set harden-runner's `egress-policy` to `audit`, read as parsed YAML. */
function auditSteps(source: (typeof SOURCES)[number]): number {
  return source.jobIds
    .flatMap((id) => {
      const steps = jobValue(source, id)['steps'];
      return Array.isArray(steps) ? (steps as { with?: Record<string, unknown> }[]) : [];
    })
    .filter((step) => step.with?.['egress-policy'] === 'audit').length;
}
const GENERATED = generate(ROOT_DIR);

/** Each action's token-input scopes from `docs.yaml` that its end-to-end token lacks. */
function tokenScopeGaps(): Record<string, string[]> {
  const gaps: Record<string, string[]> = {};

  for (const source of SOURCES.filter((candidate) => candidate.e2e !== undefined)) {
    const actionPath = `actions/${source.target}`;
    const docs = docsOf(actionPath);
    const missing = docs === undefined ? [] : missingTokenInputScopes(actionTokenPermissions(source), docs.permissions);

    if (missing.length > 0) {
      gaps[actionPath] = missing.map(
        (permission) => `${permission.scope}: ${permission.access} (input ${permission.token})`,
      );
    }
  }

  return gaps;
}

/** Reads `runs.using` without a YAML parse, which is all the composite/node split needs. */
function runtimeOf(actionPath: string): string {
  const manifest = fs.readFileSync(path.join(ROOT_DIR, actionPath, 'action.yaml'), 'utf8');

  return /^\s*using:\s*'?([\w-]+)'?/m.exec(manifest)?.[1] ?? 'unknown';
}

/** The parsed jobs of a generated workflow on disk. */
function jobsOf(file: string): Record<string, Record<string, unknown>> {
  return (
    parse(fs.readFileSync(path.join(ROOT_DIR, file), 'utf8')) as { jobs: Record<string, Record<string, unknown>> }
  ).jobs;
}

/** The text of one job of a generated workflow, as YAML. */
function jobText(file: string, id: string): string {
  return JSON.stringify(jobsOf(file)[id]);
}

/** Every action directory with end-to-end cases. */
async function actionsWithCases(): Promise<string[]> {
  const files = await scanSorted(`actions/*/*/${E2E_DIRECTORY}/*.e2e.test.ts`);

  return [...new Set(files.map((file) => file.split('/').slice(0, 3).join('/')))];
}

describe('end-to-end contract', () => {
  it('gives every node action end-to-end cases, or a stated exemption', async () => {
    const manifests = await scanSorted('actions/*/*/action.yaml');
    const withCases = new Set(await actionsWithCases());

    const missing = manifests
      .map((manifest) => path.posix.dirname(manifest))
      .filter((actionPath) => runtimeOf(actionPath).startsWith('node'))
      .filter((actionPath) => !withCases.has(actionPath) && !(actionPath in E2E_EXEMPTIONS));

    expect(missing, `add ${E2E_DIRECTORY}/ cases or an entry in E2E_EXEMPTIONS with a reason`).toEqual([]);
  });

  it('exempts nothing that has cases anyway, and nothing that does not exist', async () => {
    const withCases = new Set(await actionsWithCases());

    expect(Object.keys(E2E_EXEMPTIONS).filter((actionPath) => withCases.has(actionPath))).toEqual([]);
    expect(
      Object.keys(E2E_EXEMPTIONS).filter(
        (actionPath) => !fs.existsSync(path.join(ROOT_DIR, actionPath, 'action.yaml')),
      ),
    ).toEqual([]);
  });

  it('gives every action with cases a source with an e2e block, and an e2e block only to such an action', async () => {
    const withCases = await actionsWithCases();
    const withBlock = SOURCES.filter((source) => source.e2e !== undefined).map((source) => `actions/${source.target}`);

    expect(withBlock, "add an e2e block to the action's source in .github/verify/, or remove it").toEqual(withCases);
    for (const actionPath of withBlock) {
      expect(hasE2eCases(ROOT_DIR, actionPath)).toBe(true);
    }
  });

  // The harness passes its one token to the action's token input, so a scope docs.yaml documents on
  // that input is one the cases exercise. Compared exactly, so the check fails both ways.
  it('grants every token the scopes docs.yaml documents on its token input, or states why not', () => {
    const explained = Object.fromEntries(
      Object.entries(NARROWER_TOKEN_SUITES).map(([actionPath, { missing }]) => [actionPath, missing]),
    );

    expect(tokenScopeGaps(), 'grant the missing scopes in the source, or record them in NARROWER_TOKEN_SUITES').toEqual(
      explained,
    );
  });

  it('widens an e2e allowlist never to a package registry', () => {
    for (const source of SOURCES) {
      expect(
        (source.e2e?.extraEndpoints ?? []).filter((endpoint) => /registry|npmjs|pypi|crates/.test(endpoint)),
      ).toEqual([]);
    }
  });
});

describe('generated Verify workflows', () => {
  it('match their generator', () => {
    expect(findDrift(ROOT_DIR), "run 'bun run generate-verify' and commit the result").toEqual([]);
  });

  it(`stay within ${MAX_SHARDS} reusable workflows, so a run never reaches GitHub's limit of 50`, () => {
    expect(
      GENERATED.shards.length,
      'too many shards: raise SHARD_SIZE_BUDGET or merge categories before GitHub refuses to start the run',
    ).toBeLessThanOrEqual(MAX_SHARDS);
  });

  it(`keep every generated file under ${MAX_WORKFLOW_BYTES} bytes, below GitHub's 500 KB limit`, () => {
    for (const [file, content] of GENERATED.files) {
      expect(Buffer.byteLength(content), `${file} is too large; lower SHARD_SIZE_BUDGET`).toBeLessThan(
        MAX_WORKFLOW_BYTES,
      );
    }
  });

  it('keep job ids unique across every shard', () => {
    const ids = GENERATED.shards.flatMap((shard) => Object.keys(jobsOf(shardFile(shard.id))));

    expect(ids.filter((id, index) => ids.indexOf(id) !== index)).toEqual([]);
  });

  it('end verify.yaml with the summary job, which needs every other job', () => {
    const jobs = jobsOf(VERIFY_WORKFLOW);
    const summary = Object.values(jobs).find((job) => job['name'] === SUMMARY_JOB_NAME);

    expect(summary).toBeDefined();
    expect(summary?.['if']).toBe('${{ always() }}');
    expect(summary?.['needs']).toEqual(Object.keys(jobs).filter((id) => jobs[id] !== summary));
  });

  // The jobs the generator writes hold the scratch-repository token, so they block. A source job may
  // still audit, where it installs toolchains from hosts nobody has listed yet; AUDITING_SOURCES
  // records those, and may only shrink.
  it('block egress in every job the generator writes, and audit only where a source is recorded', () => {
    for (const file of GENERATED.files.keys()) {
      if (!file.endsWith('.yaml')) {
        continue;
      }
      const jobs = jobsOf(file);
      for (const shard of GENERATED.shards.filter((candidate) => shardFile(candidate.id) === file)) {
        for (const target of shard.targets.filter((candidate) => candidate.source.e2e !== undefined)) {
          expect(JSON.stringify(jobs[e2eJobId(target.source.target)]), `${file}: the e2e job must block`).toContain(
            '"egress-policy":"block"',
          );
        }
      }
      if (file === VERIFY_WORKFLOW) {
        expect(fs.readFileSync(path.join(ROOT_DIR, file), 'utf8')).not.toContain('egress-policy: audit');
      }
    }

    const auditing = Object.fromEntries(
      SOURCES.map((source) => [source.file, auditSteps(source)]).filter(([, count]) => (count as number) > 0),
    );

    expect(
      auditing,
      'a source audits egress where AUDITING_SOURCES does not record it; block, or lower the count',
    ).toEqual(AUDITING_SOURCES);
  });

  // The whole reason the install is a separate job: harden-runner sets one policy per job, so the
  // only way for the job holding the token to have no route to a package registry is not to install.
  it('give the job that holds the scratch-repository token no route to a package registry', () => {
    expect(E2E_ALLOWED_ENDPOINTS).not.toContain('registry.npmjs.org:443');
    expect(INSTALL_ALLOWED_ENDPOINTS).toContain('registry.npmjs.org:443');

    for (const shard of GENERATED.shards) {
      for (const target of shard.targets.filter((candidate) => candidate.source.e2e !== undefined)) {
        const job = jobText(shardFile(shard.id), e2eJobId(target.source.target));

        expect(job).toContain('egress-policy');
        expect(job).not.toContain('registry.npmjs.org');
        expect(job).not.toContain('bun/setup-cached@');
        expect(job).toContain('fail-on-cache-miss');
        expect(job).toMatch(/permission-[\w-]+/);
        expect(job).toContain(`bun run e2e actions/${target.source.target}`);
      }
    }
  });

  /**
   * `actions/cache` returns an entry only when the key and a version hashed from the `path` input both
   * match, and it hashes that input exactly as written, so the job that saves and every job that
   * restores have to name the paths identically. The set has to cover every workspace member: bun
   * leaves each package's own dependencies in its own `node_modules`.
   */
  it('save and restore the same dependency paths, covering every workspace', () => {
    const pathsOf = (job: Record<string, unknown>): string | undefined =>
      (job['steps'] as { uses?: string; with?: { path?: string } }[]).find((step) =>
        step.uses?.startsWith('actions/cache'),
      )?.with?.path;
    const saved = pathsOf(jobsOf(VERIFY_WORKFLOW)['install']);

    expect(saved).toBeDefined();
    expect(pathsOf(jobsOf(VERIFY_WORKFLOW)['build'])).toEqual(saved);
    for (const pattern of workspaceModulePaths(workspaceMemberDirectories(ROOT_DIR))) {
      expect(saved?.split('\n')).toContain(pattern);
    }
    for (const shard of GENERATED.shards) {
      for (const target of shard.targets.filter((candidate) => candidate.source.e2e !== undefined)) {
        expect(pathsOf(jobsOf(shardFile(shard.id))[e2eJobId(target.source.target)])).toEqual(saved);
      }
    }
  });
});

describe('affected-target detection against this repository', () => {
  const { plan } = GENERATED;
  const pr: PlanEvent = { name: 'pull_request', baseRef: 'main' };
  const select = (files: string[]) => selectTargets(plan, pr, files).targets;

  it('runs every target that builds or tests with packages/ts-util for a change to it', () => {
    const expected = plan.targets
      .filter((target) => target.inputs.includes('packages/ts-util'))
      .map((target) => target.id);

    expect(expected.length).toBeGreaterThan(40);
    expect(select(['packages/ts-util/src/index.ts'])).toEqual(expected.sort());
  });

  it('runs every target with end-to-end cases for a lockfile change', () => {
    const withCases = SOURCES.filter((source) => source.e2e !== undefined).map((source) => source.target);

    expect(select(['bun.lock'])).toEqual(expect.arrayContaining(withCases));
  });

  it("runs a single action's target, and the targets that run it, for a change to that action", () => {
    expect(select(['actions/common/find-patch/helper/src/find.ts'])).toEqual([
      'common/find-patch',
      'common/generated-files-verdict',
    ]);
  });

  it('runs nothing for a README-only change', () => {
    expect(select(['actions/common/find-patch/README.md', 'actions/release/build-actions/CHANGELOG.md'])).toEqual([]);
  });

  it('runs the targets that read the terrace-helm fixture for a change to it, through extra-inputs', () => {
    expect(select(['.github/testdata/terrace-helm/terrace.yaml'])).toEqual([
      'helm/update-chart-version',
      'terrace/helm-check',
      'terrace/helm-diff',
      'terrace/helm-sync',
    ]);
  });

  it('runs only the scheduled targets on the weekly schedule', () => {
    expect(selectTargets(plan, { name: 'schedule' }, 'all').targets).toEqual(['configs/renovate']);
  });

  it('keeps the targets restricted to main off a pull request against another base', () => {
    const restricted = [
      'bun/setup-cached',
      'common/create-pull-request',
      'common/render-template-and-commit',
      'helm/update-chart-version',
    ];

    expect(plan.targets.filter((target) => target.pullRequestBranches !== null).map((target) => target.id)).toEqual(
      restricted,
    );
    const selected = selectTargets(plan, { name: 'pull_request', baseRef: 'release' }, ['bun.lock']).targets;
    for (const target of restricted) {
      expect(selected).not.toContain(target);
    }
  });

  it('runs a target for a change to its own source file', () => {
    expect(select(['.github/verify/common-find-patch.yaml'])).toEqual(['common/find-patch']);
  });
});
