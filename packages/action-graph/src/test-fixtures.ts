/**
 * Builds throwaway repositories on disk for the tests of this package.
 *
 * @packageDocumentation
 */
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/** Writes `files` (repository-relative path to content) under a new temporary directory and returns it. */
export function createRepository(files: Readonly<Record<string, string>>): string {
  const root = fs.mkdtempSync(path.join(tmpdir(), 'action-graph-'));
  writeFiles(root, files);

  return root;
}

/** Writes `files` under `root`, creating directories as needed. */
export function writeFiles(root: string, files: Readonly<Record<string, string>>): void {
  for (const [file, content] of Object.entries(files)) {
    const target = path.join(root, ...file.split('/'));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
}

/** Removes a repository created by {@link createRepository}. */
export function removeRepository(root: string): void {
  fs.rmSync(root, { recursive: true, force: true });
}

/** A JavaScript action manifest with the given entry points. */
export function nodeAction(main = 'dist/index.js', extra: Readonly<Record<string, string>> = {}): string {
  const lines = Object.entries({ main, ...extra }).map(([key, value]) => `  ${key}: '${value}'`);

  return ['name: test', 'runs:', "  using: 'node24'", ...lines, ''].join('\n');
}

/** A composite action manifest whose steps are the given `uses:` references and `run:` scripts. */
export function compositeAction(steps: ReadonlyArray<{ uses: string } | { run: string }>): string {
  const rendered = steps.map((step) =>
    'uses' in step ? `    - uses: ${step.uses}` : `    - shell: bash\n      run: ${JSON.stringify(step.run)}`,
  );

  return ['name: test', 'runs:', "  using: 'composite'", '  steps:', ...rendered, ''].join('\n');
}
