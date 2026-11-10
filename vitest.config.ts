import { fileURLToPath } from 'node:url';

import { configDefaults, defineConfig } from 'vitest/config';

import { E2E_TEST_PATTERN, workspaceAliases } from './vitest.aliases.js';

import type { Alias } from 'vite';

/**
 * Temporary, for the unit suite only, while the actions move off the toolkit in stages.
 *
 * `actions-util` already reports through `actions-util/core` and builds its client from
 * `actions-util/octokit`. An action that still imports `@actions/core`, or whose tests mock
 * `@actions/github`, would otherwise mock a module `actions-util` no longer calls, and its tests
 * would miss every failure `runAction` reports. Resolving both specifiers to the replacements keeps
 * one module per role under test. Removed once the last action is migrated.
 */
const toolkitBridge: Alias[] = [
  {
    find: /^@actions\/core$/,
    replacement: fileURLToPath(new URL('./packages/ts-util/src/core.ts', import.meta.url)),
  },
  {
    find: /^@actions\/github$/,
    replacement: fileURLToPath(new URL('./packages/ts-util/src/octokit.ts', import.meta.url)),
  },
];

export default defineConfig({
  resolve: {
    alias: [...toolkitBridge, ...workspaceAliases],
  },
  test: {
    globals: true,
    environment: 'node',
    // End-to-end cases need credentials and a scratch repository, so they are not part of the unit
    // suite. `vitest.e2e.config.ts` runs them.
    exclude: [...configDefaults.exclude, E2E_TEST_PATTERN],
    // The Coverage Tests job in scripts-ci.yml hands the JUnit file and `lcov.info` to the Coverage
    // job as an artifact, and that job uploads them to Codecov.
    reporters: ['default', 'junit'],
    outputFile: {
      junit: 'coverage/junit.xml',
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      include: ['scripts/**/*.ts', 'actions/**/src/**/*.ts', 'packages/**/src/**/*.ts'],
      exclude: [
        '**/*.test.ts',
        'scripts/templates/**',
        // Bundled entry points, generated code and build output carry no logic worth covering.
        'actions/**/src/generated/**',
        'actions/**/dist/**',
        'packages/**/dist/**',
        // A two-line entry point; the step it runs is ./scripts/lib/ci-required-registration-step.ts.
        'scripts/ci-required-registration.ts',
        // Likewise; the step it runs is ./scripts/lib/release-tags.ts.
        'scripts/wait-release-tags.ts',
      ],
    },
  },
});
