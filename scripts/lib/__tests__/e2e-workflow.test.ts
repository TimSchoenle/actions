import { describe, expect, it } from 'vitest';

import {
  actionTokenPermissions,
  missingTokenInputScopes,
  PINNED,
  resolvePins,
  SECONDARY_TOKEN_PERMISSIONS,
  tokenPermissions,
} from '../e2e-workflow.js';

import type { Permission } from '../action-docs/docs-file.js';

/**
 * The substitution that keeps an extra-jobs fragment from carrying its own copy of a pin.
 *
 * The repository-wide contract — that no fragment on disk writes a ref out in full — lives in
 * `scripts/__tests__/renovate-managers.test.ts`. What is checked here is the mechanism itself: that
 * it rewrites what it should, leaves everything else alone, and refuses a name it cannot resolve
 * rather than emitting a workflow that fails only once a runner reaches the job.
 */
describe('resolvePins', () => {
  it('substitutes a placeholder with the pin it names', () => {
    expect(resolvePins('    - name: Harden Runner\n      uses: pinned:hardenRunner\n')).toBe(
      `    - name: Harden Runner\n      uses: ${PINNED.hardenRunner}\n`,
    );
  });

  it('substitutes every placeholder in a fragment, not just the first', () => {
    const resolved = resolvePins('      uses: pinned:checkout\n      uses: pinned:hardenRunner\n');

    expect(resolved).toContain(PINNED.checkout);
    expect(resolved).toContain(PINNED.hardenRunner);
  });

  it('preserves the indentation the placeholder sat at', () => {
    // The fragment is indented again on the way into the workflow, so a substitution that
    // normalised whitespace would put the step at a depth YAML reads as a different key.
    expect(resolvePins('        uses: pinned:checkout')).toBe(`        uses: ${PINNED.checkout}`);
  });

  it('leaves a local action reference alone', () => {
    const fragment = '      uses: ./actions/helper/verify-branch-name';

    expect(resolvePins(fragment)).toBe(fragment);
  });

  it('leaves a ref written out in full alone', () => {
    // Not this function's job to reject one — `renovate-managers.test.ts` is what fails it, with an
    // explanation. Rewriting it here would hide the pin the contract exists to surface.
    const fragment = `      uses: ${PINNED.checkout}`;

    expect(resolvePins(fragment)).toBe(fragment);
  });

  it('ignores a placeholder that is not the value of a uses key', () => {
    const fragment = '      run: echo pinned:checkout';

    expect(resolvePins(fragment)).toBe(fragment);
  });

  it('returns an empty fragment unchanged', () => {
    expect(resolvePins('')).toBe('');
  });

  it('names the unknown key and the keys that exist when it cannot resolve one', () => {
    expect(() => resolvePins('      uses: pinned:notAPin')).toThrow(/pinned:notAPin/);
    expect(() => resolvePins('      uses: pinned:notAPin')).toThrow(/hardenRunner/);
  });
});

describe('missingTokenInputScopes', () => {
  const onToken = (scope: Permission['scope'], access: Permission['access']): Permission => ({
    scope,
    access,
    when: 'always',
    token: 'token',
  });

  it('accepts a token that grants every scope documented on a token input', () => {
    expect(
      missingTokenInputScopes({ contents: 'write', 'pull-requests': 'write' }, [
        onToken('contents', 'write'),
        onToken('pull-requests', 'write'),
      ]),
    ).toEqual([]);
  });

  it('reports a scope documented on a token input that the token lacks', () => {
    const issues = onToken('issues', 'write');

    expect(missingTokenInputScopes({ metadata: 'read' }, [issues])).toEqual([issues]);
  });

  it('reports a token that reads a scope the action writes', () => {
    const contents = onToken('contents', 'write');

    expect(missingTokenInputScopes({ contents: 'read' }, [contents])).toEqual([contents]);
  });

  it('lets write cover read', () => {
    expect(missingTokenInputScopes({ actions: 'write' }, [onToken('actions', 'read')])).toEqual([]);
  });

  it('ignores job-token entries, which the harness gives no token to apply to', () => {
    expect(
      missingTokenInputScopes({ metadata: 'read' }, [{ scope: 'security-events', access: 'write', when: 'always' }]),
    ).toEqual([]);
  });

  it('counts a conditional entry as if its condition held', () => {
    const conditional: Permission = { ...onToken('actions', 'write'), when: { input: 'dry_run', equals: 'false' } };

    expect(missingTokenInputScopes({ actions: 'read' }, [conditional])).toEqual([conditional]);
  });

  it('accepts scopes the token holds beyond what docs.yaml lists, such as a fixture needs', () => {
    expect(
      missingTokenInputScopes({ contents: 'write', 'pull-requests': 'write' }, [onToken('pull-requests', 'write')]),
    ).toEqual([]);
  });
});

describe('missingTokenInputScopes on mixed entries', () => {
  it('returns only the token-input entry when a job-token entry sits beside it', () => {
    const issues: Permission = { scope: 'issues', access: 'write', when: 'always', token: 'token' };

    expect(
      missingTokenInputScopes({ metadata: 'read' }, [{ scope: 'contents', access: 'read', when: 'always' }, issues]),
    ).toEqual([issues]);
  });

  it('returns only the write entry when a read-only token meets one scope at both levels', () => {
    const write: Permission = {
      scope: 'actions',
      access: 'write',
      when: { input: 'dry_run', equals: 'false' },
      token: 'token',
    };

    expect(
      missingTokenInputScopes({ actions: 'read' }, [
        { scope: 'actions', access: 'read', when: 'always', token: 'token' },
        write,
      ]),
    ).toEqual([write]);
  });
});

describe('actionTokenPermissions', () => {
  it('gives an ordinary suite its primary token scopes', () => {
    const action = { category: 'common', name: 'upsert-issue', actionPath: 'actions/common/upsert-issue' };

    expect(actionTokenPermissions(action)).toEqual(tokenPermissions(action));
  });

  it('gives a suite that runs the action as the second identity the secondary token scopes', () => {
    const action = {
      category: 'maintenance',
      name: 'auto-approve-pr',
      actionPath: 'actions/maintenance/auto-approve-pr',
    };

    expect(actionTokenPermissions(action)).toEqual(SECONDARY_TOKEN_PERMISSIONS);
    expect(actionTokenPermissions(action)).not.toEqual(tokenPermissions(action));
  });
});
