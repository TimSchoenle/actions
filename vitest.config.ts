import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      // `tsc` and `bun build` resolve the workspace package through the tsconfig `paths` mapping and
      // so compile it from source. Vite reads no tsconfig `paths`, and would fall back to the
      // package's `exports` entry — `packages/ts-util/dist`, which is gitignored and never built in
      // CI. Mapping it to the same source keeps every toolchain on one copy of the code.
      'actions-util': fileURLToPath(new URL('./packages/ts-util/src/index.ts', import.meta.url)),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
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
