/** The pathspecs to scope a `git status` to, and whether any scoping is needed at all. */
export interface Pathspecs {
  /** False when the caller asked for the whole tree, so no `-- <pathspec>` should be passed. */
  useFilter: boolean;
  /** The git pathspecs, glob-magic already applied. Empty when {@link useFilter} is false. */
  specs: string[];
}

/** The shell glob metacharacters that make a pattern a wildcard rather than a literal path. */
const GLOB_CHARS = /[*?[]/;

/** A git magic pathspec, e.g. `:(glob)src/**`, which the caller has already spelled out. */
function isMagicPathspec(spec: string): boolean {
  return spec.startsWith(':(');
}

/**
 * Translates the space-separated `file_pattern` input into git pathspecs.
 *
 * A wildcard pattern is wrapped in `:(glob)` so that `*` matches across the whole path the way a
 * caller writing `src/**` expects, rather than git's default pathspec semantics where `*` does not
 * cross a `/`. A pattern the caller already wrote as a magic pathspec is passed through untouched, and
 * a plain path is left literal.
 *
 * An empty pattern or the whole-tree pattern `.` disables filtering entirely, so `git status` reports
 * every change instead of being scoped to a path that happens to be named `.`.
 */
export function buildPathspecs(filePattern: string): Pathspecs {
  if (filePattern === '' || filePattern === '.') {
    return { specs: [], useFilter: false };
  }

  const specs = filePattern
    .split(/\s+/)
    .filter((spec) => spec !== '')
    .map((spec) => {
      if (isMagicPathspec(spec)) {
        return spec;
      }

      return GLOB_CHARS.test(spec) ? `:(glob)${spec}` : spec;
    });

  if (specs.length === 0) {
    return { specs: [], useFilter: false };
  }

  return { specs, useFilter: true };
}
