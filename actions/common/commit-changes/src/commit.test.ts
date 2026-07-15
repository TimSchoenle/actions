import { beforeEach, describe, expect, it, vi } from 'vitest';

import { commitChanges } from './commit.js';

import type { WorkspaceReader } from './changes.js';
import type { CommitChangesDeps, CommitChangesRequest } from './commit.js';
import type { Git } from './git.js';
import type { CommitApi, CreateCommitRequest } from './github-api.js';

function fakeGit(status = ''): Git & { statusArgs: (readonly string[] | undefined)[] } {
  const statusArgs: (readonly string[] | undefined)[] = [];
  return {
    ignoreFileModeChanges: vi.fn(async () => {}),
    status: vi.fn(async (pathspecs?: readonly string[]) => {
      statusArgs.push(pathspecs);
      return status;
    }),
    statusArgs,
  };
}

function fakeWorkspace(files: Record<string, string> = {}): WorkspaceReader {
  return {
    exists: (path) => path in files,
    readBase64: (path) => Buffer.from(files[path]).toString('base64'),
  };
}

function fakeApi(oid = 'headsha'): CommitApi & { created: CreateCommitRequest[] } {
  const created: CreateCommitRequest[] = [];
  return {
    createCommit: vi.fn(async (request: CreateCommitRequest) => {
      created.push(request);
      return { oid: 'newsha', url: 'https://github.com/o/r/commit/newsha' };
    }),
    created,
    getHeadOid: vi.fn(async () => oid),
  };
}

const baseRequest: CommitChangesRequest = {
  branch: 'main',
  filePattern: '.',
  message: 'chore: update',
  repository: 'owner/repo',
};

function deps(overrides: Partial<CommitChangesDeps> = {}): CommitChangesDeps {
  return {
    api: overrides.api ?? fakeApi(),
    git: overrides.git ?? fakeGit(),
    workspace: overrides.workspace ?? fakeWorkspace(),
  };
}

describe('commitChanges', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('turns off file-mode tracking before inspecting the tree', async () => {
    const git = fakeGit();

    await commitChanges(deps({ git }), baseRequest);

    expect(git.ignoreFileModeChanges).toHaveBeenCalledOnce();
  });

  it('does not commit when the tree is clean', async () => {
    const api = fakeApi();

    const result = await commitChanges(deps({ api, git: fakeGit('') }), baseRequest);

    expect(result).toEqual({ committed: false, hasChanges: false });
    expect(api.createCommit).not.toHaveBeenCalled();
    expect(api.getHeadOid).not.toHaveBeenCalled();
  });

  it('commits the classified changes against the current branch head', async () => {
    const git = fakeGit(' M kept.ts\0 D gone.ts\0');
    const api = fakeApi('abc123');
    const workspace = fakeWorkspace({ 'kept.ts': 'content' });

    const result = await commitChanges(deps({ api, git, workspace }), baseRequest);

    expect(result).toEqual({
      commitHash: 'newsha',
      commitUrl: 'https://github.com/o/r/commit/newsha',
      committed: true,
      hasChanges: true,
    });
    expect(api.getHeadOid).toHaveBeenCalledWith({ owner: 'owner', repo: 'repo' }, 'main');
    expect(api.created[0]).toEqual({
      branch: 'main',
      coordinates: { owner: 'owner', repo: 'repo' },
      expectedHeadOid: 'abc123',
      fileChanges: {
        additions: [{ contents: Buffer.from('content').toString('base64'), path: 'kept.ts' }],
        deletions: [{ path: 'gone.ts' }],
      },
      message: 'chore: update',
    });
  });

  it('scopes the status to the built pathspecs when a file pattern is given', async () => {
    const git = fakeGit('');

    await commitChanges(deps({ git }), { ...baseRequest, filePattern: 'src/*.ts Chart.yaml' });

    expect(git.statusArgs[0]).toEqual([':(glob)src/*.ts', 'Chart.yaml']);
  });

  it('scans the whole tree (no pathspecs) for the whole-tree pattern', async () => {
    const git = fakeGit('');

    await commitChanges(deps({ git }), { ...baseRequest, filePattern: '.' });

    expect(git.statusArgs[0]).toBeUndefined();
  });

  it('refuses to commit without a branch', async () => {
    await expect(commitChanges(deps(), { ...baseRequest, branch: '' })).rejects.toThrow('No branch given');
  });

  it('rejects a malformed repository before touching git', async () => {
    const git = fakeGit();

    await expect(commitChanges(deps({ git }), { ...baseRequest, repository: 'not-a-repo' })).rejects.toThrow(
      "Invalid repository 'not-a-repo'",
    );
    expect(git.status).not.toHaveBeenCalled();
  });
});
