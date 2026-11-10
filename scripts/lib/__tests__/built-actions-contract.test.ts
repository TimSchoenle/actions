import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { builtActionsViolations } from '../built-actions-contract.js';
import { ROOT_DIR } from '../utils.js';

const WORKFLOWS_DIR = path.join(ROOT_DIR, '.github', 'workflows');

/** A workflow with a build job building `buildDirs` and a test job running `steps` after a checkout. */
function workflow(buildDirs: string[], steps: string, checkout = '      - uses: actions/checkout@x\n'): string {
  return `on: push
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: ./actions/release/build-actions
        with:
          build-dirs: |
${buildDirs.map((dir) => `            ${dir}`).join('\n')}
          build-command: bun run build
          artifact-name: x
  test:
    needs: [build]
    runs-on: ubuntu-latest
    steps:
${checkout}${steps}`;
}

const INSTALL = `      - uses: ./actions/release/install-built-actions
        with:
          artifact-id: \${{ needs.build.outputs.artifact-id }}
          expected-manifest-sha256: \${{ needs.build.outputs.manifest-sha256 }}
`;

describe('builtActionsViolations', () => {
  it('holds for every workflow in the repository', () => {
    const files = fs.readdirSync(WORKFLOWS_DIR).filter((file) => /\.ya?ml$/.test(file));
    const violations = files.flatMap((file) =>
      builtActionsViolations(fs.readFileSync(path.join(WORKFLOWS_DIR, file), 'utf8'), ROOT_DIR).map(
        (violation) => `${file} ${violation.job}[${violation.step}] ${violation.uses}: ${violation.reason}`,
      ),
    );

    expect(violations).toEqual([]);
  });

  it('accepts a bundled action after an install of a build that covers it', () => {
    const content = workflow(
      ['actions/common/create-patch/helper'],
      `${INSTALL}      - uses: ./actions/common/create-patch\n`,
    );

    expect(builtActionsViolations(content, ROOT_DIR)).toEqual([]);
  });

  it('ignores an action without a bundle and one written into the workspace at run time', () => {
    const content = workflow([], '      - uses: ./actions/bun/setup-cached\n      - uses: ./round-trip/actions/demo\n');

    expect(builtActionsViolations(content, ROOT_DIR)).toEqual([]);
  });

  it('reports a bundled action with no install before it', () => {
    const content = workflow(
      ['actions/common/create-patch/helper'],
      `      - uses: ./actions/common/create-patch\n${INSTALL}`,
    );

    expect(builtActionsViolations(content, ROOT_DIR)).toEqual([
      expect.objectContaining({
        job: 'test',
        step: 1,
        reason: expect.stringContaining('no earlier install-built-actions into .'),
      }),
    ]);
  });

  it('reports an install from a build that does not cover the action', () => {
    const content = workflow(['actions/common/read-yaml'], `${INSTALL}      - uses: ./actions/common/create-patch\n`);

    expect(builtActionsViolations(content, ROOT_DIR)).toEqual([
      expect.objectContaining({ reason: expect.stringContaining('cover actions/common/create-patch/helper') }),
    ]);
  });

  it('reports an install into another checkout than the one the action runs from', () => {
    const checkout = '      - uses: actions/checkout@x\n        with:\n          path: tmp/actions-code\n';
    const content = workflow(
      ['actions/common/commit-changes'],
      `${INSTALL}      - uses: ./tmp/actions-code/actions/common/commit-changes\n`,
      checkout,
    );

    expect(builtActionsViolations(content, ROOT_DIR)).toEqual([
      expect.objectContaining({
        reason: expect.stringContaining('no earlier install-built-actions into tmp/actions-code'),
      }),
    ]);
  });

  it('accepts an install into the checkout setup-e2e makes', () => {
    const checkout =
      '      - uses: TimSchoenle/actions/actions/test/setup-e2e@x\n        with:\n          current_repo_checkout_path: tmp/actions-code\n';
    const install = INSTALL.replace('./actions/release', './tmp/actions-code/actions/release').concat(
      '          path: tmp/actions-code\n',
    );
    const content = workflow(
      ['actions/common/commit-changes'],
      `${install}      - uses: ./tmp/actions-code/actions/common/commit-changes\n`,
      checkout,
    );

    expect(builtActionsViolations(content, ROOT_DIR)).toEqual([]);
  });

  it('reports an install that reads a job the job does not need', () => {
    const content = workflow(
      ['actions/common/read-yaml'],
      `${INSTALL}      - uses: ./actions/common/read-yaml\n`,
    ).replace('needs: [build]', 'needs: []');

    expect(builtActionsViolations(content, ROOT_DIR)).toHaveLength(1);
  });
});
