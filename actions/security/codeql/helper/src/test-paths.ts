/**
 * The test locations excluded when `exclude-test-paths` is on.
 *
 * CodeQL decides what is sensitive from names and literals. A fixture key raises
 * `rust/hard-coded-cryptographic-value`, and an assertion message that formats a value named
 * `secret` raises `rust/cleartext-logging`, exactly as production code would, and default setup
 * offers no way to exclude either from a repository owned by a personal account.
 *
 * Each pattern is a location a toolchain discovers tests in by default, or the name a test module is
 * given by convention. `paths-ignore` matches whole files, so a `#[cfg(test)] mod tests { ... }` block written
 * inside a production source file is still analysed.
 */
export const TEST_PATHS: readonly string[] = [
  // Cargo: integration tests and benchmarks, by the directories Cargo discovers them in.
  '**/tests/**',
  '**/benches/**',
  // Rust unit-test modules kept in a file of their own: `tests.rs` for `mod tests;`, or one named
  // after the module it tests.
  '**/tests.rs',
  '**/*_tests.rs',
  '**/*_test.rs',
  // Gradle and Maven: the `test` source set, and the one `java-test-fixtures` adds.
  '**/src/test/**',
  '**/src/testFixtures/**',
  // Vitest and Jest: their default `include` globs.
  '**/__tests__/**',
  '**/*.test.*',
  '**/*.spec.*',
];
