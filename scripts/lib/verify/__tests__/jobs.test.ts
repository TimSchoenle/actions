import { describe, expect, it } from 'vitest';

import { actionTokenPermissions, e2eJob, e2eJobId, missingTokenInputScopes, workspaceModulePaths } from '../jobs.js';
import { parseSource } from '../source.js';

import type { Permission } from '../../action-docs/docs-file.js';

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
    const source = parseSource(
      '.github/verify/common-upsert-issue.yaml',
      'target: common/upsert-issue\ne2e:\n  token-permissions:\n    issues: write\n',
    );

    expect(actionTokenPermissions(source)).toEqual({ issues: 'write' });
  });

  it('gives a suite that runs the action as the second identity the secondary token scopes', () => {
    const source = parseSource(
      '.github/verify/maintenance-auto-approve-pr.yaml',
      [
        'target: maintenance/auto-approve-pr',
        'e2e:',
        '  token-permissions:',
        '    contents: write',
        '  secondary-token-permissions:',
        '    pull-requests: write',
        '',
      ].join('\n'),
    );

    expect(actionTokenPermissions(source)).toEqual({ 'pull-requests': 'write' });
  });
});

describe('e2eJob', () => {
  const source = parseSource(
    '.github/verify/release-publish-build-commit.yaml',
    [
      'target: release/publish-build-commit',
      'e2e:',
      '  token-permissions:',
      '    contents: write',
      '  extra-endpoints:',
      "    - 'uploads.github.com:443'",
      '',
    ].join('\n'),
  );

  it('names the job after the target and runs its cases', () => {
    const job = e2eJob(source, true, ['node_modules']);

    expect(e2eJobId('release/publish-build-commit')).toBe('e2e-release-publish-build-commit');
    expect(job).toContain('  e2e-release-publish-build-commit:\n');
    expect(job).toContain('run: bun run e2e actions/release/publish-build-commit');
  });

  it('scopes the token explicitly and allows the extra endpoint, never a registry', () => {
    const job = e2eJob(source, true, ['node_modules']);

    expect(job).toContain('permission-contents: write');
    expect(job).toContain('uploads.github.com:443');
    expect(job).not.toContain('registry.npmjs.org');
    expect(job).not.toContain('bun/setup-cached@');
    expect(job).toContain('fail-on-cache-miss: true');
  });

  it('installs the shared build through the shard inputs only when the target builds', () => {
    expect(e2eJob(source, true, ['node_modules'])).toContain('artifact-id: ${{ inputs.artifact-id }}');
    expect(e2eJob(source, false, ['node_modules'])).not.toContain('Install Built Actions');
  });
});

describe('e2eJob without a token', () => {
  const source = parseSource('.github/verify/common-read-yaml.yaml', 'target: common/read-yaml\ne2e: {}\n');
  const job = e2eJob(source, true, ['node_modules']);

  it('holds no key, no environment and no route to the GitHub API', () => {
    expect(job).not.toContain('secrets.');
    expect(job).not.toContain('Generate Token');
    expect(job).not.toContain('environment:');
    expect(job).not.toContain('api.github.com');
    expect(job).not.toContain('E2E_GITHUB_TOKEN');
  });

  it('tells the suite it runs without credentials, and still runs the cases', () => {
    expect(job).toContain("E2E_TOKENLESS: '1'");
    expect(job).toContain('run: bun run e2e actions/common/read-yaml');
  });
});

describe('workspaceModulePaths', () => {
  it('maps each member to its top-level directory, one wildcard per remaining segment, root first', () => {
    expect(
      workspaceModulePaths([
        'packages/ts-util',
        'actions/common/delete-branch',
        'actions/docker/image-check/helper',
        'actions/common/fetch-head',
      ]),
    ).toEqual(['node_modules', 'actions/*/*/*/node_modules', 'actions/*/*/node_modules', 'packages/*/node_modules']);
  });

  it('returns only the root for a repository without members', () => {
    expect(workspaceModulePaths([])).toEqual(['node_modules']);
  });
});
