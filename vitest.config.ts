import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // `tsc` and `bun build` resolve the workspace package through the tsconfig `paths` mapping and
    // so compile it from source. Vite reads no tsconfig `paths`, and would fall back to the
    // package's `exports` entry — `packages/ts-util/dist`, which is gitignored and never built in
    // CI. Mapping it to the same source keeps every toolchain on one copy of the code.
    //
    // Declared as an ordered array, not an object: an alias also matches every subpath beneath it, so
    // a bare `actions-util` entry would rewrite `actions-util/branches` to `…/index.ts/branches`. The
    // specific entry has to be tried first.
    alias: [
      {
        find: 'actions-util/branches',
        replacement: fileURLToPath(new URL('./packages/ts-util/src/github-branches.ts', import.meta.url)),
      },
      {
        find: 'actions-util/identity',
        replacement: fileURLToPath(new URL('./packages/ts-util/src/github-identity.ts', import.meta.url)),
      },
      {
        find: 'actions-util/commits',
        replacement: fileURLToPath(new URL('./packages/ts-util/src/github-commits.ts', import.meta.url)),
      },
      {
        find: 'actions-util',
        replacement: fileURLToPath(new URL('./packages/ts-util/src/index.ts', import.meta.url)),
      },
    ],
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
