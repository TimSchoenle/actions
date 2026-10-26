/** The merge methods GitHub's auto-merge accepts. */
export type MergeMethod = 'merge' | 'rebase' | 'squash';

const MERGE_METHODS: readonly MergeMethod[] = ['merge', 'rebase', 'squash'];

/**
 * Validates `merge_method`.
 *
 * The workflow this action replaces interpolated the value into `gh pr merge --"$MERGE_METHOD"`, so a
 * value such as `admin` became the `--admin` flag and bypassed branch protection. Only the three
 * methods themselves are accepted here, lower-case, as they are documented.
 *
 * @throws if the value is not one of `merge`, `rebase` or `squash`.
 */
export function parseMergeMethod(value: string): MergeMethod {
  if (!(MERGE_METHODS as readonly string[]).includes(value)) {
    throw new Error(`Invalid 'merge_method' ${JSON.stringify(value)}. Expected one of: ${MERGE_METHODS.join(', ')}.`);
  }

  return value as MergeMethod;
}
