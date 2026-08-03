/**
 * Locating the two files the action is allowed to touch.
 *
 * `chart-path` is the only path the caller supplies; the file names beneath it are fixed. That is
 * deliberate — it reduces path handling to one question ("does this stay inside the checkout?")
 * instead of two, and there is no legitimate reason for this action to write anything in a chart
 * repository other than a chart's `Chart.yaml` and `values.yaml`.
 */
import { relative, resolve } from 'node:path';

import { loadYaml, resolveWithinWorkspace } from 'actions-util';

export const CHART_FILE_NAME = 'Chart.yaml';
export const VALUES_FILE_NAME = 'values.yaml';

/**
 * Raised when `chart-path` escapes, or could escape, the workspace.
 *
 * Re-exported from `actions-util` rather than declared here: the containment rule is shared with
 * every other action that takes a path, and two classes with the same name would let a caller catch
 * the wrong one.
 */
export { UnsafePathError } from 'actions-util';

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
 * The containment rule itself is `resolveWithinWorkspace`; what is left here is the part specific to
 * a chart — that the directory holds exactly two files with fixed names, and that their paths are
 * also needed relative to the repository root for the commit step's file pattern.
 *
 * @throws {UnsafePathError} if `chart-path` is empty, absolute, or leaves the workspace.
 */
export function resolveChartFiles(chartPath: string, workspace: string): ChartFiles {
  const root = resolve(workspace);
  const chartDir = resolveWithinWorkspace(chartPath, root, 'chart-path');
  const fromRoot = relative(root, chartDir);

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
