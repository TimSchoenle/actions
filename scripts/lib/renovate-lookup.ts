// Pure helpers for `check-renovate-lookups`: they decide what a fixture expects and whether a Renovate
// report meets it. Free of filesystem and Bun APIs so the vitest suite (which runs under Node) covers
// the exact logic the script runs.

/** Repository whose `configs/renovate/*` presets the fixtures exercise. */
export const PRESET_REPOSITORY = 'TimSchoenle/actions';

/** pino's `warn` level. Renovate records every repository problem at this level or above. */
export const WARN_LEVEL = 40;

/**
 * A reference to one of this repository's presets, as consumers and the presets themselves write it:
 * `github>TimSchoenle/actions//configs/renovate/<name>`, optionally with a `.json`/`.json5` extension
 * and a `#ref`. The name is captured. Matched case-insensitively, as Renovate resolves it.
 */
// eslint-disable-next-line security/detect-non-literal-regexp -- Built once from a module constant, not from input.
const PRESET_REFERENCE = new RegExp(
  String.raw`github>${PRESET_REPOSITORY.replace('/', '\\/')}\/\/configs\/renovate\/([A-Za-z0-9_-]+)(?:\.json5?)?(?:#[^"'\s]+)?`,
  'gi',
);

/** Names a preset file may have; anything else is refused by the preset server. */
export const PRESET_NAME = /^[a-z0-9][a-z0-9_-]*$/;

/**
 * Points every reference to this repository's presets at `baseUrl` instead of GitHub.
 *
 * Renovate resolves `github>` presets from the default branch, so a pull request that changes a
 * preset would otherwise be tested against `main`. Rewriting the references, nested ones included,
 * makes Renovate load the checked-out files through the local preset server.
 */
export function rewritePresetReferences(content: string, baseUrl: string): string {
  return content.replace(PRESET_REFERENCE, (_match, name: string) => presetUrl(baseUrl, name.toLowerCase()));
}

export function presetUrl(baseUrl: string, name: string): string {
  if (!PRESET_NAME.test(name)) {
    throw new Error(`Invalid preset name '${name}'.`);
  }

  return `${baseUrl.replace(/\/+$/, '')}/${name}.json`;
}

// ---------------------------------------------------------------------------
// Fixture cases
// ---------------------------------------------------------------------------

/** What one dependency in a fixture must look up to. */
export interface DependencyExpectation {
  /** Manager key as the report writes it: `cargo`, `github-actions`, `regex`, ... */
  manager: string;
  depName: string;
  /** Narrows the match when the same dependency appears in more than one file. */
  packageFile?: string;
  /**
   * The fewest updates Renovate must propose. Fixtures pin old releases, so a lookup that silently
   * stops proposing anything fails here instead of passing with an empty result.
   */
  minUpdates: number;
  /** Pattern every proposed `newValue` must match, as a regular expression source. */
  newValue?: string;
  /** Branch every proposed update must land on; this is how a group is asserted. */
  branchName?: string;
  /**
   * Update types the expectation is about. When set, `minUpdates`, `newValue` and `branchName` see
   * only updates of these types, so a fixture can assert the non-major group without breaking the
   * day its dependency publishes a major, which Renovate deliberately keeps on a branch of its own.
   */
  updateTypes?: string[];
}

/** Renovate's update types, so a typo in a fixture fails parsing instead of matching nothing. */
const UPDATE_TYPES: ReadonlySet<string> = new Set([
  'major',
  'minor',
  'patch',
  'pin',
  'digest',
  'pinDigest',
  'lockFileMaintenance',
  'rollback',
  'bump',
  'replacement',
]);

export interface LookupCase {
  /** Directory name of the fixture. */
  name: string;
  description: string;
  /** Presets from `configs/renovate/` the fixture's `renovate.json` extends, in order. */
  presets: string[];
  /** Destination path in the fixture repository → source file inside the fixture directory. */
  files: Record<string, string>;
  dependencies: DependencyExpectation[];
}

function fail(caseName: string, message: string): never {
  throw new Error(`Fixture '${caseName}': ${message}`);
}

function requireString(caseName: string, value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    fail(caseName, `'${field}' must be a non-empty string.`);
  }

  return value;
}

function optionalString(caseName: string, value: unknown, field: string): string | undefined {
  return value === undefined ? undefined : requireString(caseName, value, field);
}

/** A relative path that cannot leave the directory it is joined to. */
function isContainedPath(value: string): boolean {
  if (value.startsWith('/') || value.startsWith('\\') || /^[A-Za-z]:/.test(value)) {
    return false;
  }

  return !value.split(/[/\\]/).some((segment) => segment === '..' || segment === '');
}

function parseDependency(caseName: string, raw: unknown, index: number): DependencyExpectation {
  if (raw === null || typeof raw !== 'object') {
    fail(caseName, `dependencies[${index}] must be an object.`);
  }

  const entry = raw as Record<string, unknown>;
  const field = (name: string): string => `dependencies[${index}].${name}`;

  const minUpdates = entry.minUpdates ?? 0;
  if (typeof minUpdates !== 'number' || !Number.isInteger(minUpdates) || minUpdates < 0) {
    fail(caseName, `'${field('minUpdates')}' must be a non-negative integer.`);
  }

  const newValue = optionalString(caseName, entry.newValue, field('newValue'));
  if (newValue !== undefined) {
    try {
      // eslint-disable-next-line security/detect-non-literal-regexp -- Compiled only to validate a pattern from a committed fixture.
      new RegExp(newValue);
    } catch {
      fail(caseName, `'${field('newValue')}' is not a valid regular expression.`);
    }
  }

  const updateTypes = entry.updateTypes;
  if (
    updateTypes !== undefined &&
    (!Array.isArray(updateTypes) ||
      updateTypes.length === 0 ||
      !updateTypes.every((type) => typeof type === 'string' && UPDATE_TYPES.has(type)))
  ) {
    fail(caseName, `'${field('updateTypes')}' must be a non-empty array of Renovate update types.`);
  }

  return {
    manager: requireString(caseName, entry.manager, field('manager')),
    depName: requireString(caseName, entry.depName, field('depName')),
    packageFile: optionalString(caseName, entry.packageFile, field('packageFile')),
    minUpdates,
    newValue,
    branchName: optionalString(caseName, entry.branchName, field('branchName')),
    updateTypes: updateTypes as string[] | undefined,
  };
}

/** Validates a fixture's `case.json`. Throws on the first problem, naming the fixture and field. */
export function parseLookupCase(name: string, raw: unknown): LookupCase {
  if (raw === null || typeof raw !== 'object') {
    fail(name, 'case.json must contain an object.');
  }

  const data = raw as Record<string, unknown>;

  const { presets } = data;
  if (!Array.isArray(presets) || presets.length === 0) {
    fail(name, "'presets' must be a non-empty array.");
  }
  for (const preset of presets) {
    if (typeof preset !== 'string' || !PRESET_NAME.test(preset)) {
      fail(name, `'presets' entry '${String(preset)}' is not a preset name.`);
    }
  }

  const { files } = data;
  if (files === null || typeof files !== 'object' || Array.isArray(files) || Object.keys(files).length === 0) {
    fail(name, "'files' must be a non-empty object.");
  }
  const fileMap: Record<string, string> = {};
  for (const [destination, source] of Object.entries(files)) {
    if (!isContainedPath(destination)) {
      fail(name, `'files' destination '${destination}' must be a relative path inside the fixture repository.`);
    }
    if (destination === 'renovate.json') {
      fail(name, "'files' must not provide renovate.json; it is generated from 'presets'.");
    }
    if (typeof source !== 'string' || !isContainedPath(source) || source === 'case.json') {
      fail(name, `'files' source for '${destination}' must be a file inside the fixture directory.`);
    }
    fileMap[destination] = source;
  }

  const { dependencies } = data;
  if (!Array.isArray(dependencies) || dependencies.length === 0) {
    fail(name, "'dependencies' must be a non-empty array.");
  }

  return {
    name,
    description: requireString(name, data.description, 'description'),
    presets: presets as string[],
    files: fileMap,
    dependencies: dependencies.map((entry, index) => parseDependency(name, entry, index)),
  };
}

// ---------------------------------------------------------------------------
// Report evaluation
// ---------------------------------------------------------------------------

/** The subset of Renovate's `--report-type=file` output the checks read. */
export interface RenovateReport {
  problems?: ReportProblem[];
  repositories?: Record<string, ReportRepository>;
}

export interface ReportProblem {
  level: number;
  msg: string;
}

export interface ReportRepository {
  problems?: ReportProblem[];
  packageFiles?: Record<string, ReportPackageFile[]>;
}

export interface ReportPackageFile {
  packageFile: string;
  deps?: ReportDependency[];
}

export interface ReportDependency {
  depName?: string;
  currentValue?: string;
  warnings?: { message?: string; topic?: string }[];
  updates?: ReportUpdate[];
}

export interface ReportUpdate {
  newValue?: string;
  branchName?: string;
  updateType?: string;
}

interface LocatedDependency {
  manager: string;
  packageFile: string;
  dependency: ReportDependency;
}

function locate(repository: ReportRepository): LocatedDependency[] {
  const located: LocatedDependency[] = [];

  for (const [manager, packageFiles] of Object.entries(repository.packageFiles ?? {})) {
    for (const packageFile of packageFiles) {
      for (const dependency of packageFile.deps ?? []) {
        located.push({ manager, packageFile: packageFile.packageFile, dependency });
      }
    }
  }

  return located;
}

function label(entry: { manager: string; packageFile?: string; depName?: string }): string {
  return `${entry.manager} ${entry.depName ?? '<unnamed>'}${entry.packageFile ? ` (${entry.packageFile})` : ''}`;
}

function checkExpectation(expectation: DependencyExpectation, candidates: LocatedDependency[]): string[] {
  const matches = candidates.filter(
    (candidate) =>
      candidate.manager === expectation.manager &&
      candidate.dependency.depName === expectation.depName &&
      (expectation.packageFile === undefined || candidate.packageFile === expectation.packageFile),
  );

  if (matches.length !== 1) {
    return [`${label(expectation)}: expected exactly one extracted dependency, found ${matches.length}.`];
  }

  const { updateTypes } = expectation;
  const updates = (matches[0].dependency.updates ?? []).filter(
    (update) => updateTypes === undefined || updateTypes.includes(update.updateType ?? ''),
  );
  const failures: string[] = [];

  if (updates.length < expectation.minUpdates) {
    failures.push(
      `${label(expectation)}: expected at least ${expectation.minUpdates} update(s), found ${updates.length}.`,
    );
  }

  const newValuePattern =
    // eslint-disable-next-line security/detect-non-literal-regexp -- Pattern comes from a committed fixture, matched against short tag names.
    expectation.newValue === undefined ? undefined : new RegExp(expectation.newValue);
  for (const update of updates) {
    if (newValuePattern && !newValuePattern.test(update.newValue ?? '')) {
      failures.push(`${label(expectation)}: update to '${update.newValue}' does not match /${expectation.newValue}/.`);
    }
    if (expectation.branchName !== undefined && update.branchName !== expectation.branchName) {
      failures.push(
        `${label(expectation)}: update to '${update.newValue}' is on branch '${update.branchName}', expected '${expectation.branchName}'.`,
      );
    }
  }

  return failures;
}

/**
 * Every way `report` falls short of `lookupCase`; empty when it meets it.
 *
 * Beyond the per-dependency expectations, any problem at warn level or above and any lookup warning
 * on any dependency fails the case. Those are what reach a consumer's Dependency Dashboard as
 * "Repository Problems" and "Renovate failed to look up the following dependencies".
 */
export function evaluateReport(lookupCase: LookupCase, report: RenovateReport): string[] {
  const repositories = Object.values(report.repositories ?? {});
  if (repositories.length !== 1) {
    return [`expected one repository in the report, found ${repositories.length}.`];
  }

  const [repository] = repositories;
  const failures: string[] = [];

  for (const problem of [...(report.problems ?? []), ...(repository.problems ?? [])]) {
    if (problem.level >= WARN_LEVEL) {
      failures.push(`problem: ${problem.msg}`);
    }
  }

  const located = locate(repository);

  for (const { manager, packageFile, dependency } of located) {
    for (const warning of dependency.warnings ?? []) {
      failures.push(
        `${label({ manager, packageFile, depName: dependency.depName })}: lookup warning: ${warning.message ?? warning.topic ?? 'unknown'}`,
      );
    }
  }

  for (const expectation of lookupCase.dependencies) {
    failures.push(...checkExpectation(expectation, located));
  }

  return failures;
}
