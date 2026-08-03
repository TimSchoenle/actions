/**
 * Locating the two files the action is allowed to touch.
 *
 * `chart-path` is the only path the caller supplies; the file names beneath it are fixed. That is
 * deliberate — it reduces path handling to one question ("does this stay inside the checkout?")
 * instead of two, and there is no legitimate reason for this action to write anything in a chart
 * repository other than a chart's `Chart.yaml` and `values.yaml`.
 */
import { isAbsolute, relative, resolve } from 'node:path';

import { loadYaml } from 'actions-util';

export const CHART_FILE_NAME = 'Chart.yaml';
export const VALUES_FILE_NAME = 'values.yaml';

/** Raised when `chart-path` escapes, or could escape, the workspace. */
export class UnsafePathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafePathError';
  }
}

/** The files of one chart, as absolute paths, plus the repository-relative paths to report. */
export interface ChartFiles {
  readonly chartFile: string;
  readonly valuesFile: string;
  /** Repository-relative, POSIX-separated: what a commit file pattern needs. */
  readonly relativePaths: readonly string[];
}

/**
 * Resolves the chart's files beneath `workspace`.
 *
 * Both a syntactic check (no absolute path, no `..` segment) and a check on the resolved result are
 * applied. The syntactic one gives a clear error; the resolved one is what actually holds, and
 * catches anything the first did not anticipate.
 */
export function resolveChartFiles(chartPath: string, workspace: string): ChartFiles {
  const trimmed = chartPath.trim();

  if (trimmed === '') {
    throw new UnsafePathError('chart-path must not be empty');
  }

  if (isAbsolute(trimmed) || /^[A-Za-z]:/.test(trimmed)) {
    throw new UnsafePathError(`chart-path must be relative to the repository, got '${chartPath}'`);
  }

  if (trimmed.split(/[/\\]/).includes('..')) {
    throw new UnsafePathError(`chart-path must not traverse upwards, got '${chartPath}'`);
  }

  const root = resolve(workspace);
  const chartDir = resolve(root, trimmed);
  const fromRoot = relative(root, chartDir);

  if (fromRoot.startsWith('..') || isAbsolute(fromRoot)) {
    throw new UnsafePathError(`chart-path resolves outside the workspace: '${chartPath}'`);
  }

  const prefix = fromRoot === '' ? '' : `${fromRoot.split('\\').join('/')}/`;

  return {
    chartFile: resolve(chartDir, CHART_FILE_NAME),
    valuesFile: resolve(chartDir, VALUES_FILE_NAME),
    relativePaths: [`${prefix}${CHART_FILE_NAME}`, `${prefix}${VALUES_FILE_NAME}`],
  };
}

/** Raised when `Chart.yaml` has no usable `version`. */
export class MissingChartVersionError extends Error {
  constructor(readonly filePath: string) {
    super(`No 'version' field in ${filePath}`);
    this.name = 'MissingChartVersionError';
  }
}

/** Reads the current `version` from a `Chart.yaml`, so the bump has something to bump. */
export async function readChartVersion(chartFile: string): Promise<string> {
  const { document } = await loadYaml(chartFile);
  const version = document.getIn(['version']);

  if (typeof version !== 'string' && typeof version !== 'number') {
    throw new MissingChartVersionError(chartFile);
  }

  return String(version);
}
