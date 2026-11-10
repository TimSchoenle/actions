import { gitTreeId } from 'action-graph';

import type { GitTreeItem, PublishApi } from './github.js';
import type { GitTreeEntry, GitTreeMode } from 'action-graph';

/** One bundle to add to the source tree. */
export interface PlannedFile {
  readonly path: string;
  readonly content: Uint8Array;
  /** git's blob id of the content, computed locally. */
  readonly blobSha: string;
}

/** How to treat a bundle path that already exists in the source commit. */
export type ExistingFilesPolicy = 'fail' | 'require-identical';

/** The tree of the build commit, computed before anything is written. */
export interface TreePlan {
  readonly treeSha: string;
  /** Files whose blob is not already at their path in the source tree: the ones to write. */
  readonly additions: readonly PlannedFile[];
  /** Paths already present in the source tree with identical content. */
  readonly identical: readonly string[];
}

interface DirectoryNode {
  readonly children: Map<string, DirectoryNode>;
  file?: PlannedFile;
}

function newNode(): DirectoryNode {
  return { children: new Map() };
}

function buildTrie(files: readonly PlannedFile[]): DirectoryNode {
  const root = newNode();
  for (const file of files) {
    let node = root;
    for (const segment of file.path.split('/')) {
      let child = node.children.get(segment);
      if (child === undefined) {
        child = newNode();
        node.children.set(segment, child);
      }
      node = child;
    }
    node.file = file;
  }

  return root;
}

/** The tree mode git records for an entry the API reports, with subtrees and submodules normalised. */
function modeOf(item: GitTreeItem): GitTreeMode {
  if (item.type === 'tree') {
    return '040000';
  }
  if (item.type === 'commit') {
    return '160000';
  }
  if (item.mode === '100644' || item.mode === '100755' || item.mode === '120000') {
    return item.mode;
  }
  throw new Error(`Tree entry ${item.name} has the unexpected mode ${item.mode}.`);
}

/**
 * Checks a bundle against what the source tree has at its path.
 *
 * @returns `added` when the path is free, `identical` when it holds the same blob and the policy allows that
 * @throws an `Error` for any other existing entry
 */
function placeFile(
  path: string,
  file: PlannedFile,
  current: GitTreeItem | undefined,
  policy: ExistingFilesPolicy,
): 'added' | 'identical' {
  if (current === undefined) {
    return 'added';
  }
  if (current.type !== 'blob' || modeOf(current) === '120000') {
    throw new Error(
      `${path} exists in the source commit as a ${current.type === 'tree' ? 'directory' : 'link or submodule'}.`,
    );
  }
  if (policy === 'fail') {
    throw new Error(`${path} already exists in the source commit; a build commit may only add files.`);
  }
  if (current.sha !== file.blobSha) {
    throw new Error(
      `${path} exists in the source commit with other content (blob ${current.sha}, built ${file.blobSha}).`,
    );
  }

  return 'identical';
}

/** Computes the tree of the build commit; see {@link planTree}. */
class TreePlanner {
  readonly additions: PlannedFile[] = [];
  readonly identical: string[] = [];

  constructor(
    private readonly api: Pick<PublishApi, 'getTree'>,
    private readonly policy: ExistingFilesPolicy,
  ) {}

  /** The entry of a bundle, or `undefined` when the identical source entry stays as it is. */
  private file(path: string, node: DirectoryNode, current: GitTreeItem | undefined): GitTreeEntry | undefined {
    const file = node.file as PlannedFile;
    if (node.children.size > 0) {
      throw new Error(`${path} is both a bundle and a directory of bundles.`);
    }
    if (placeFile(path, file, current, this.policy) === 'identical') {
      this.identical.push(path);
      return undefined;
    }
    this.additions.push(file);

    return { name: path.slice(path.lastIndexOf('/') + 1), mode: '100644', sha: file.blobSha };
  }

  /** The entry of a directory on the path of one or more bundles. */
  private async subdirectory(
    path: string,
    node: DirectoryNode,
    current: GitTreeItem | undefined,
  ): Promise<GitTreeEntry> {
    if (current !== undefined && current.type !== 'tree') {
      throw new Error(`${path} exists in the source commit as a file, not a directory.`);
    }

    return {
      name: path.slice(path.lastIndexOf('/') + 1),
      mode: '040000',
      sha: await this.directory(node, current?.sha, path),
    };
  }

  /** The id of the directory `node` describes, laid over the source directory `treeSha` (absent: empty). */
  async directory(node: DirectoryNode, treeSha: string | undefined, prefix: string): Promise<string> {
    const existing = new Map(
      (treeSha === undefined ? [] : await this.api.getTree(treeSha)).map((item) => [item.name, item]),
    );
    const entries = new Map<string, GitTreeEntry>(
      [...existing.values()].map((item) => [item.name, { name: item.name, mode: modeOf(item), sha: item.sha }]),
    );

    for (const [name, child] of node.children) {
      const path = prefix === '' ? name : `${prefix}/${name}`;
      const current = existing.get(name);
      const entry =
        child.file === undefined ? await this.subdirectory(path, child, current) : this.file(path, child, current);
      if (entry !== undefined) {
        entries.set(name, entry);
      }
    }

    return gitTreeId([...entries.values()]);
  }
}

/**
 * Computes the tree of the build commit: the source tree with every bundle added.
 *
 * Only the directories on a bundle's path are read, one tree object each, and the new tree ids are
 * computed locally with git's own encoding. The result is known before anything is written, which is
 * what a dry run reports, and the id GitHub returns for the created tree can be checked against it.
 *
 * Invariant: the build commit only adds files. A path that exists as a directory or a link, or exists
 * as a file under `fail`, or with other content under `require-identical`, is refused.
 *
 * @throws an `Error` naming the first path that breaks the invariant
 */
export async function planTree(
  api: Pick<PublishApi, 'getTree'>,
  sourceTree: string,
  files: readonly PlannedFile[],
  policy: ExistingFilesPolicy,
): Promise<TreePlan> {
  const planner = new TreePlanner(api, policy);
  const treeSha = await planner.directory(buildTrie(files), sourceTree, '');

  return { treeSha, additions: planner.additions, identical: planner.identical };
}
