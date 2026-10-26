import { configDefaults, defineConfig } from 'vitest/config';

import { E2E_TEST_PATTERN, workspaceAliases } from './vitest.aliases.js';

export default defineConfig({
  resolve: {
    alias: workspaceAliases,
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
      ],
    },
  },
});
