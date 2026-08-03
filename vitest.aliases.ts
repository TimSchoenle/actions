import { fileURLToPath } from 'node:url';

import type { Alias } from 'vite';

/**
 * Resolution for the workspace packages, shared by the unit and end-to-end vitest configs.
 *
 * `tsc` and `bun build` resolve these through the tsconfig `paths` mapping and so compile them from
 * source. Vite reads no tsconfig `paths`, and would fall back to each package's `exports` entry —
 * `dist`, which is gitignored and never built in CI. Mapping them to the same source keeps every
 * toolchain on one copy of the code.
 *
 * Declared as an ordered array, not an object: an alias also matches every subpath beneath it, so a
 * bare `actions-util` entry would rewrite `actions-util/branches` to `…/index.ts/branches`. The
 * specific entries have to be tried first.
 */
export const workspaceAliases: Alias[] = [
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
    find: 'actions-util/client',
    replacement: fileURLToPath(new URL('./packages/ts-util/src/github-client.ts', import.meta.url)),
  },
  {
    find: 'actions-util/read-after-write',
    replacement: fileURLToPath(new URL('./packages/ts-util/src/read-after-write.ts', import.meta.url)),
  },
  {
    find: 'actions-util',
    replacement: fileURLToPath(new URL('./packages/ts-util/src/index.ts', import.meta.url)),
  },
  {
    find: 'actions-e2e',
    replacement: fileURLToPath(new URL('./packages/e2e/src/index.ts', import.meta.url)),
  },
];

/** Cases that talk to a real repository, kept out of the unit suite and run by `bun run e2e`. */
export const E2E_TEST_PATTERN = '**/*.e2e.test.ts';
