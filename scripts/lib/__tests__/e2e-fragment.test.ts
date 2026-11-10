import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import { fragmentLocalRefs, injectInstallSteps, installStepLines } from '../e2e-fragment.js';

const FRAGMENT = `first:
  name: First
  runs-on: ubuntu-latest
  steps:
    - name: Harden Runner
      uses: step-security/harden-runner@x
      with:
        egress-policy: block
        allowed-endpoints: >
          github.com:443

    - name: Checkout
      uses: actions/checkout@x
      with:
        persist-credentials: false

    # A comment that belongs to the next step.
    - name: Run It
      uses: ./actions/common/create-patch

second:
  name: Second
  needs: first
  runs-on: ubuntu-latest
  steps:
    - name: Checkout
      uses: pinned:checkout
      with:
        path: source
    - uses: ./source/actions/common/fetch-head
    - uses: ./round-trip/actions/demo

third:
  needs:
    - first
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@x
    - uses: ./actions/common/read-yaml
`;

describe('fragmentLocalRefs', () => {
  it('finds the repository actions each job runs, per checkout, and skips what a step wrote', () => {
    expect(fragmentLocalRefs(FRAGMENT)).toEqual([
      { job: 'first', prefix: '.', action: 'actions/common/create-patch' },
      { job: 'second', prefix: 'source', action: 'actions/common/fetch-head' },
      { job: 'third', prefix: '.', action: 'actions/common/read-yaml' },
    ]);
  });

  it('reads nothing from an empty fragment and refuses one that is not a mapping', () => {
    expect(fragmentLocalRefs('')).toEqual([]);
    expect(() => fragmentLocalRefs('- a\n')).toThrow(/mapping of jobs/);
  });
});

describe('injectInstallSteps', () => {
  const injected = injectInstallSteps(
    FRAGMENT,
    new Map([
      ['first', ['.']],
      ['second', ['source']],
      ['third', ['.']],
    ]),
  );
  const jobs = parse(injected) as Record<string, { needs: unknown; steps: Array<Record<string, unknown>> }>;

  it('puts the install step right after the checkout, before the comment of the next step', () => {
    expect(jobs['first'].steps.map((step) => step['name'] ?? step['uses'])).toEqual([
      'Harden Runner',
      'Checkout',
      'Install Built Actions',
      'Run It',
    ]);
    expect(injected).toContain(
      `${installStepLines('    ', '.').join('\n')}\n\n    # A comment that belongs to the next step.`,
    );
  });

  it('installs into the checkout the job runs the action from', () => {
    expect(jobs['second'].steps[1]).toEqual({
      name: 'Install Built Actions',
      uses: './source/actions/release/install-built-actions',
      with: {
        'artifact-id': '${{ needs.build.outputs.artifact-id }}',
        'expected-manifest-sha256': '${{ needs.build.outputs.manifest-sha256 }}',
        path: 'source',
      },
    });
  });

  it('makes every job need build, whatever form its needs took', () => {
    expect(jobs['first'].needs).toBe('build');
    expect(jobs['second'].needs).toEqual(['build', 'first']);
    expect(jobs['third'].needs).toEqual(['build', 'first']);
  });

  it('adds the artifact endpoints to a block allowlist', () => {
    expect(injected).toContain(
      '        allowed-endpoints: >\n          github.com:443\n          *.actions.githubusercontent.com:443\n          *.blob.core.windows.net:443\n',
    );
  });

  it('keeps a flow list of needs in flow form', () => {
    const fragment = 'job:\n  needs: [a, b]\n  steps:\n    - uses: actions/checkout@x\n    - uses: ./actions/x\n';

    expect(injectInstallSteps(fragment, new Map([['job', ['.']]]))).toContain('  needs: [build, a, b]\n');
  });

  it('leaves a fragment alone when nothing needs installing', () => {
    expect(injectInstallSteps(FRAGMENT, new Map())).toBe(FRAGMENT);
  });

  it('refuses a job without a checkout where it runs the action from', () => {
    expect(() => injectInstallSteps(FRAGMENT, new Map([['first', ['elsewhere']]]))).toThrow(
      /Extra job first runs this repository's actions from elsewhere but never checks the repository out there/,
    );
    expect(() => injectInstallSteps('job:\n  runs-on: x\n', new Map([['job', ['.']]]))).toThrow(/has no steps/);
    expect(() => injectInstallSteps(FRAGMENT, new Map([['missing', ['.']]]))).toThrow(/not in the fragment/);
  });
});
