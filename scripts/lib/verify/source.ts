import fs from 'node:fs';
import path from 'node:path';

import { isMap, isScalar, isSeq, parseDocument } from 'yaml';

import type { Document, YAMLMap } from 'yaml';

/**
 * The source files of the Verify workflow: one per target, under `.github/verify/`.
 *
 * A source holds what only a person can write about a target: its jobs, in ordinary workflow job
 * syntax, and the few facts the dependency graph cannot see. Everything else (which actions to build,
 * which changed files select the target, the job that runs its end-to-end cases) is derived by the
 * generator. See docs/verify-pipeline.md for the format and the contract the jobs are written against.
 *
 * The sources live outside `actions/`: release-please counts every file below an action's directory as
 * a change to that action, so a test-only edit there would cut a release.
 *
 * @packageDocumentation
 */

/** Directory of the source files, relative to the repository root. */
export const SOURCES_DIR = '.github/verify';

/** A token scope and the access level granted on it. */
export type TokenPermissions = Readonly<Record<string, 'read' | 'write'>>;

/** What the generated end-to-end job of a target needs beyond the defaults. */
export interface E2eSettings {
  /**
   * Scopes of the App token the cases run with. Always explicit: `create-github-app-token` grants the
   * installation's entire permission set when no `permission-*` input is given.
   */
  readonly tokenPermissions: TokenPermissions;
  /** Scopes of a second identity's token, for an action that must act as someone else. */
  readonly secondaryTokenPermissions?: TokenPermissions;
  /** Endpoints the job may reach beyond the GitHub API. Never a package registry. */
  readonly extraEndpoints: readonly string[];
}

/** When a target runs, beyond "something it depends on changed". */
export interface TargetRules {
  /** Base branches a pull request must target for the target to run; every branch when undefined. */
  readonly pullRequestBranches?: readonly string[];
  /** Branches other than `main` whose pushes run the target. Defaults to `feature/<target>`. */
  readonly pushBranches: readonly string[];
  /** Whether the weekly schedule runs the target. */
  readonly schedule: boolean;
}

/** One parsed and validated source file. */
export interface VerifySource {
  /** Repository-relative path of the source file. */
  readonly file: string;
  /** `<category>/<name>`, e.g. `common/find-patch`. */
  readonly target: string;
  /** Human-readable title, the prefix of every job's display name. */
  readonly title: string;
  /** Present when the generator adds the job that runs `actions/<target>/e2e/*.e2e.test.ts`. */
  readonly e2e?: E2eSettings;
  /** Action directories to build beyond those the jobs and cases reference. */
  readonly build: readonly string[];
  /** Repository paths the graph cannot see that still change the target's verdict. */
  readonly extraInputs: readonly string[];
  readonly rules: TargetRules;
  /** The source's jobs, as written. */
  readonly jobs: YAMLMap;
  /** Job ids, in source order. */
  readonly jobIds: readonly string[];
  /** The parsed document the jobs belong to. */
  readonly document: Document;
  /** The source file's text, from which the generator copies the jobs verbatim. */
  readonly text: string;
}

const TOP_LEVEL_KEYS = new Set(['target', 'title', 'e2e', 'build', 'extra-inputs', 'rules', 'jobs']);
const E2E_KEYS = new Set(['token-permissions', 'secondary-token-permissions', 'extra-endpoints']);
const RULE_KEYS = new Set(['pull-request-branches', 'push-branches', 'schedule']);
const TARGET_PATTERN = /^[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9-]*$/;
const JOB_ID_PATTERN = /^[A-Za-z_][\w-]*$/;
const REPO_PATH_PATTERN = /^(?!\/)(?!.*(?:^|\/)\.\.?(?:\/|$))[\w.@/-]+(?<!\/)$/;

/** The source file name of a target: `common/find-patch` is `common-find-patch.yaml`. */
export function sourceFileName(target: string): string {
  return `${target.replace('/', '-')}.yaml`;
}

/** Title-cases one path segment: `find-patch` becomes `Find-patch`. */
function titleCase(segment: string): string {
  return segment.charAt(0).toUpperCase() + segment.slice(1);
}

/** The default title of a target: `common/find-patch` is `Common Find-patch`. */
export function defaultTitle(target: string): string {
  return target.split('/').map(titleCase).join(' ');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** An error naming the source file, so a mistake in one of many sources is found at once. */
function fail(file: string, message: string): never {
  throw new Error(`${file}: ${message}`);
}

function unknownKeys(file: string, where: string, value: Record<string, unknown>, allowed: ReadonlySet<string>): void {
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    fail(file, `unknown key(s) ${unknown.join(', ')} in ${where}; allowed: ${[...allowed].join(', ')}`);
  }
}

function stringList(file: string, where: string, value: unknown): string[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === 'string' && entry !== '')) {
    fail(file, `${where} must be a list of non-empty strings`);
  }

  return value as string[];
}

function repoPaths(file: string, where: string, value: unknown): string[] {
  const paths = stringList(file, where, value);
  const invalid = paths.filter((entry) => !REPO_PATH_PATTERN.test(entry));
  if (invalid.length > 0) {
    fail(file, `${where} holds paths that are not plain repository-relative paths: ${invalid.join(', ')}`);
  }

  return paths;
}

function tokenPermissions(file: string, where: string, value: unknown): TokenPermissions {
  if (!isRecord(value) || Object.keys(value).length === 0) {
    fail(file, `${where} must map at least one scope to read or write`);
  }
  for (const [scope, access] of Object.entries(value)) {
    if (access !== 'read' && access !== 'write') {
      fail(file, `${where}.${scope} must be read or write, not ${String(access)}`);
    }
  }

  return value as TokenPermissions;
}

function e2eSettings(file: string, value: unknown): E2eSettings {
  if (!isRecord(value)) {
    fail(file, 'e2e must be a mapping');
  }
  unknownKeys(file, 'e2e', value, E2E_KEYS);

  return {
    tokenPermissions: tokenPermissions(file, 'e2e.token-permissions', value['token-permissions']),
    ...(value['secondary-token-permissions'] === undefined
      ? {}
      : {
          secondaryTokenPermissions: tokenPermissions(
            file,
            'e2e.secondary-token-permissions',
            value['secondary-token-permissions'],
          ),
        }),
    extraEndpoints: stringList(file, 'e2e.extra-endpoints', value['extra-endpoints']),
  };
}

function targetRules(file: string, target: string, value: unknown): TargetRules {
  if (value !== undefined && !isRecord(value)) {
    fail(file, 'rules must be a mapping');
  }
  const rules = value ?? {};
  unknownKeys(file, 'rules', rules, RULE_KEYS);
  if (rules['schedule'] !== undefined && typeof rules['schedule'] !== 'boolean') {
    fail(file, 'rules.schedule must be true or false');
  }

  return {
    ...(rules['pull-request-branches'] === undefined
      ? {}
      : { pullRequestBranches: stringList(file, 'rules.pull-request-branches', rules['pull-request-branches']) }),
    pushBranches:
      rules['push-branches'] === undefined
        ? [`feature/${target}`]
        : stringList(file, 'rules.push-branches', rules['push-branches']),
    schedule: rules['schedule'] === true,
  };
}

/** The `jobs:` mapping of a source and its ids, checked to be a mapping of job mappings. */
function sourceJobs(file: string, document: Document): { jobs: YAMLMap; jobIds: string[] } {
  const node = document.get('jobs', true);
  if (node !== undefined && !isMap(node)) {
    fail(file, 'jobs must be a mapping of job ids to jobs');
  }
  const jobs = (node ?? document.createNode({})) as YAMLMap;
  const jobIds: string[] = [];
  for (const pair of jobs.items) {
    const id = isScalar(pair.key) ? String(pair.key.value) : '';
    if (!JOB_ID_PATTERN.test(id)) {
      fail(file, `job id '${id}' is not a valid job id`);
    }
    if (!isMap(pair.value)) {
      fail(file, `job ${id} must be a mapping`);
    }
    const steps = pair.value.get('steps', true);
    if (steps !== undefined && !isSeq(steps)) {
      fail(file, `job ${id} has steps that are not a list`);
    }
    jobIds.push(id);
  }

  return { jobs, jobIds };
}

/**
 * Parses and validates one source file.
 *
 * @param file - repository-relative path, used to check the file name and to label errors
 * @param content - the file's text
 * @throws an `Error` naming the file for anything the generator could not render faithfully
 */
export function parseSource(file: string, content: string): VerifySource {
  const document = parseDocument(content, { prettyErrors: true });
  if (document.errors.length > 0) {
    fail(file, `not valid YAML: ${document.errors.map((error) => error.message).join('; ')}`);
  }
  const value: unknown = document.toJS();
  if (!isRecord(value)) {
    fail(file, 'must be a YAML mapping');
  }
  unknownKeys(file, 'the source', value, TOP_LEVEL_KEYS);

  const target = value['target'];
  if (typeof target !== 'string' || !TARGET_PATTERN.test(target)) {
    fail(file, 'target must be <category>/<name> in lower case');
  }
  if (path.posix.basename(file) !== sourceFileName(target)) {
    fail(file, `the source of ${target} must be named ${sourceFileName(target)}`);
  }
  if (value['title'] !== undefined && (typeof value['title'] !== 'string' || /['\n]/.test(value['title']))) {
    fail(file, 'title must be a single-line string without single quotes');
  }

  const { jobs: jobMap, jobIds } = sourceJobs(file, document);
  if (value['e2e'] === undefined && jobIds.length === 0) {
    fail(file, 'a source needs jobs, an e2e block, or both');
  }

  return {
    file,
    target,
    title: typeof value['title'] === 'string' ? value['title'] : defaultTitle(target),
    ...(value['e2e'] === undefined ? {} : { e2e: e2eSettings(file, value['e2e']) }),
    build: repoPaths(file, 'build', value['build']),
    extraInputs: repoPaths(file, 'extra-inputs', value['extra-inputs']),
    rules: targetRules(file, target, value['rules']),
    jobs: jobMap,
    jobIds,
    document,
    text: content,
  };
}

/**
 * Every source file of the repository, parsed and sorted by target.
 *
 * @param root - absolute path of the repository root
 */
export function readSources(root: string): VerifySource[] {
  const directory = path.join(root, SOURCES_DIR);
  if (!fs.existsSync(directory)) {
    return [];
  }

  return fs
    .readdirSync(directory)
    .filter((file) => file.endsWith('.yaml'))
    .sort()
    .map((file) => parseSource(`${SOURCES_DIR}/${file}`, fs.readFileSync(path.join(directory, file), 'utf8')));
}

/** The plain JavaScript value of one job of a source. */
export function jobValue(source: VerifySource, id: string): Record<string, unknown> {
  const node = source.jobs.get(id, true);

  return isMap(node) ? (node.toJSON() as Record<string, unknown>) : {};
}
