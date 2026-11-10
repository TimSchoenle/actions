import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { e2eLocalRefs, workflowLocalRefs } from './local-refs.js';

const REPOSITORY = fileURLToPath(new URL('../../..', import.meta.url));

describe('workflowLocalRefs', () => {
  const workflow = `
on: push
jobs:
  first:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@0000000000000000000000000000000000000000
      - uses: ./actions/common/create-patch # a comment
      - run: echo
      - uses: ./tmp/actions-code/actions/common/commit-patch
  second:
    uses: ./.github/workflows/reusable.yml
  third:
    runs-on: ubuntu-latest
    steps:
      - uses: ./tmp/actions-code/nested/actions/x
`;

  it('lists local steps with their job, index and checkout prefix', () => {
    expect(workflowLocalRefs(workflow, ['tmp/actions-code', 'tmp/actions-code/nested'])).toEqual([
      {
        job: 'first',
        step: 1,
        uses: './actions/common/create-patch',
        prefix: '.',
        action: 'actions/common/create-patch',
      },
      {
        job: 'first',
        step: 3,
        uses: './tmp/actions-code/actions/common/commit-patch',
        prefix: 'tmp/actions-code',
        action: 'actions/common/commit-patch',
      },
      {
        job: 'third',
        step: 0,
        uses: './tmp/actions-code/nested/actions/x',
        prefix: 'tmp/actions-code/nested',
        action: 'actions/x',
      },
    ]);
  });

  it('keeps the full path when no prefix is given', () => {
    expect(workflowLocalRefs(workflow).map((ref) => ref.action)).toEqual([
      'actions/common/create-patch',
      'tmp/actions-code/actions/common/commit-patch',
      'tmp/actions-code/nested/actions/x',
    ]);
  });

  it('resolves a reference to the checkout prefix itself to the root action of that checkout', () => {
    const rootAction = 'jobs:\n  j:\n    steps:\n      - uses: ./tmp/actions-code\n      - uses: ./tmp/actions-codex\n';

    expect(workflowLocalRefs(rootAction, ['tmp/actions-code'])).toEqual([
      { job: 'j', step: 0, uses: './tmp/actions-code', prefix: 'tmp/actions-code', action: '.' },
      { job: 'j', step: 1, uses: './tmp/actions-codex', prefix: '.', action: 'tmp/actions-codex' },
    ]);
  });

  it('returns nothing for a document without jobs', () => {
    expect(workflowLocalRefs('name: x\n')).toEqual([]);
  });
});

describe('e2eLocalRefs', () => {
  it('resolves string-literal URLs against the test directory', () => {
    const source = `
      const A = fileURLToPath(new URL('../helper', import.meta.url));
      const B = fileURLToPath(new URL("../../create-patch/helper", import.meta.url));
      const C = new URL(\`../\${name}\`, import.meta.url);
      const D = new URL('https://example.com', import.meta.url);
      const E = new URL('../../../../../../escape', import.meta.url);
    `;

    expect(e2eLocalRefs(source, 'actions/common/commit-patch/e2e')).toEqual([
      'actions/common/commit-patch/helper',
      'actions/common/create-patch/helper',
    ]);
  });

  it('finds the sibling helper the commit-patch cases run', () => {
    const file = 'actions/common/commit-patch/e2e/commit-patch.e2e.test.ts';
    const source = fs.readFileSync(`${REPOSITORY}/${file}`, 'utf8');

    expect(e2eLocalRefs(source, 'actions/common/commit-patch/e2e')).toContain('actions/common/create-patch/helper');
  });
});
