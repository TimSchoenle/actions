import { quoteForLog } from 'actions-util';

/** The namespace every branch ref lives under, and the prefix the cache API filters on. */
export const BRANCH_REF_PREFIX = 'refs/heads/';

/** A branch named both ways the cache API and the repository API need it. */
export interface BranchTarget {
  /** Short name, e.g. `feature/x`; compared against the repository default branch. */
  name: string;
  /** Fully qualified ref, e.g. `refs/heads/feature/x`; the `ref` filter of the cache list. */
  ref: string;
}

/**
 * Characters and sequences `git check-ref-format` rejects in a branch name.
 *
 * Checked here rather than left to the API: the cache list treats `ref` as an opaque filter, so a
 * malformed name does not fail, it matches nothing, and the step would report a clean wipe of a
 * branch that cannot exist.
 */
// eslint-disable-next-line no-control-regex -- control characters are exactly what this rejects
const FORBIDDEN_CHARACTERS = /[\x00-\x20\x7F~^:?*[\\]/u;
const FORBIDDEN_SEQUENCES = ['..', '@{'] as const;

function invalid(input: string, reason: string): Error {
  return new Error(`Invalid branch ${quoteForLog(input)}: ${reason}.`);
}

/**
 * Resolves the `branch` input to a short name and a `refs/heads/` ref.
 *
 * Accepts both `feature/x` and `refs/heads/feature/x`: a `delete` event carries the short name in
 * `github.event.ref`, while `github.ref` and most other contexts carry the full ref. Any other
 * `refs/` namespace is refused rather than nested under `refs/heads/`: `refs/tags/v1` names a tag,
 * and prefixing it would wipe the caches of a branch literally called `refs/tags/v1` instead.
 *
 * @throws when the input is empty or is not a valid branch name.
 */
export function resolveBranch(input: string): BranchTarget {
  if (input.trim() === '') {
    throw new Error(
      "No branch to wipe. 'branch' is empty, which happens when the workflow was not triggered by a " +
        "branch delete event; pass 'branch' explicitly.",
    );
  }

  const name = input.startsWith(BRANCH_REF_PREFIX) ? input.slice(BRANCH_REF_PREFIX.length) : input;

  if (name === '') {
    throw invalid(input, 'the ref names no branch');
  }

  if (name.startsWith('refs/')) {
    throw invalid(input, `only branches can be wiped, and a full ref must start with '${BRANCH_REF_PREFIX}'`);
  }

  if (FORBIDDEN_CHARACTERS.test(name)) {
    throw invalid(input, 'it contains whitespace, a control character or one of ~ ^ : ? * [ \\');
  }

  const sequence = FORBIDDEN_SEQUENCES.find((candidate) => name.includes(candidate));
  if (sequence !== undefined) {
    throw invalid(input, `it contains '${sequence}'`);
  }

  if (name.startsWith('-') || name.endsWith('.') || name === '@') {
    throw invalid(input, "it starts with '-', ends with '.', or is '@'");
  }

  // Splitting on '/' turns a leading, trailing or doubled separator into an empty segment.
  for (const segment of name.split('/')) {
    if (segment === '' || segment.startsWith('.') || segment.endsWith('.lock')) {
      throw invalid(input, "a path segment is empty, starts with '.' or ends with '.lock'");
    }
  }

  return { name, ref: `${BRANCH_REF_PREFIX}${name}` };
}
