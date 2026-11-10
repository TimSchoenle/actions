/**
 * Path globs for `allowed-paths`: `**` matches any number of path segments, zero included, and `*`
 * matches any run of characters within one segment. Nothing else is special.
 *
 * Matched segment by segment without compiling a regular expression, so a pattern from a workflow
 * input can never become a backtracking expression.
 */

/** Whether one path segment matches one pattern segment containing `*` wildcards. */
function segmentMatches(pattern: string, name: string): boolean {
  const parts = pattern.split('*');
  if (parts.length === 1) {
    return pattern === name;
  }

  const first = parts[0];
  const last = parts[parts.length - 1];
  if (!name.startsWith(first) || !name.endsWith(last) || first.length + last.length > name.length) {
    return false;
  }

  let cursor = first.length;
  const end = name.length - last.length;
  for (const middle of parts.slice(1, -1)) {
    const found = name.indexOf(middle, cursor);
    if (found === -1 || found + middle.length > end) {
      return false;
    }
    cursor = found + middle.length;
  }

  return true;
}

/** Whether `path` (repository-relative, `/`-separated) matches `pattern`. */
export function matchesGlob(pattern: string, path: string): boolean {
  const patternSegments = pattern.split('/');
  const pathSegments = path.split('/');
  // memo[i][j]: whether pattern segments from i match path segments from j.
  const memo = new Map<number, boolean>();

  const match = (i: number, j: number): boolean => {
    const key = i * (pathSegments.length + 1) + j;
    const known = memo.get(key);
    if (known !== undefined) {
      return known;
    }

    let result: boolean;
    if (i === patternSegments.length) {
      result = j === pathSegments.length;
    } else if (patternSegments[i] === '**') {
      result = match(i + 1, j) || (j < pathSegments.length && match(i, j + 1));
    } else {
      result = j < pathSegments.length && segmentMatches(patternSegments[i], pathSegments[j]) && match(i + 1, j + 1);
    }
    memo.set(key, result);

    return result;
  };

  return match(0, 0);
}

/** Parses a space- or newline-separated glob list, rejecting a pattern that could reach outside the repository. */
export function parseGlobs(text: string): string[] {
  const globs = text.split(/\s+/).filter((glob) => glob !== '');
  for (const glob of globs) {
    if (
      glob.startsWith('/') ||
      glob.split('/').some((segment) => segment === '..' || segment === '.' || segment === '')
    ) {
      throw new Error(
        `allowed-paths entry ${JSON.stringify(glob)} must be a relative glob without '.', '..' or empty segments.`,
      );
    }
  }

  return globs;
}
