/**
 * Local action references outside action manifests: in workflow files and in end-to-end test sources.
 *
 * @packageDocumentation
 */
import { parse } from 'yaml';

import { localUsesPath } from './manifest.js';
import { joinRepoPath, ROOT, sortedUnique, toRepoPath } from './paths.js';

/** One `uses: ./<path>` step of a workflow. */
export interface WorkflowLocalRef {
  /** The id of the job the step belongs to. */
  readonly job: string;
  /** Zero-based index of the step within the job. */
  readonly step: number;
  /** The `uses:` value as written. */
  readonly uses: string;
  /**
   * The checkout prefix the reference was written under, `.` when none matched. A job that checks the
   * repository out at `tmp/actions-code` references its actions as `./tmp/actions-code/actions/x`.
   */
  readonly prefix: string;
  /** The action directory with the prefix removed: the path inside the checked-out repository. */
  readonly action: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Strips the longest matching checkout prefix, so `tmp/actions-code/actions/x` becomes `actions/x`. */
function splitPrefix(local: string, prefixes: readonly string[]): { prefix: string; action: string } {
  const matching = prefixes
    .filter((prefix) => prefix !== ROOT && local.startsWith(`${prefix}/`))
    .sort((a, b) => b.length - a.length);
  const prefix = matching[0];

  return prefix === undefined ? { prefix: ROOT, action: local } : { prefix, action: local.slice(prefix.length + 1) };
}

/**
 * Every step of a workflow that runs a local action, in job and step order.
 *
 * @param content - the workflow file's text
 * @param checkoutPrefixes - repository-relative directories a job may check this repository out to
 * @throws an `Error` when the text is not YAML
 */
export function workflowLocalRefs(content: string, checkoutPrefixes: readonly string[] = []): WorkflowLocalRef[] {
  const prefixes = checkoutPrefixes.map((prefix) => toRepoPath(prefix, 'checkout prefix'));
  const document: unknown = parse(content);
  const jobs = isRecord(document) && isRecord(document['jobs']) ? document['jobs'] : {};
  const refs: WorkflowLocalRef[] = [];

  for (const [job, definition] of Object.entries(jobs)) {
    const steps = isRecord(definition) && Array.isArray(definition['steps']) ? definition['steps'] : [];
    steps.forEach((step: unknown, index) => {
      const uses = isRecord(step) && typeof step['uses'] === 'string' ? step['uses'] : undefined;
      const local = uses === undefined ? undefined : localUsesPath(uses);
      if (uses !== undefined && local !== undefined) {
        refs.push({ job, step: index, uses, ...splitPrefix(local, prefixes) });
      }
    });
  }

  return refs;
}

/**
 * `new URL('<literal>', import.meta.url)` with a string literal, the one form of a path to another
 * action's directory a test may use and still be found statically.
 */
const URL_LITERAL = /new\s+URL\(\s*(['"])([^'"\\\r\n]+)\1\s*,\s*import\.meta\.url\s*\)/g;

/**
 * The repository paths a test source resolves with `new URL('<literal>', import.meta.url)`.
 *
 * A path built at runtime is not found. The end-to-end harness checks every bundle it runs against the
 * installed manifest, so such a path fails there instead of passing on a stale bundle.
 *
 * @param source - the test file's text
 * @param fileDirectory - repository-relative directory of the test file
 */
export function e2eLocalRefs(source: string, fileDirectory: string): string[] {
  const directory = toRepoPath(fileDirectory, 'test directory');
  const paths: string[] = [];

  for (const match of source.matchAll(URL_LITERAL)) {
    const literal = match[2];
    if (/^[a-z][a-z0-9+.-]*:/i.test(literal)) {
      continue;
    }
    try {
      paths.push(joinRepoPath(directory, literal));
    } catch {
      // A URL resolving above the repository root names nothing in it.
    }
  }

  return sortedUnique(paths);
}
