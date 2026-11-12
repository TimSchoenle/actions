import { describe, expect, it } from 'vitest';

import { defaultTitle, parseSource, sourceFileName } from '../source.js';

const FILE = '.github/verify/common-find-patch.yaml';

function source(lines: string[]): string {
  return `${lines.join('\n')}\n`;
}

describe('parseSource', () => {
  it('reads a target with an e2e block and jobs, applying the defaults', () => {
    const parsed = parseSource(
      FILE,
      source([
        'target: common/find-patch',
        'e2e:',
        '  token-permissions:',
        '    metadata: read',
        'jobs:',
        '  find-patch-composite:',
        '    runs-on: ubuntu-latest',
        '    permissions:',
        '      contents: read',
        '    steps: []',
      ]),
    );

    expect(parsed.target).toBe('common/find-patch');
    expect(parsed.title).toBe('Common Find-patch');
    expect(parsed.e2e).toEqual({ tokenPermissions: { metadata: 'read' }, extraEndpoints: [] });
    expect(parsed.jobIds).toEqual(['find-patch-composite']);
    expect(parsed.rules).toEqual({ pushBranches: ['feature/common/find-patch'], schedule: false });
    expect(parsed.build).toEqual([]);
    expect(parsed.extraInputs).toEqual([]);
  });

  // C1: a target whose cases never reach GitHub gets no token, so the job holds no key.
  it('reads an e2e block without token-permissions as a tokenless suite', () => {
    const parsed = parseSource(FILE, source(['target: common/find-patch', 'e2e: {}']));

    expect(parsed.e2e).toEqual({ extraEndpoints: [] });
  });

  it('refuses a secondary token without a primary one', () => {
    expect(() =>
      parseSource(
        FILE,
        source(['target: common/find-patch', 'e2e:', '  secondary-token-permissions:', '    issues: write']),
      ),
    ).toThrow(/secondary-token-permissions needs token-permissions/);
  });

  it('reads the rules, the explicit build needs, the extra inputs and a title', () => {
    const parsed = parseSource(
      '.github/verify/configs-renovate.yaml',
      source([
        'target: configs/renovate',
        'title: Config Renovate',
        'build: [actions/common/commit-changes]',
        "extra-inputs: ['renovate.json', '.github/tools/renovate']",
        'rules:',
        '  pull-request-branches: [main]',
        '  push-branches: []',
        '  schedule: true',
        'jobs:',
        '  renovate:',
        '    permissions: {}',
      ]),
    );

    expect(parsed.title).toBe('Config Renovate');
    expect(parsed.build).toEqual(['actions/common/commit-changes']);
    expect(parsed.extraInputs).toEqual(['renovate.json', '.github/tools/renovate']);
    expect(parsed.rules).toEqual({ pullRequestBranches: ['main'], pushBranches: [], schedule: true });
  });

  it.each([
    ['an unknown key', ['target: common/find-patch', 'job: {}'], /unknown key\(s\) job/],
    ['a misnamed file', ['target: common/create-patch', 'jobs:', '  a:', '    permissions: {}'], /must be named/],
    ['a malformed target', ['target: Common', 'jobs: {}'], /target must be/],
    ['no jobs and no e2e block', ['target: common/find-patch'], /needs jobs, an e2e block/],
    ['an unscoped token', ['target: common/find-patch', 'e2e:', '  token-permissions: {}'], /at least one scope/],
    [
      'an invalid access level',
      ['target: common/find-patch', 'e2e:', '  token-permissions:', '    contents: admin'],
      /read or write/,
    ],
    [
      'a path that climbs out',
      ['target: common/find-patch', "extra-inputs: ['../x']", 'e2e:', '  token-permissions:', '    metadata: read'],
      /plain repository-relative/,
    ],
    ['jobs that are not a mapping', ['target: common/find-patch', 'jobs: [a]'], /mapping of job ids/],
    [
      'an invalid job id',
      ['target: common/find-patch', 'jobs:', "  '1a':", '    permissions: {}'],
      /not a valid job id/,
    ],
    ['invalid YAML', ['target: [common'], /not valid YAML/],
  ])('refuses %s', (_case, lines, message) => {
    expect(() => parseSource(FILE, source(lines))).toThrow(message);
  });

  it('names the file in every error', () => {
    expect(() => parseSource(FILE, 'target: x\n')).toThrow(/^\.github\/verify\/common-find-patch\.yaml: /);
  });
});

describe('names', () => {
  it('derives the file name and the title from the target', () => {
    expect(sourceFileName('java-gradle/auto-spotless')).toBe('java-gradle-auto-spotless.yaml');
    expect(defaultTitle('java-gradle/auto-spotless')).toBe('Java-gradle Auto-spotless');
  });
});
