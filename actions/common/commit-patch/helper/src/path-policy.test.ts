import { describe, expect, it } from 'vitest';

import { compileAllowlist } from './glob.js';
import { findViolations, isWorkflowPath, unsafePathReason } from './path-policy.js';

import type { PatchPolicy } from './path-policy.js';
import type { RawChange } from './raw-diff.js';

const ZERO = '0'.repeat(40);
const A = 'a'.repeat(40);
const B = 'b'.repeat(40);

function added(path: string, mode = '100644'): RawChange {
  return { dstMode: mode, dstSha: A, path, srcMode: '000000', srcSha: ZERO, status: 'A' };
}

function modified(path: string, srcMode = '100644', dstMode = srcMode): RawChange {
  return { dstMode, dstSha: B, path, srcMode, srcSha: A, status: 'M' };
}

function deleted(path: string, mode = '100644'): RawChange {
  return { dstMode: '000000', dstSha: ZERO, path, srcMode: mode, srcSha: A, status: 'D' };
}

function policy(overrides: Partial<PatchPolicy> & { allowed?: string } = {}): PatchPolicy {
  return {
    allowBinary: overrides.allowBinary ?? false,
    allowWorkflowChanges: overrides.allowWorkflowChanges ?? false,
    allowlist: overrides.allowlist ?? compileAllowlist(overrides.allowed ?? '**'),
  };
}

/** The reasons each path was refused for, keyed by path. */
function check(
  changes: RawChange[],
  rules: PatchPolicy = policy(),
  links: Record<string, string> = {},
  binary: string[] = [],
): Record<string, string[]> {
  const result: Record<string, string[]> = {};

  for (const { path, reason } of findViolations(changes, rules, new Map(Object.entries(links)), new Set(binary))) {
    (result[path] ??= []).push(reason);
  }

  return result;
}

describe('unsafePathReason', () => {
  it.each(['README.md', 'a/b/c.txt', '.github/codecov.yml', 'dir/.hidden', 'a..b/c', '...', 'ünïcode/ok.txt'])(
    'accepts the plain relative path %j',
    (path) => {
      expect(unsafePathReason(path)).toBeUndefined();
    },
  );

  it.each([
    ['', /empty/],
    ['/etc/passwd', /absolute/],
    ['C:/Windows/x', /absolute/],
    ['c:x', /absolute/],
    ['../escape', /traverses upwards/],
    ['a/../../escape', /traverses upwards/],
    ['a/..', /traverses upwards/],
    ['./a', /'\.' segment/],
    ['a//b', /empty or '\.' segment/],
    ['a/', /empty or '\.' segment/],
    ['.git/hooks/pre-commit', /\.git directory/],
    ['sub/.GIT/config', /\.git directory/],
    [String.raw`a\..\b`, /backslash/],
    ['line\nbreak', /control character/],
    ['nul\u0000byte', /control character/],
    ['del\u007f', /control character/],
    ['bad\ufffdutf8', /not valid UTF-8/],
    ['x'.repeat(4097), /longer than/],
  ])('refuses %j', (path, reason) => {
    expect(unsafePathReason(path)).toMatch(reason);
  });
});

describe('isWorkflowPath', () => {
  it.each([
    '.github/workflows/ci.yml',
    '.github/workflows/nested/x.yml',
    '.GitHub/Workflows/ci.yml',
    '.github/workflows',
  ])('treats %j as a workflow path', (path) => {
    expect(isWorkflowPath(path)).toBe(true);
  });

  it.each([
    '.github/codecov.yml',
    '.github/actions/x/action.yml',
    'workflows/x/workflow.yaml',
    'docs/.github/workflows/x.yml',
  ])('does not treat %j as one', (path) => {
    expect(isWorkflowPath(path)).toBe(false);
  });
});

describe('findViolations', () => {
  it('accepts plain additions, modifications and deletions inside the allowlist', () => {
    const changes = [added('dist/a.js'), modified('dist/b.js'), deleted('dist/c.js'), deleted('bin/tool', '100755')];

    expect(check(changes, policy({ allowed: 'dist/** bin/**' }))).toEqual({});
  });

  it('refuses a path outside the allowlist', () => {
    expect(check([added('src/evil.ts')], policy({ allowed: 'dist/**' }))).toEqual({
      'src/evil.ts': ['the path matches no allowed_paths pattern'],
    });
  });

  it('refuses both halves of a rename whose destination is outside the allowlist', () => {
    // --no-renames reports a rename as a deletion plus an addition, so each half is judged alone.
    const result = check([deleted('dist/a.js'), added('src/a.js')], policy({ allowed: 'dist/**' }));

    expect(Object.keys(result)).toEqual(['src/a.js']);
  });

  it('refuses a rename reported as such', () => {
    const rename: RawChange = { ...modified('dist/new.js'), status: 'R' };

    expect(check([rename])['dist/new.js']).toEqual([expect.stringMatching(/change type 'R' is not supported/)]);
  });

  it.each(['T', 'C', 'U', 'X'])('refuses the change type %s', (status) => {
    expect(check([{ ...modified('x'), status }])['x']?.[0]).toMatch(/is not supported/);
  });

  describe('workflow files', () => {
    const workflow = '.github/workflows/verify-action-x.yaml';

    it('refuses a workflow change by default, even when the allowlist matches it', () => {
      expect(check([modified(workflow)], policy({ allowed: '.github/workflows/verify-action-*.yaml' }))).toEqual({
        [workflow]: ['the path is under .github/workflows/ and allow_workflow_changes is false'],
      });
    });

    it('refuses a workflow change under a differently cased directory', () => {
      expect(check([added('.GITHUB/workflows/x.yml')])['.GITHUB/workflows/x.yml']).toContain(
        'the path is under .github/workflows/ and allow_workflow_changes is false',
      );
    });

    it('accepts an allowlisted workflow change when allow_workflow_changes is true', () => {
      const rules = policy({ allowWorkflowChanges: true, allowed: '.github/workflows/verify-action-*.yaml' });

      expect(check([modified(workflow), deleted('.github/workflows/verify-action-y.yaml')], rules)).toEqual({});
    });

    it('still refuses a workflow outside the allowlist when allow_workflow_changes is true', () => {
      const rules = policy({ allowWorkflowChanges: true, allowed: '.github/workflows/verify-action-*.yaml' });

      expect(check([modified('.github/workflows/release-please.yml')], rules)).toEqual({
        '.github/workflows/release-please.yml': ['the path matches no allowed_paths pattern'],
      });
    });
  });

  describe('modes', () => {
    it('refuses a new executable', () => {
      expect(check([added('tool.sh', '100755')])['tool.sh']?.[0]).toMatch(/new file must have mode 100644; got 100755/);
    });

    it('refuses a mode change', () => {
      expect(check([modified('tool.sh', '100644', '100755')])['tool.sh']?.[0]).toMatch(/alters the file mode/);
    });

    it('refuses a content change to an existing executable', () => {
      expect(check([modified('gradlew', '100755')])['gradlew']?.[0]).toMatch(/executable bit/);
    });

    it.each([
      ['a new symbolic link', added('link', '120000')],
      ['a modified symbolic link', modified('link', '120000')],
      ['a deleted symbolic link', deleted('link', '120000')],
      ['a file replaced by a symbolic link', modified('link', '100644', '120000')],
    ])('refuses %s', (_name, change) => {
      expect(check([change])['link']).toEqual([expect.stringMatching(/symbolic link/)]);
    });

    it.each([
      ['a new submodule', added('vendor', '160000')],
      ['a moved submodule', modified('vendor', '160000')],
      ['a deleted submodule', deleted('vendor', '160000')],
    ])('refuses %s', (_name, change) => {
      expect(check([change])['vendor']).toEqual([expect.stringMatching(/submodule/)]);
    });
  });

  describe('links in the base tree', () => {
    it('refuses a path below a symbolic link', () => {
      expect(check([added('linked/dir/file.txt')], policy(), { linked: '120000' })).toEqual({
        'linked/dir/file.txt': ['the path is below "linked", which is a symbolic link in the base commit'],
      });
    });

    it('refuses a path below a deeper symbolic link', () => {
      expect(check([modified('a/b/c.txt')], policy(), { 'a/b': '120000' })['a/b/c.txt']?.[0]).toMatch(/below "a\/b"/);
    });

    it('refuses a path inside a submodule', () => {
      expect(check([added('vendor/lib/x.c')], policy(), { vendor: '160000' })['vendor/lib/x.c']?.[0]).toMatch(
        /submodule/,
      );
    });

    it('does not mistake a sibling with a common prefix for an ancestor', () => {
      expect(check([added('linked-other/file.txt')], policy(), { linked: '120000' })).toEqual({});
    });
  });

  describe('binary changes', () => {
    it('refuses a binary change by default', () => {
      expect(check([added('logo.png')], policy(), {}, ['logo.png'])).toEqual({
        'logo.png': ['the change is binary and allow_binary is false'],
      });
    });

    it('accepts a binary change when allow_binary is true', () => {
      expect(check([added('logo.png')], policy({ allowBinary: true }), {}, ['logo.png'])).toEqual({});
    });
  });

  it('reports an unsafe path once, without judging it further', () => {
    expect(check([added('../escape', '100755')], policy({ allowed: 'dist/**' }))).toEqual({
      '../escape': ["the path traverses upwards with '..'"],
    });
  });

  it('reports every violation of every path, sorted by path', () => {
    const changes = [added('z.sh', '100755'), added('.github/workflows/a.yml'), added('m.txt')];
    const violations = findViolations(changes, policy({ allowed: 'm.txt' }), new Map(), new Set());

    expect(violations.map(({ path }) => path)).toEqual([
      '.github/workflows/a.yml',
      '.github/workflows/a.yml',
      'z.sh',
      'z.sh',
    ]);
  });
});
