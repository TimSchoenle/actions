import { defineConfig } from 'vitest/config';

import { E2E_TEST_PATTERN, workspaceAliases } from './vitest.aliases.js';

/** A case waits on real GitHub API calls, several per assertion; the unit default of 5s is useless. */
const CASE_TIMEOUT_MS = 180_000;

export default defineConfig({
  resolve: {
    alias: workspaceAliases,
  },
  test: {
    globals: true,
    environment: 'node',
    include: [E2E_TEST_PATTERN],
    globalSetup: ['./vitest.e2e.setup.ts'],
    testTimeout: CASE_TIMEOUT_MS,
    hookTimeout: CASE_TIMEOUT_MS,
    // One file per action, and the cases inside a file share a scratch namespace. Files may run in
    // parallel; the cases within one must not, because several of them move the same branch.
    fileParallelism: true,
    sequence: {
      concurrent: false,
    },
    // A run that creates refs in a real repository is not worth retrying blindly: a rerun of the
    // whole file is cheap and leaves the teardown in charge.
    retry: 0,
  },
});
