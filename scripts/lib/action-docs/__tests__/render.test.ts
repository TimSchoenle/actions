import { describe, expect, it } from 'vitest';

import { describeCondition, renderRegions, usesReference } from '../render.js';

import type { Condition } from '../docs-file.js';
import type { ReadmeModel } from '../render.js';

const SHA = '0123456789abcdef0123456789abcdef01234567';

function model(overrides: Partial<ReadmeModel> = {}): ReadmeModel {
  return {
    repoId: 'Owner/actions',
    actionPath: 'actions/security/zizmor',
    manifest: {
      name: 'Security Zizmor',
      description: 'Runs zizmor.',
      runtime: 'composite',
      inputs: [
        { name: 'inputs', description: 'Paths to audit.', required: false, default: '.' },
        { name: 'config', description: 'Config | file.', required: true, default: undefined },
        { name: 'empty', description: 'Empty default.', required: false, default: '' },
      ],
      outputs: [{ name: 'findings', description: 'Number of results.' }],
    },
    release: { tag: 'actions-security-zizmor-v2.0.2', sha: SHA },
    docs: undefined,
    examples: [],
    hasChangelog: true,
    e2eWorkflow: undefined,
    callers: [],
    ...overrides,
  };
}

describe('usesReference', () => {
  it('pins the commit and repeats the tag', () => {
    expect(usesReference(model())).toBe(
      `Owner/actions/actions/security/zizmor@${SHA} # tag=actions-security-zizmor-v2.0.2`,
    );
  });

  it('falls back to the tag when it does not resolve locally', () => {
    expect(usesReference(model({ release: { tag: 't-v1', sha: undefined } }))).toBe(
      'Owner/actions/actions/security/zizmor@t-v1 # tag=t-v1',
    );
  });

  it('uses a placeholder before the first release', () => {
    expect(usesReference(model({ release: undefined }))).toBe('Owner/actions/actions/security/zizmor@<ref>');
  });
});

describe('describeCondition', () => {
  const cases: [Condition, string][] = [
    ['always', 'always'],
    [{ input: 'upload', equals: 'true' }, '`upload` is `true`'],
    [{ repository: 'private' }, 'the repository is private'],
    [{ input: 'run_id', set: true }, '`run_id` is set'],
    [
      { all: [{ input: 'upload', equals: 'true' }, { repository: 'private' }] },
      '`upload` is `true` and the repository is private',
    ],
  ];

  it.each(cases)('renders %j', (condition, expected) => {
    expect(describeCondition(condition)).toBe(expected);
  });
});

describe('renderRegions', () => {
  it('renders the header from the manifest and release', () => {
    expect(renderRegions(model()).header).toBe(
      [
        '# Security Zizmor',
        'Runs zizmor.',
        '[actions-security-zizmor-v2.0.2](https://github.com/Owner/actions/releases/tag/actions-security-zizmor-v2.0.2) · Composite action',
      ].join('\n\n'),
    );
  });

  it('folds a multi-line description into one paragraph', () => {
    const header = renderRegions(
      model({ manifest: { ...model().manifest, description: 'Line one\n<!-- /docs:generated header -->\nline two' } }),
    ).header;
    expect(header.split('\n')).toContain('Line one <!-- /docs:generated header --> line two');
  });

  it('adds runner requirements to the header and says when nothing is released', () => {
    const header = renderRegions(
      model({
        release: undefined,
        manifest: { ...model().manifest, runtime: 'node24' },
        docs: { permissions: [], egress: [], requires: ['linux', 'docker'], examples: [] },
      }),
    ).header;
    expect(header.split('\n\n').at(-1)).toBe(
      'Not released yet · JavaScript action (node24) · Linux runners only · needs Docker',
    );
  });

  it('generates a minimal usage block listing required inputs without a default', () => {
    expect(renderRegions(model()).usage).toBe(
      [
        '## Usage',
        '',
        '```yaml',
        `- uses: Owner/actions/actions/security/zizmor@${SHA} # tag=actions-security-zizmor-v2.0.2`,
        '  with:',
        '    config: # required, see Inputs',
        '```',
      ].join('\n'),
    );
  });

  it('renders examples instead of the minimal block when there are any', () => {
    const usage = renderRegions(model({ examples: [{ title: 'Basic', content: 'name: x\n' }] })).usage;
    expect(usage).toBe('## Usage\n\n### Basic\n\n```yaml\nname: x\n```');
  });

  it('renders inputs with escaped cells and blank defaults', () => {
    expect(renderRegions(model()).inputs).toBe(
      [
        '## Inputs',
        '',
        '| Input    | Required | Default | Description     |',
        '| -------- | -------- | ------- | --------------- |',
        '| `inputs` | no       | `.`     | Paths to audit. |',
        String.raw`| ` + '`config`' + String.raw` | yes      |         | Config \| file. |`,
        '| `empty`  | no       |         | Empty default.  |',
      ].join('\n'),
    );
  });

  it('says so when there are no inputs or outputs', () => {
    const regions = renderRegions(model({ manifest: { ...model().manifest, inputs: [], outputs: [] } }));
    expect(regions.inputs).toBe('## Inputs\n\nThis action takes no inputs.');
    expect(regions.outputs).toBe('## Outputs\n\nThis action sets no outputs.');
  });

  it('leaves permissions and egress empty without a docs.yaml', () => {
    const regions = renderRegions(model());
    expect(regions.permissions).toBe('');
    expect(regions.egress).toBe('');
  });

  it('distinguishes an explicit "none" from a missing docs.yaml', () => {
    const regions = renderRegions(model({ docs: { permissions: [], egress: [], requires: [], examples: [] } }));
    expect(regions.permissions).toBe('## Permissions\n\nNeeds no token permissions.');
    expect(regions.egress).toBe('## Egress\n\nReaches no endpoint beyond those the runner itself needs.');
  });

  it('renders permissions and egress tables from docs.yaml', () => {
    const regions = renderRegions(
      model({
        docs: {
          permissions: [
            { scope: 'contents', access: 'read', when: 'always' },
            { scope: 'security-events', access: 'write', when: { input: 'upload', equals: 'true' } },
          ],
          egress: [{ endpoint: 'ghcr.io:443', for: 'the image pull' }],
          requires: [],
          examples: [],
        },
      }),
    );
    expect(regions.permissions).toBe(
      [
        '## Permissions',
        '',
        '| Permission               | Needed when        |',
        '| ------------------------ | ------------------ |',
        '| `contents: read`         | always             |',
        '| `security-events: write` | `upload` is `true` |',
      ].join('\n'),
    );
    expect(regions.egress).toBe(
      [
        '## Egress',
        '',
        'A job that runs `step-security/harden-runner` with `egress-policy: block` has to allow:',
        '',
        '| Endpoint      | For            |',
        '| ------------- | -------------- |',
        '| `ghcr.io:443` | the image pull |',
      ].join('\n'),
    );
  });

  it('says whose token holds each permission once any is held by a token input', () => {
    const regions = renderRegions(
      model({
        docs: {
          permissions: [
            { scope: 'contents', access: 'read', when: 'always' },
            { scope: 'pull-requests', access: 'write', when: 'always', token: 'token' },
          ],
          egress: [],
          requires: [],
          examples: [],
        },
      }),
    );
    expect(regions.permissions).toBe(
      [
        '## Permissions',
        '',
        '| Permission             | Held by              | Needed when |',
        '| ---------------------- | -------------------- | ----------- |',
        '| `contents: read`       | the job token        | always      |',
        '| `pull-requests: write` | the token in `token` | always      |',
      ].join('\n'),
    );
  });

  it('links the changelog, the e2e workflow and a short list of callers', () => {
    const reference = renderRegions(
      model({ e2eWorkflow: 'verify-action-security-zizmor.yaml', callers: ['.github/workflows/security.yml'] }),
    ).reference;
    expect(reference).toBe(
      [
        '## Reference',
        '',
        '- Changelog: [CHANGELOG.md](./CHANGELOG.md)',
        '- End-to-end tests: [`.github/workflows/verify-action-security-zizmor.yaml`](../../../.github/workflows/verify-action-security-zizmor.yaml)',
        '- Called from this repository by:',
        '  - [`.github/workflows/security.yml`](../../../.github/workflows/security.yml)',
      ].join('\n'),
    );
  });

  it('folds a long caller list into a details block', () => {
    const callers = ['a', 'b', 'c', 'd', 'e', 'f'].map((name) => `.github/workflows/${name}.yml`);
    const reference = renderRegions(model({ hasChangelog: false, callers })).reference;
    expect(reference).toContain('<summary>Called from 6 files in this repository</summary>');
    expect(reference).toContain('- [`.github/workflows/f.yml`](../../../.github/workflows/f.yml)');
    expect(reference).not.toContain('Changelog');
  });

  it('says so when nothing else calls the action', () => {
    expect(renderRegions(model({ hasChangelog: false })).reference).toBe(
      '## Reference\n\n- Not called from anywhere else in this repository.',
    );
  });
});
