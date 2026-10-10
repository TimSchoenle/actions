/**
 * Builds the CodeQL configuration `codeql-action/init` receives through its `config` input.
 *
 * The configuration travels inline rather than as a file in this repository: `init` resolves a
 * remote `config-file` at a ref of its own, which would be a second pin beside the one the caller
 * already wrote for this action, free to drift from it.
 */
import { TEST_PATHS } from './test-paths.js';

import type { AnalysisOptions } from './options.js';

/** The subset of the CodeQL configuration file this action writes. */
export interface CodeqlConfig {
  readonly name: string;
  readonly 'paths-ignore'?: readonly string[];
}

/** Name the configuration is reported under in the CodeQL log. */
const CONFIG_NAME = 'TimSchoenle/actions security/codeql';

/** The excluded patterns: the shared test paths when enabled, then the caller's, each kept once. */
export function excludedPaths(options: AnalysisOptions): string[] {
  const paths = options.excludeTestPaths ? [...TEST_PATHS] : [];

  for (const pattern of options.pathsIgnore) {
    if (!paths.includes(pattern)) {
      paths.push(pattern);
    }
  }

  return paths;
}

/** The configuration for one analysis. An empty exclusion list leaves `paths-ignore` out. */
export function buildConfig(options: AnalysisOptions): CodeqlConfig {
  const paths = excludedPaths(options);

  return paths.length === 0 ? { name: CONFIG_NAME } : { name: CONFIG_NAME, 'paths-ignore': paths };
}

/**
 * Serialises the configuration for the `config` input.
 *
 * JSON is valid YAML, and on one line it fits a step output without a heredoc delimiter that a
 * pattern could collide with.
 */
export function renderConfig(config: CodeqlConfig): string {
  return JSON.stringify(config);
}
