import { describe, expect, it } from 'vitest';

import {
  actionTokenPermissions,
  e2eGroupId,
  e2eGroupJob,
  e2eGroups,
  missingTokenInputScopes,
  workspaceModulePaths,
} from '../jobs.js';
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

const source = (file: string, lines: readonly string[]) =>
  parseSource(`.github/verify/${file}.yaml`, `${lines.join('\n')}\n`);

const PUBLISH = source('release-publish-build-commit', [
  'target: release/publish-build-commit',
  'e2e:',
  '  token-permissions:',
  '    contents: write',
  '  extra-endpoints:',
  "    - 'uploads.github.com:443'",
]);
const COMMIT = source('common-commit-changes', [
  'target: common/commit-changes',
  'e2e:',
  '  token-permissions:',
  '    contents: write',
]);
const APPROVE = source('maintenance-auto-approve-pr', [
  'target: maintenance/auto-approve-pr',
  'e2e:',
  '  token-permissions:',
  '    pull-requests: write',
  '    contents: write',
  '  secondary-token-permissions:',
  '    pull-requests: write',
]);
const READ_YAML = source('common-read-yaml', ['target: common/read-yaml', 'e2e: {}']);
const NO_E2E = source('docker-x', ['target: docker/x', 'jobs:', '  x:', '    permissions: {}']);

describe('e2eGroups', () => {
  it('groups suites by token scopes, primary and secondary, and keeps tokenless suites apart', () => {
    const groups = e2eGroups([PUBLISH, READ_YAML, APPROVE, COMMIT, NO_E2E]);

    expect(groups.map((group) => [group.id, group.targets])).toEqual([
      ['e2e-contents-write', ['common/commit-changes', 'release/publish-build-commit']],
      ['e2e-contents-write-pull-requests-write-as-pull-requests-write', ['maintenance/auto-approve-pr']],
      ['e2e-tokenless', ['common/read-yaml']],
    ]);
    expect(groups[1]?.title).toBe('End-to-end (contents write, pull-requests write; acting as pull-requests write)');
  });

  it('names a group by its sorted scopes, whatever order the source lists them in', () => {
    expect(e2eGroupId(APPROVE.e2e!)).toBe('e2e-contents-write-pull-requests-write-as-pull-requests-write');
    expect(e2eGroupId(READ_YAML.e2e!)).toBe('e2e-tokenless');
  });

  it("allows every member's endpoints, once each", () => {
    const [group] = e2eGroups([COMMIT, PUBLISH]);

    expect(group?.endpoints.filter((endpoint) => endpoint === 'api.github.com:443')).toHaveLength(1);
    expect(group?.endpoints).toContain('uploads.github.com:443');
  });
});

describe('e2eGroupJob', () => {
  const [group] = e2eGroups([COMMIT, PUBLISH]);
  const job = e2eGroupJob(group!, ['node_modules']);

  it('runs only when the plan selected one of its suites, and runs the directories the plan lists', () => {
    expect(job).toContain('  e2e-contents-write:\n');
    expect(job).toContain("contains(fromJSON(needs.plan.outputs.e2e-groups), 'e2e-contents-write')");
    expect(job).toContain("E2E_DIRECTORIES: ${{ toJSON(fromJSON(needs.plan.outputs.e2e)['e2e-contents-write']) }}");
    expect(job).toContain('bun run e2e "${directories[@]}"');
  });

  it('mints one explicitly scoped token, and allows no registry', () => {
    expect(job.match(/- name: Generate Token\n/g)).toHaveLength(1);
    expect(job).toContain('permission-contents: write');
    expect(job).not.toContain('registry.npmjs.org');
    expect(job).not.toContain('bun/setup-cached@');
    expect(job).toContain('fail-on-cache-miss: true');
    expect(job).toContain('key: ${{ needs.install.outputs.cache-key }}');
  });

  // C1: the job holds the App key while running code under test; without sudo that code cannot
  // reach past the runner user, read another process's memory or start a container to do so.
  it('disables sudo and containers in the job that holds the key', () => {
    expect(job).toContain('disable-sudo-and-containers: true');
  });

  it('installs the shared build whenever the run built one', () => {
    expect(job).toContain("if: ${{ needs.build.outputs.artifact-id != '' }}");
    expect(job).toContain('artifact-id: ${{ needs.build.outputs.artifact-id }}');
  });

  it('gives a larger group more time, up to an hour', () => {
    expect(job).toContain('timeout-minutes: 20');
    const many = { ...group!, targets: Array.from({ length: 20 }, (_, index) => `common/t${index}`) };
    expect(e2eGroupJob(many, [])).toContain('timeout-minutes: 60');
  });

  it('mints the second identity only in its own group', () => {
    const [approve] = e2eGroups([APPROVE]);
    expect(job).not.toContain('Generate Secondary Token');
    expect(e2eGroupJob(approve!, [])).toContain('Generate Secondary Token');
  });
});

describe('e2eGroupJob without a token', () => {
  const [group] = e2eGroups([READ_YAML]);
  const job = e2eGroupJob(group!, ['node_modules']);

  it('holds no key, no environment and no route to the GitHub API', () => {
    expect(job).not.toContain('secrets.');
    expect(job).not.toContain('Generate Token');
    expect(job).not.toContain('environment:');
    expect(job).not.toContain('api.github.com');
    expect(job).not.toContain('E2E_GITHUB_TOKEN');
    expect(job).not.toContain('disable-sudo-and-containers');
  });

  it('tells the suites they run without credentials', () => {
    expect(job).toContain("E2E_TOKENLESS: '1'");
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
