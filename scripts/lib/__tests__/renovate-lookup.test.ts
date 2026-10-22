import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  evaluateReport,
  parseLookupCase,
  presetUrl,
  rewritePresetReferences,
  WARN_LEVEL,
  type LookupCase,
  type RenovateReport,
  type ReportDependency,
  type ReportProblem,
} from '../renovate-lookup.js';
import { ROOT_DIR } from '../utils.js';

const BASE_URL = 'http://127.0.0.1:4321';

describe('rewritePresetReferences', () => {
  it('points a preset reference at the local server', () => {
    expect(rewritePresetReferences('"github>TimSchoenle/actions//configs/renovate/base"', BASE_URL)).toBe(
      `"${BASE_URL}/base.json"`,
    );
  });

  it('drops an extension and a ref, which the checkout replaces', () => {
    expect(
      rewritePresetReferences(
        '["github>TimSchoenle/actions//configs/renovate/default.json#v1", "github>TimSchoenle/actions//configs/renovate/rust-toolchain.json5"]',
        BASE_URL,
      ),
    ).toBe(`["${BASE_URL}/default.json", "${BASE_URL}/rust-toolchain.json"]`);
  });

  it('matches the repository case-insensitively, as Renovate resolves it', () => {
    expect(rewritePresetReferences('"github>timschoenle/Actions//configs/renovate/Base"', BASE_URL)).toBe(
      `"${BASE_URL}/base.json"`,
    );
  });

  it('leaves other presets and other repositories alone', () => {
    const content =
      '["config:best-practices", "github>TimSchoenle/other//configs/renovate/base", "customManagers:githubActionsVersions"]';

    expect(rewritePresetReferences(content, BASE_URL)).toBe(content);
  });

  it('rewrites every reference in every shipped preset', () => {
    const dir = path.join(ROOT_DIR, 'configs', 'renovate');

    for (const file of fs.readdirSync(dir).filter((name) => name.endsWith('.json'))) {
      const rewritten = rewritePresetReferences(fs.readFileSync(path.join(dir, file), 'utf8'), BASE_URL);

      expect(rewritten, file).not.toMatch(/github>TimSchoenle\/actions\/\//i);
    }
  });
});

describe('presetUrl', () => {
  it('joins without doubling the slash', () => {
    expect(presetUrl(`${BASE_URL}/`, 'default')).toBe(`${BASE_URL}/default.json`);
  });

  it.each(['../secret', 'a/b', '', 'Default'])('refuses %j', (name) => {
    expect(() => presetUrl(BASE_URL, name)).toThrow(/Invalid preset name/);
  });
});

function validCase(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    description: 'A fixture.',
    presets: ['default'],
    files: { 'Cargo.toml': 'Cargo.toml' },
    dependencies: [{ manager: 'cargo', depName: 'csp-shell' }],
    ...overrides,
  };
}

describe('parseLookupCase', () => {
  it('accepts a minimal case and defaults minUpdates to 0', () => {
    expect(parseLookupCase('fixture', validCase())).toEqual({
      name: 'fixture',
      description: 'A fixture.',
      presets: ['default'],
      files: { 'Cargo.toml': 'Cargo.toml' },
      dependencies: [
        {
          manager: 'cargo',
          depName: 'csp-shell',
          packageFile: undefined,
          minUpdates: 0,
          newValue: undefined,
          branchName: undefined,
        },
      ],
    });
  });

  it.each([
    ['a non-object', null, /must contain an object/],
    ['no presets', validCase({ presets: [] }), /'presets' must be a non-empty array/],
    ['a preset that is a path', validCase({ presets: ['../x'] }), /is not a preset name/],
    ['no files', validCase({ files: {} }), /'files' must be a non-empty object/],
    ['a destination outside the repository', validCase({ files: { '../x': 'x' } }), /must be a relative path/],
    ['an absolute destination', validCase({ files: { '/etc/x': 'x' } }), /must be a relative path/],
    ['a drive-letter destination', validCase({ files: { 'C:/x': 'x' } }), /must be a relative path/],
    ['a provided renovate.json', validCase({ files: { 'renovate.json': 'r.json' } }), /must not provide renovate.json/],
    ['a source outside the fixture', validCase({ files: { x: '../../x' } }), /must be a file inside the fixture/],
    ['case.json as a source', validCase({ files: { x: 'case.json' } }), /must be a file inside the fixture/],
    ['no dependencies', validCase({ dependencies: [] }), /'dependencies' must be a non-empty array/],
    ['a dependency without a manager', validCase({ dependencies: [{ depName: 'x' }] }), /dependencies\[0\]\.manager/],
    [
      'a negative minUpdates',
      validCase({ dependencies: [{ manager: 'cargo', depName: 'x', minUpdates: -1 }] }),
      /minUpdates' must be a non-negative integer/,
    ],
    [
      'an invalid newValue pattern',
      validCase({ dependencies: [{ manager: 'cargo', depName: 'x', newValue: '(' }] }),
      /newValue' is not a valid regular expression/,
    ],
    ['a missing description', validCase({ description: '' }), /'description' must be a non-empty string/],
  ])('rejects %s', (_label, raw, message) => {
    expect(() => parseLookupCase('fixture', raw)).toThrow(message);
  });

  it('names the fixture in the error', () => {
    expect(() => parseLookupCase('broken', validCase({ presets: [] }))).toThrow(/^Fixture 'broken':/);
  });
});

const CASE: LookupCase = {
  name: 'fixture',
  description: 'A fixture.',
  presets: ['default'],
  files: { 'Cargo.toml': 'Cargo.toml' },
  dependencies: [
    {
      manager: 'cargo',
      depName: 'csp-shell',
      minUpdates: 1,
      newValue: String.raw`^csp-shell-v\d+\.\d+\.\d+$`,
      branchName: 'renovate/csp-shell-0.x',
    },
  ],
};

function report(deps: ReportDependency[], problems: ReportProblem[] = []): RenovateReport {
  return {
    problems: [],
    repositories: {
      local: {
        problems,
        packageFiles: { cargo: [{ packageFile: 'Cargo.toml', deps }] },
      },
    },
  };
}

const GOOD_UPDATE = { newValue: 'csp-shell-v0.2.1', branchName: 'renovate/csp-shell-0.x', updateType: 'patch' };

describe('evaluateReport', () => {
  it('passes a report that meets every expectation', () => {
    expect(evaluateReport(CASE, report([{ depName: 'csp-shell', warnings: [], updates: [GOOD_UPDATE] }]))).toEqual([]);
  });

  it('fails the lookup warning a consumer dashboard would show', () => {
    const failures = evaluateReport(
      CASE,
      report([
        {
          depName: 'csp-shell',
          warnings: [{ message: "Can't find version matching csp-shell-v0.2.0", topic: 'csp-shell' }],
          updates: [],
        },
      ]),
    );

    expect(failures).toEqual([
      "cargo csp-shell (Cargo.toml): lookup warning: Can't find version matching csp-shell-v0.2.0",
      'cargo csp-shell: expected at least 1 update(s), found 0.',
    ]);
  });

  it('fails a warning on a dependency the case does not name', () => {
    const failures = evaluateReport(
      CASE,
      report([
        { depName: 'csp-shell', updates: [GOOD_UPDATE] },
        { depName: 'other', warnings: [{ topic: 'other' }] },
      ]),
    );

    expect(failures).toEqual(['cargo other (Cargo.toml): lookup warning: other']);
  });

  it('fails an update to a sibling component', () => {
    const failures = evaluateReport(
      CASE,
      report([{ depName: 'csp-shell', updates: [{ ...GOOD_UPDATE, newValue: 'csp-policy-v0.2.1' }] }]),
    );

    expect(failures).toEqual([
      String.raw`cargo csp-shell: update to 'csp-policy-v0.2.1' does not match /^csp-shell-v\d+\.\d+\.\d+$/.`,
    ]);
  });

  it('fails an update outside the expected group branch', () => {
    const failures = evaluateReport(
      CASE,
      report([{ depName: 'csp-shell', updates: [{ ...GOOD_UPDATE, branchName: 'renovate/other' }] }]),
    );

    expect(failures).toEqual([
      "cargo csp-shell: update to 'csp-shell-v0.2.1' is on branch 'renovate/other', expected 'renovate/csp-shell-0.x'.",
    ]);
  });

  it('fails a dependency that was not extracted, or extracted twice', () => {
    expect(evaluateReport(CASE, report([]))).toEqual([
      'cargo csp-shell: expected exactly one extracted dependency, found 0.',
    ]);
    expect(evaluateReport(CASE, report([{ depName: 'csp-shell' }, { depName: 'csp-shell' }]))).toEqual([
      'cargo csp-shell: expected exactly one extracted dependency, found 2.',
    ]);
  });

  it('narrows by packageFile when the case names one', () => {
    const narrowed: LookupCase = {
      ...CASE,
      dependencies: [{ ...CASE.dependencies[0], packageFile: 'crates/x/Cargo.toml' }],
    };

    expect(evaluateReport(narrowed, report([{ depName: 'csp-shell', updates: [GOOD_UPDATE] }]))).toEqual([
      'cargo csp-shell (crates/x/Cargo.toml): expected exactly one extracted dependency, found 0.',
    ]);
  });

  it('fails a problem at warn level or above, from the run or the repository', () => {
    const withProblems: RenovateReport = {
      ...report(
        [{ depName: 'csp-shell', updates: [GOOD_UPDATE] }],
        [
          { level: WARN_LEVEL, msg: 'Package lookup failures' },
          { level: WARN_LEVEL - 10, msg: 'just info' },
        ],
      ),
      problems: [{ level: 50, msg: 'preset not found' }],
    };

    expect(evaluateReport(CASE, withProblems)).toEqual([
      'problem: preset not found',
      'problem: Package lookup failures',
    ]);
  });

  it('fails a report without exactly one repository', () => {
    expect(evaluateReport(CASE, { repositories: {} })).toEqual(['expected one repository in the report, found 0.']);
    expect(evaluateReport(CASE, {})).toEqual(['expected one repository in the report, found 0.']);
  });
});

describe('shipped fixtures', () => {
  const fixturesDir = path.join(ROOT_DIR, 'scripts', '__fixtures__', 'renovate');
  const names = fs
    .readdirSync(fixturesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  it('exist', () => {
    expect(names.length).toBeGreaterThan(0);
  });

  describe.each(names)('%s', (name) => {
    const dir = path.join(fixturesDir, name);
    const lookupCase = parseLookupCase(name, JSON.parse(fs.readFileSync(path.join(dir, 'case.json'), 'utf8')));

    it('extends only presets that exist', () => {
      for (const preset of lookupCase.presets) {
        expect(fs.existsSync(path.join(ROOT_DIR, 'configs', 'renovate', `${preset}.json`)), preset).toBe(true);
      }
    });

    it('copies only files that exist', () => {
      for (const source of Object.values(lookupCase.files)) {
        expect(fs.existsSync(path.join(dir, source)), source).toBe(true);
      }
    });

    it('expects at least one update per dependency, so a lookup that stops working cannot pass', () => {
      for (const dependency of lookupCase.dependencies) {
        expect(dependency.minUpdates, dependency.depName).toBeGreaterThan(0);
      }
    });
  });
});
