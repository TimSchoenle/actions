/** The merge methods GitHub's auto-merge accepts. */
export type MergeMethod = 'merge' | 'rebase' | 'squash';

const MERGE_METHODS: readonly MergeMethod[] = ['merge', 'rebase', 'squash'];

/**
 * Validates `merge_method`.
 *
 * Only the three methods themselves are accepted, lower-case, as they are documented. A value such
 * as `admin` fails here rather than travelling on: interpolated into `gh pr merge --"$MERGE_METHOD"`,
 * it would become the `--admin` flag and bypass branch protection.
 *
 * @throws if the value is not one of `merge`, `rebase` or `squash`.
 */
export function parseMergeMethod(value: string): MergeMethod {
  if (!(MERGE_METHODS as readonly string[]).includes(value)) {
    throw new Error(`Invalid 'merge_method' ${JSON.stringify(value)}. Expected one of: ${MERGE_METHODS.join(', ')}.`);
  }

  return value as MergeMethod;
}
