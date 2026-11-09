import { describe, expect, it, vi } from 'vitest';

// The module under test imports the real readme utilities for its default I/O; nothing here uses it.
vi.mock('../../readme/utils.js', () => ({ getTagCommitSha: vi.fn() }));

import { generateActionReadmes } from '../generate.js';

import type { DocsIo } from '../generate.js';

const REPO = 'Owner/actions';
const SHA = '0123456789abcdef0123456789abcdef01234567';

/** Matches the shallow glob dialect of `scanSorted`: `*` within one segment only. */
function matches(pattern: string, file: string): boolean {
  const patternParts = pattern.split('/');
  const fileParts = file.split('/');
  if (patternParts.length !== fileParts.length) {
    return false;
  }
  return patternParts.every((part, index) => {
    const [prefix, suffix] = part.split('*');
    return part.includes('*')
      ? fileParts[index].startsWith(prefix) && fileParts[index].endsWith(suffix ?? '')
      : part === fileParts[index];
  });
}

function memoryIo(initial: Record<string, string>, tags: Record<string, string> = {}) {
  const files = new Map(Object.entries(initial));
  const writes: string[] = [];
  const io: DocsIo = {
    list: async (pattern) => [...files.keys()].filter((file) => matches(pattern, file)).sort(),
    read: async (file) => files.get(file),
    write: async (file, content) => {
      writes.push(file);
      files.set(file, content);
    },
    tagSha: async (tag) => tags[tag],
  };
  return { io, files, writes };
}

const ZIZMOR = 'actions/security/zizmor';

const CONFIG_DESCRIPTION = "    description: 'Path to a zizmor config.'\n";

const MANIFEST = [
  "name: 'Security Zizmor'",
  "description: 'Runs zizmor.'",
  'inputs:',
  '  upload:',
  "    description: 'Upload the SARIF.'",
  "    default: 'true'",
  '  config:',
  CONFIG_DESCRIPTION.trimEnd(),
  '    required: false',
  'runs:',
  "  using: 'composite'",
  '  steps: []',
  '',
].join('\n');

/** The manifest with the `config` input's description removed. */
const MANIFEST_WITHOUT_DESCRIPTION = MANIFEST.replace(CONFIG_DESCRIPTION, '');

const DOCS = `
permissions:
  - { scope: contents, access: read, when: always }
  - { scope: security-events, access: write, when: { input: upload, equals: 'true' } }
egress:
  - { endpoint: ghcr.io:443, for: the image pull }
requires: [linux, docker]
examples:
  - { title: Audit, file: examples/security.yaml }
`;

const EXAMPLE = `jobs:
  zizmor:
    steps:
      - uses: Owner/actions/actions/security/zizmor@main
`;

/** A repository with one fully documented published action. `extra` adds or replaces files. */
function repository(extra: Record<string, string> = {}): Record<string, string> {
  return {
    '.release-please-manifest.json': JSON.stringify({ [ZIZMOR]: '2.0.2' }),
    'release-please-config.json': JSON.stringify({
      packages: { [ZIZMOR]: { component: 'actions-security-zizmor' } },
    }),
    [`${ZIZMOR}/action.yaml`]: MANIFEST,
    [`${ZIZMOR}/docs.yaml`]: DOCS,
    [`${ZIZMOR}/examples/security.yaml`]: EXAMPLE,
    // A helper is not in the release config, so it gets no README.
    [`${ZIZMOR}/helper/action.yaml`]: "name: helper\nruns:\n  using: 'node24'\n",
    '.github/workflows/security.yml': 'jobs:\n  z:\n    steps:\n      - uses: ./actions/security/zizmor\n',
    '.github/workflows/verify-action-security-zizmor.yaml': 'jobs: {}\n',
    ...extra,
  };
}

/** The fixture repository without the given files. */
function repositoryWithout(...omitted: string[]): Record<string, string> {
  return Object.fromEntries(Object.entries(repository()).filter(([file]) => !omitted.includes(file)));
}

describe('generateActionReadmes', () => {
  it('writes a complete README for a published action that has none', async () => {
    const { io, files, writes } = memoryIo(repository(), { 'actions-security-zizmor-v2.0.2': SHA });

    const report = await generateActionReadmes(REPO, io);

    expect(report.errors).toEqual([]);
    expect(writes).toEqual([`${ZIZMOR}/README.md`]);
    const readme = files.get(`${ZIZMOR}/README.md`) ?? '';
    expect(readme).toContain('# Security Zizmor');
    expect(readme).toContain('Composite action · Linux runners only · needs Docker');
    // The example is pinned to the released commit.
    expect(readme).toContain(
      `      - uses: Owner/actions/actions/security/zizmor@${SHA} # tag=actions-security-zizmor-v2.0.2`,
    );
    expect(readme).toContain('| `security-events: write` | `upload` is `true` |');
    expect(readme).toContain('| `ghcr.io:443` | the image pull |');
    // The action's own e2e workflow is linked, not listed as a caller.
    expect(readme).toContain('- End-to-end tests: [`.github/workflows/verify-action-security-zizmor.yaml`]');
    expect(readme).toContain('  - [`.github/workflows/security.yml`](../../../.github/workflows/security.yml)');
    expect(report.warnings).toEqual([]);
  });

  it('pins every published action an example calls, not only the documented one', async () => {
    const OTHER = 'actions/common/commit-patch';
    const files = repository({
      [`${ZIZMOR}/examples/security.yaml`]: `${EXAMPLE}      - uses: Owner/actions/${OTHER}@main\n`,
    });
    files['.release-please-manifest.json'] = JSON.stringify({ [ZIZMOR]: '2.0.2', [OTHER]: '1.3.0' });
    files['release-please-config.json'] = JSON.stringify({
      packages: {
        [ZIZMOR]: { component: 'actions-security-zizmor' },
        [OTHER]: { component: 'actions-common-commit-patch' },
      },
    });
    const { io, files: written } = memoryIo(files, { 'actions-common-commit-patch-v1.3.0': SHA });

    expect((await generateActionReadmes(REPO, io)).errors).toEqual([]);
    expect(written.get(`${ZIZMOR}/README.md`)).toContain(
      `      - uses: Owner/actions/${OTHER}@${SHA} # tag=actions-common-commit-patch-v1.3.0`,
    );
  });

  it('leaves the renovate annotations of an example out of the README', async () => {
    const annotated = `${EXAMPLE}        with:\n          # renovate: datasource=github-releases depName=o/r\n          version: '1.2.3'\n`;
    const { io, files } = memoryIo(
      repository({ [`${ZIZMOR}/docs.yaml`]: DOCS, [`${ZIZMOR}/examples/security.yaml`]: annotated }),
    );

    expect((await generateActionReadmes(REPO, io)).errors).toEqual([]);
    const readme = files.get(`${ZIZMOR}/README.md`) ?? '';
    expect(readme).toContain("        with:\n          version: '1.2.3'\n");
    expect(readme).not.toContain('renovate:');
  });

  it('writes nothing on a second run', async () => {
    const { io, writes } = memoryIo(repository());
    expect((await generateActionReadmes(REPO, io)).written).toEqual([`${ZIZMOR}/README.md`]);
    writes.length = 0;

    expect((await generateActionReadmes(REPO, io)).written).toEqual([]);
    expect(writes).toEqual([]);
  });

  it('rewrites only the marked regions of an existing README', async () => {
    const readme = [
      '<!-- docs:generated header -->',
      'stale',
      '<!-- /docs:generated header -->',
      '',
      'Hand-written prose.',
      '',
    ].join('\n');
    const { io, files } = memoryIo(repository({ [`${ZIZMOR}/README.md`]: readme }));

    await generateActionReadmes(REPO, io);

    const next = files.get(`${ZIZMOR}/README.md`) ?? '';
    expect(next).toContain('# Security Zizmor');
    expect(next).not.toContain('stale');
    expect(next.endsWith('\nHand-written prose.\n')).toBe(true);
    expect(next).not.toContain('## Inputs');
  });

  it('reads a README checked out with CRLF line endings', async () => {
    const readme = '<!-- docs:generated header -->\r\nstale\r\n<!-- /docs:generated header -->\r\n';
    const { io, files } = memoryIo(repository({ [`${ZIZMOR}/README.md`]: readme }));

    expect((await generateActionReadmes(REPO, io)).errors).toEqual([]);
    expect(files.get(`${ZIZMOR}/README.md`)).not.toContain('\r');
  });

  it('leaves a README without markers alone and warns', async () => {
    const { io, writes } = memoryIo(repository({ [`${ZIZMOR}/README.md`]: '# Zizmor\n\nProse only.\n' }));

    const report = await generateActionReadmes(REPO, io);

    expect(writes).toEqual([]);
    expect(report.warnings).toContain(`${ZIZMOR}/README.md: has no docs:generated regions yet, left as it is`);
  });

  it('reports a missing docs.yaml as an error and writes nothing', async () => {
    const { io, writes } = memoryIo(repositoryWithout(`${ZIZMOR}/docs.yaml`));

    const report = await generateActionReadmes(REPO, io);

    expect(report.errors).toEqual([`${ZIZMOR}: has no docs.yaml, which its README needs for permissions and egress`]);
    expect(report.warnings).toEqual([]);
    expect(writes).toEqual([]);
  });

  it.each([
    ['an invalid docs.yaml', { [`${ZIZMOR}/docs.yaml`]: 'permissions: []\n' }, /egress: must be a list/],
    ['docs.yaml that is not YAML', { [`${ZIZMOR}/docs.yaml`]: 'a: [\n' }, /docs\.yaml: not valid YAML/],
    [
      'a missing example file',
      { [`${ZIZMOR}/docs.yaml`]: DOCS.replace('security.yaml', 'missing.yaml') },
      /example examples\/missing\.yaml does not exist/,
    ],
    [
      'an example that never calls the action',
      { [`${ZIZMOR}/examples/security.yaml`]: 'jobs: {}\n' },
      /never calls actions\/security\/zizmor/,
    ],
    [
      'broken markers',
      { [`${ZIZMOR}/README.md`]: '<!-- docs:generated header -->\n' },
      /README\.md:1: region 'header' is never closed/,
    ],
    [
      'an input without a description',
      { [`${ZIZMOR}/action.yaml`]: MANIFEST_WITHOUT_DESCRIPTION },
      /action\.yaml: input 'config' has no description/,
    ],
    [
      'an output without a description',
      { [`${ZIZMOR}/action.yaml`]: MANIFEST.replace('runs:', "outputs:\n  sarif:\n    value: 'x'\nruns:") },
      /action\.yaml: output 'sarif' has no description/,
    ],
    [
      'an unreadable action.yaml',
      { [`${ZIZMOR}/action.yaml`]: 'description: no name\n' },
      /action\.yaml: 'name' is missing/,
    ],
    [
      'an example holding a code fence',
      { [`${ZIZMOR}/examples/security.yaml`]: `${EXAMPLE}        run: |\n          \`\`\`\n` },
      /examples\/security\.yaml: contains a Markdown code fence/,
    ],
    [
      'an example holding a marker',
      { [`${ZIZMOR}/examples/security.yaml`]: `${EXAMPLE}# <!-- /docs:generated usage -->\n` },
      /examples\/security\.yaml: contains a docs:generated marker/,
    ],
  ])('reports %s as an error and writes nothing', async (_case, extra, message) => {
    const { io, writes } = memoryIo(repository(extra));

    const report = await generateActionReadmes(REPO, io);

    expect(report.errors.join('\n')).toMatch(message);
    expect(writes).toEqual([]);
  });

  it('refuses a directory holding both action.yaml and action.yml', async () => {
    const { io } = memoryIo(repository({ [`${ZIZMOR}/action.yml`]: MANIFEST }));

    const report = await generateActionReadmes(REPO, io);

    expect(report.errors).toEqual([`${ZIZMOR}: has both action.yaml and action.yml; keep one`]);
  });

  it('names action.yml in an error about an action that uses it', async () => {
    const { io } = memoryIo({
      ...repositoryWithout(`${ZIZMOR}/action.yaml`),
      [`${ZIZMOR}/action.yml`]: MANIFEST_WITHOUT_DESCRIPTION,
    });

    const report = await generateActionReadmes(REPO, io);

    expect(report.errors).toContain(`${ZIZMOR}/action.yml: input 'config' has no description`);
  });
});
