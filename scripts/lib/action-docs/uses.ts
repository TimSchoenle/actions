/**
 * Reading and rewriting `uses:` lines, for the "called by" list and for pinning example workflows.
 *
 * Line-based on purpose: rewriting a parsed and re-serialised YAML document would drop the comments
 * and the layout an example is written with.
 */

const USES_KEY = 'uses:';

/** Where a reference ends: whitespace, a quote, or the start of a comment. */
const REFERENCE_END = /[\s'"#]/;

/**
 * Splits a `uses:` line, as a step (`- uses: x`) or a key under one (`uses: x`), into everything up to
 * the value and the reference itself, unquoted. `undefined` for any other line.
 *
 * Parsed by hand rather than with one regular expression: the optional `- `, quote and comment parts
 * nest quantifiers in a way the security lint rightly reads as backtracking-prone.
 */
function parseUsesLine(line: string): { prefix: string; reference: string } | undefined {
  const indent = line.length - line.trimStart().length;
  let cursor = indent;
  if (line.startsWith('- ', cursor)) {
    cursor += 2;
    while (line[cursor] === ' ') {
      cursor += 1;
    }
  }
  if (!line.startsWith(USES_KEY, cursor)) {
    return undefined;
  }
  cursor += USES_KEY.length;
  // YAML needs whitespace after the colon: `uses:./x` is one scalar, not a key and a value.
  if (line[cursor] !== ' ' && line[cursor] !== '\t') {
    return undefined;
  }
  while (line[cursor] === ' ' || line[cursor] === '\t') {
    cursor += 1;
  }
  const prefix = line.slice(0, cursor);

  const quote = line[cursor] === "'" || line[cursor] === '"' ? line[cursor] : '';
  const start = cursor + quote.length;
  const rest = line.slice(start);
  const end = rest.search(REFERENCE_END);
  const reference = end === -1 ? rest : rest.slice(0, end);
  return reference ? { prefix, reference } : undefined;
}

/**
 * The repository-relative action directory a `uses:` reference points into this repository, or
 * `undefined` for anything else.
 *
 * Both forms count: `./actions/x/y` from inside the repository and `<owner>/<repo>/actions/x/y@ref`
 * from a pinned caller. The owner is compared case-insensitively, as GitHub resolves it.
 */
export function referencedAction(reference: string, repoId: string): string | undefined {
  const withoutRef = reference.split('@')[0];
  let candidate: string;
  if (withoutRef.startsWith('./')) {
    candidate = withoutRef.slice(2);
  } else if (withoutRef.toLowerCase().startsWith(`${repoId.toLowerCase()}/`)) {
    candidate = withoutRef.slice(repoId.length + 1);
  } else {
    return undefined;
  }
  candidate = candidate.replace(/\/+$/, '');
  return candidate.startsWith('actions/') ? candidate : undefined;
}

/** Every action directory of this repository that a workflow or action file calls. */
export function referencedActions(content: string, repoId: string): Set<string> {
  const found = new Set<string>();
  for (const line of content.split('\n')) {
    const parsed = parseUsesLine(line);
    const action = parsed ? referencedAction(parsed.reference, repoId) : undefined;
    if (action) {
      found.add(action);
    }
  }
  return found;
}

/**
 * Rewrites every `uses:` line that calls `actionPath` to `pinned`, keeping its indentation. A comment
 * after the original reference is replaced too, since `pinned` carries its own `# tag=` comment.
 *
 * Returns how many lines were rewritten, so the caller can refuse an example that never calls the
 * action it documents.
 */
export function pinUses(
  content: string,
  repoId: string,
  actionPath: string,
  pinned: string,
): { content: string; replaced: number } {
  let replaced = 0;
  const lines = content.split('\n').map((line) => {
    const parsed = parseUsesLine(line);
    if (!parsed || referencedAction(parsed.reference, repoId) !== actionPath) {
      return line;
    }
    replaced += 1;
    return `${parsed.prefix}${pinned}`;
  });
  return { content: lines.join('\n'), replaced };
}
