import type { PathAllowlist } from './glob.js';
import type { RawChange } from './raw-diff.js';

/** What a patch is allowed to change, from the action inputs. */
export interface PatchPolicy {
  /** Every changed path must match one of these. */
  allowlist: PathAllowlist;
  /** Whether paths under `.github/workflows/` may change at all. */
  allowWorkflowChanges: boolean;
  /** Whether a change whose content git treats as binary is accepted. */
  allowBinary: boolean;
}

/** One reason a changed path is refused. */
export interface PolicyViolation {
  path: string;
  reason: string;
}

/** Mode of a regular, non-executable file. */
const REGULAR_FILE = '100644';
/** Mode of an executable file. */
const EXECUTABLE_FILE = '100755';
/** Mode of a symbolic link. */
const SYMLINK = '120000';
/** Mode of a submodule (gitlink). */
const GITLINK = '160000';

/** Longest accepted path, in UTF-16 code units; far beyond any real one in a repository. */
const MAX_PATH_LENGTH = 4096;

/**
 * Characters a path must not contain: C0 controls, DEL, the backslash a Windows checkout would read as
 * a separator, and U+FFFD, which is what a path that was not valid UTF-8 decodes to — committing that
 * would write a different path from the one the patch named.
 */
// eslint-disable-next-line no-control-regex
const FORBIDDEN_CHARACTERS = /[\u0000-\u001f\u007f\\�]/u;

/**
 * Why `path` is unsafe to commit as written, or `undefined` when it is a plain relative path.
 *
 * git itself refuses most of these when it applies a patch, so a path reaching here this way means
 * either a git that behaves differently or a patch built to probe for one. Each is checked anyway,
 * because this list is the guarantee the action documents and git's rules are not.
 */
export function unsafePathReason(path: string): string | undefined {
  if (path === '') {
    return 'the path is empty';
  }
  if (path.length > MAX_PATH_LENGTH) {
    return `the path is longer than ${MAX_PATH_LENGTH} characters`;
  }
  if (FORBIDDEN_CHARACTERS.test(path)) {
    return 'the path contains a control character, a backslash or bytes that are not valid UTF-8';
  }
  if (path.startsWith('/') || /^[A-Za-z]:/.test(path)) {
    return 'the path is absolute';
  }

  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.') {
      return "the path has an empty or '.' segment";
    }
    if (segment === '..') {
      return "the path traverses upwards with '..'";
    }
    if (segment.toLowerCase() === '.git') {
      return 'the path is inside a .git directory';
    }
  }

  return undefined;
}

/**
 * True for a path under `.github/workflows/`, compared case-insensitively.
 *
 * GitHub reads workflows only from the exact lowercase directory, so the case-insensitive comparison
 * refuses more than it has to. That is the safe direction: a checkout on a case-insensitive filesystem
 * would read `.GitHub/Workflows` as the same directory.
 */
export function isWorkflowPath(path: string): boolean {
  const [first, second] = path.split('/');

  return first?.toLowerCase() === '.github' && second?.toLowerCase() === 'workflows';
}

/** Every directory above `path`, shallowest first: `a/b/c` gives `a` and `a/b`. */
function ancestors(path: string): string[] {
  const segments = path.split('/');

  return segments.slice(0, -1).map((_segment, index) => segments.slice(0, index + 1).join('/'));
}

/** Why the mode transition of `change` cannot be committed, or `undefined` when it can. */
function modeReason(change: RawChange): string | undefined {
  const { dstMode, srcMode, status } = change;

  if (srcMode === SYMLINK || dstMode === SYMLINK) {
    return 'the change creates, modifies or deletes a symbolic link';
  }
  if (srcMode === GITLINK || dstMode === GITLINK) {
    return 'the change touches a submodule';
  }

  switch (status) {
    case 'A': {
      return dstMode === REGULAR_FILE
        ? undefined
        : `a new file must have mode ${REGULAR_FILE}; got ${dstMode}, which the GraphQL commit API cannot record`;
    }
    case 'M': {
      if (srcMode !== dstMode) {
        return `the change alters the file mode from ${srcMode} to ${dstMode}, which the GraphQL commit API cannot record`;
      }
      return srcMode === REGULAR_FILE
        ? undefined
        : `the file has mode ${srcMode}; the GraphQL commit API is not relied on to keep an executable bit, so commit it by hand`;
    }
    case 'D': {
      return srcMode === REGULAR_FILE || srcMode === EXECUTABLE_FILE
        ? undefined
        : `cannot delete an entry of mode ${srcMode}`;
    }
    default: {
      return `change type '${status}' is not supported; only additions, modifications and deletions are`;
    }
  }
}

/**
 * Every reason the changes may not be committed under `policy`, in path order.
 *
 * All violations are collected rather than stopping at the first, so a misconfigured allowlist is
 * fixed in one round trip.
 *
 * @param baseLinks the symbolic links and submodules of the base tree, by path, with their mode. A
 * change below one of them would be written through it on any checkout of the result.
 * @param binaryPaths paths whose old or new content git considers binary.
 */
export function findViolations(
  changes: readonly RawChange[],
  policy: PatchPolicy,
  baseLinks: ReadonlyMap<string, string>,
  binaryPaths: ReadonlySet<string>,
): PolicyViolation[] {
  const violations = changes.flatMap((change) =>
    reasonsFor(change, policy, baseLinks, binaryPaths).map((reason) => ({ path: change.path, reason })),
  );

  // A stable sort, so the reasons for one path keep the order they were checked in.
  return violations.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
}

/** Every reason one change is refused, in the order they are checked. */
function reasonsFor(
  change: RawChange,
  policy: PatchPolicy,
  baseLinks: ReadonlyMap<string, string>,
  binaryPaths: ReadonlySet<string>,
): string[] {
  const unsafe = unsafePathReason(change.path);
  if (unsafe !== undefined) {
    // The remaining checks reason about path structure, which an unsafe path does not have.
    return [unsafe];
  }

  const reasons: string[] = [];

  const linked = ancestors(change.path).find((ancestor) => baseLinks.has(ancestor));
  if (linked !== undefined) {
    const kind = baseLinks.get(linked) === GITLINK ? 'a submodule' : 'a symbolic link';
    reasons.push(`the path is below ${JSON.stringify(linked)}, which is ${kind} in the base commit`);
  }

  const mode = modeReason(change);
  if (mode !== undefined) {
    reasons.push(mode);
  }

  if (isWorkflowPath(change.path) && !policy.allowWorkflowChanges) {
    reasons.push('the path is under .github/workflows/ and allow_workflow_changes is false');
  }

  if (!policy.allowlist.matches(change.path)) {
    reasons.push('the path matches no allowed_paths pattern');
  }

  if (binaryPaths.has(change.path) && !policy.allowBinary) {
    reasons.push('the change is binary and allow_binary is false');
  }

  return reasons;
}
