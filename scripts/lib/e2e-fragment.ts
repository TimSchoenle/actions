import { localUsesPath, toRepoPath } from 'action-graph';
import { parse } from 'yaml';

/**
 * Reading and rewriting the extra-jobs fragments the end-to-end generator appends to a workflow.
 *
 * A fragment stores its jobs at column zero, each job's keys two spaces in. The rewriting is line
 * based, like the rest of the generator, so the fragment's comments and layout survive into the
 * generated workflow exactly as written.
 */

/** The action this repository's install step is, relative to a checkout of the repository. */
export const INSTALL_BUILT_ACTIONS = 'actions/release/install-built-actions';

/** The action this repository's build step is, relative to a checkout of the repository. */
export const BUILD_ACTIONS = 'actions/release/build-actions';

/**
 * The comment every local `uses:` in the generated workflows carries: jactionlint (and zizmor before
 * it) flags a self-repository reference, and the `$/` syntax it suggests is rejected by actionlint.
 */
export const SELF_REPOSITORY_COMMENT =
  '# zizmor: ignore[self-repository] -- actionlint rejects the $/ syntax as an action without a ref.';

/** One local action of this repository that a fragment job runs. */
export interface FragmentLocalRef {
  readonly job: string;
  /** The directory the job checked this repository out to, `.` for the workspace root. */
  readonly prefix: string;
  /** The action directory inside the checkout, always below `actions/`. */
  readonly action: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Whether a `uses:` value is a checkout of a repository, before or after pin substitution. */
function isCheckout(uses: string): boolean {
  return uses === 'pinned:checkout' || uses.startsWith('actions/checkout@');
}

/** The checkout directories of one job's steps: `with.path` of each checkout, `.` when it has none. */
function checkoutPrefixes(steps: readonly unknown[]): string[] {
  return steps
    .filter(
      (step): step is Record<string, unknown> =>
        isRecord(step) && typeof step['uses'] === 'string' && isCheckout(step['uses']),
    )
    .map((step) => {
      const target = isRecord(step['with']) ? step['with']['path'] : undefined;

      return typeof target === 'string' && target !== '' ? toRepoPath(target, 'checkout path') : '.';
    });
}

/**
 * Every local action of this repository a fragment's jobs run.
 *
 * A reference counts when it is `./<checkout>/actions/...` for one of the job's checkouts, `.` being
 * a checkout at the workspace root. Anything else is something a step wrote into the workspace at
 * run time, such as `./round-trip/actions/demo`, and is not built.
 *
 * @throws an `Error` when the fragment is not a YAML mapping of jobs
 */
export function fragmentLocalRefs(fragment: string): FragmentLocalRef[] {
  if (fragment.trim() === '') {
    return [];
  }
  const jobs: unknown = parse(fragment);
  if (!isRecord(jobs)) {
    throw new Error('An extra-jobs fragment must be a YAML mapping of jobs.');
  }

  return Object.entries(jobs).flatMap(([job, definition]) =>
    jobLocalRefs(job, isRecord(definition) && Array.isArray(definition['steps']) ? definition['steps'] : []),
  );
}

/** The action `local` names inside one of `prefixes` (longest first), when it lies below `actions/`. */
function actionInCheckout(local: string, prefixes: readonly string[]): { prefix: string; action: string } | undefined {
  for (const prefix of prefixes) {
    const action = prefix === '.' ? local : local.startsWith(`${prefix}/`) ? local.slice(prefix.length + 1) : undefined;
    if (action?.startsWith('actions/')) {
      return { prefix, action };
    }
  }

  return undefined;
}

/** The local actions of this repository one job's steps run. */
function jobLocalRefs(job: string, steps: readonly unknown[]): FragmentLocalRef[] {
  const prefixes = [...new Set(checkoutPrefixes(steps))].sort((a, b) => b.length - a.length);

  return steps.flatMap((step) => {
    const local = isRecord(step) && typeof step['uses'] === 'string' ? localUsesPath(step['uses']) : undefined;
    const found = local === undefined ? undefined : actionInCheckout(local, prefixes);

    return found === undefined ? [] : [{ job, ...found }];
  });
}

/** The `uses:` of this repository's action `action` in a job that checked the repository out to `prefix`. */
export function localUses(prefix: string, action: string): string {
  return `./${prefix === '.' ? '' : `${prefix}/`}${action}`;
}

/** The install step, as lines indented to sit in a job's step list at `indent`. */
export function installStepLines(indent: string, prefix: string): string[] {
  return [
    `${indent}# Replaces the committed bundles with the ones the build job built from this commit.`,
    `${indent}- name: Install Built Actions`,
    `${indent}  uses: ${localUses(prefix, INSTALL_BUILT_ACTIONS)} ${SELF_REPOSITORY_COMMENT}`,
    `${indent}  with:`,
    `${indent}    artifact-id: \${{ needs.build.outputs.artifact-id }}`,
    `${indent}    expected-manifest-sha256: \${{ needs.build.outputs.manifest-sha256 }}`,
    ...(prefix === '.' ? [] : [`${indent}    path: ${prefix}`]),
  ];
}

/** The hosts an artifact download reaches, which an install step adds to a job's egress allowlist. */
export const ARTIFACT_ENDPOINTS: readonly string[] = [
  '*.actions.githubusercontent.com:443',
  '*.blob.core.windows.net:443',
];

const JOB_HEADER = /^([a-z0-9][\w-]*):\s*$/i;

/** The line ranges of a fragment's jobs, by id. */
function jobRanges(lines: readonly string[]): Map<string, { start: number; end: number }> {
  const starts = lines.flatMap((line, index) => {
    const match = JOB_HEADER.exec(line);

    return match ? [{ id: match[1], start: index }] : [];
  });

  return new Map(starts.map(({ id, start }, index) => [id, { start, end: starts[index + 1]?.start ?? lines.length }]));
}

/** The job's `needs:` rewritten to include `build` first, as replacement lines for the job block. */
function withBuildNeeded(block: string[]): string[] {
  const at = block.findIndex((line) => /^ {2}needs:/.test(line));
  if (at === -1) {
    return [block[0], '  needs: build', ...block.slice(1)];
  }

  const value = block[at].slice('  needs:'.length).trim();
  if (value === '') {
    const itemIndent = /^(\s*)- /.exec(block[at + 1] ?? '')?.[1] ?? '    ';
    return [...block.slice(0, at + 1), `${itemIndent}- build`, ...block.slice(at + 1)];
  }
  const existing = value.startsWith('[') ? (parse(value) as string[]) : [value];
  const needs = ['build', ...existing.filter((id) => id !== 'build')];

  return [...block.slice(0, at), `  needs: [${needs.join(', ')}]`, ...block.slice(at + 1)];
}

/** Status functions that let a job run although a job it needs failed or was cancelled. */
const OVERRIDES_NEEDS = /\b(?:always|failure|cancelled)\s*\(/;

/**
 * The job's `if:` extended to require a successful build, when the condition would otherwise run the
 * job after a failed or cancelled one. A job without such a status function is skipped by default
 * when `build` does not succeed, so its condition is left alone. Without this, the install step of an
 * `always()` job fails on an empty artifact id and buries the build's own error under a second one.
 *
 * @throws an `Error` for a condition written as a block scalar, which this rewrite cannot extend
 */
function withBuildSucceeded(block: string[], job: string): string[] {
  const at = block.findIndex((line) => /^ {2}if:/.test(line));
  if (at === -1) {
    return block;
  }
  const raw = block[at].slice('  if:'.length).trim();
  if (/^[>|]/.test(raw)) {
    throw new Error(`Extra job ${job} writes its if: as a block scalar; write it on one line.`);
  }
  const expression = /^\$\{\{([\s\S]*)\}\}$/.exec(raw)?.[1]?.trim() ?? raw;
  if (!OVERRIDES_NEEDS.test(expression)) {
    return block;
  }

  return [
    ...block.slice(0, at),
    `  if: \${{ (${expression}) && needs.build.result == 'success' }}`,
    ...block.slice(at + 1),
  ];
}

/**
 * The job block with {@link ARTIFACT_ENDPOINTS} added to its harden-runner allowlist, when it has one,
 * so the injected install step can download the artifact under `egress-policy: block`.
 */
function withArtifactEndpoints(block: string[]): string[] {
  const at = block.findIndex((line) => /^\s*allowed-endpoints:\s*>-?\s*$/.test(line));
  if (at === -1) {
    return block;
  }
  const keyIndent = block[at].length - block[at].trimStart().length;
  let end = at + 1;
  while (
    end < block.length &&
    block[end].trim() !== '' &&
    block[end].length - block[end].trimStart().length > keyIndent
  ) {
    end += 1;
  }
  const listed = block.slice(at + 1, end).map((line) => line.trim());
  const indent = /^(\s*)/.exec(block[at + 1] ?? '')?.[1] ?? ' '.repeat(keyIndent + 2);
  const missing = ARTIFACT_ENDPOINTS.filter((endpoint) => !listed.includes(endpoint)).map(
    (endpoint) => `${indent}${endpoint}`,
  );

  return [...block.slice(0, end), ...missing, ...block.slice(end)];
}

/** The index after which the install step goes: the last non-blank line of the job's checkout to `prefix`. */
function checkoutEnd(block: readonly string[], prefix: string, job: string): { after: number; indent: string } {
  const stepsAt = block.findIndex((line) => /^ {2}steps:\s*$/.test(line));
  const indent = /^(\s*)- /.exec(
    block.slice(stepsAt + 1).find((line) => line.trim() !== '' && !line.trim().startsWith('#')) ?? '',
  )?.[1];
  if (stepsAt === -1 || indent === undefined) {
    throw new Error(`Extra job ${job} has no steps to install the built actions into.`);
  }

  const starts = block.flatMap((line, index) => (index > stepsAt && line.startsWith(`${indent}- `) ? [index] : []));
  for (const [position, start] of starts.entries()) {
    const end = starts[position + 1] ?? block.length;
    const text = block
      .slice(start, end)
      .map((line) => line.slice(indent.length))
      .join('\n');
    const [step] = parse(text) as unknown[];
    if (!isRecord(step) || typeof step['uses'] !== 'string' || !isCheckout(step['uses'])) {
      continue;
    }
    if (checkoutPrefixes([step])[0] === prefix) {
      // Trailing blank lines and comments belong to the step that follows.
      let after = end - 1;
      while (after > start && (block[after].trim() === '' || block[after].trim().startsWith('#'))) {
        after -= 1;
      }
      return { after, indent };
    }
  }

  throw new Error(
    `Extra job ${job} runs this repository's actions from ${prefix} but never checks the repository out there.`,
  );
}

/**
 * Adds the install step to every fragment job that runs a local action with a bundle, and makes the
 * job need the build job whose outputs the step reads, and run only once that build succeeded.
 *
 * @param installs - per job id, the checkout prefixes to install into
 * @throws an `Error` for a job without a checkout of the repository at a prefix it needs
 */
export function injectInstallSteps(fragment: string, installs: ReadonlyMap<string, readonly string[]>): string {
  if (installs.size === 0) {
    return fragment;
  }

  const lines = fragment.split('\n');
  const ranges = jobRanges(lines);
  const ordered = [...installs].sort(([a], [b]) => (ranges.get(b)?.start ?? 0) - (ranges.get(a)?.start ?? 0));

  for (const [job, prefixes] of ordered) {
    const range = ranges.get(job);
    if (range === undefined) {
      throw new Error(`Extra job ${job} is not in the fragment.`);
    }
    let block = lines.slice(range.start, range.end);
    const insertions = prefixes
      .map((prefix) => ({ prefix, ...checkoutEnd(block, prefix, job) }))
      .sort((a, b) => b.after - a.after);
    for (const { prefix, after, indent } of insertions) {
      block = [...block.slice(0, after + 1), '', ...installStepLines(indent, prefix), ...block.slice(after + 1)];
    }
    lines.splice(
      range.start,
      range.end - range.start,
      ...withBuildSucceeded(withBuildNeeded(withArtifactEndpoints(block)), job),
    );
  }

  return lines.join('\n');
}
