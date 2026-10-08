/**
 * Where the markdown comes from.
 *
 * Three inputs rather than one because the shapes have different failure modes. A short status
 * line is naturally written inline; a generated report — an image-size table, a coverage summary — is
 * already a file, and routing it through a `${{ }}` expression is where quoting and injection
 * problems come from. A list of lines gated by step outputs is the third shape: the runner has
 * already evaluated every condition, so the action sees only lines, some of them empty, and a run
 * where every line is empty has nothing to report. Making the three exclusive keeps a workflow from
 * setting two and silently getting whichever the action happened to prefer.
 */
import { readFile } from 'node:fs/promises';

import { quoteForLog, resolveRealWithinWorkspace } from 'actions-util';

import { carriesMarkerLine } from './marker.js';

/** The body inputs, exactly as the runner delivered them. */
export interface BodySource {
  body: string;
  bodyFile: string;
  /** Read untrimmed, so the first surviving line keeps its indent. Set means non-empty before trimming. */
  bodyLines: string;
  header: string;
  footer: string;
}

/** Raised when the body inputs do not name exactly one non-empty body, or name an invalid combination. */
export class BodySourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BodySourceError';
  }
}

/** Separates the header, the lines and the footer: one blank line, so each renders as its own block. */
const BLOCK_SEPARATOR = '\n\n';

/**
 * Composes a body from lines gated by the caller, or reports that nothing survived.
 *
 * Trimming decides only whether a line survives. A surviving line is kept verbatim, so an indented
 * sub-bullet stays nested, and the input order is kept, because the caller's order is the reading
 * order. CRLF from a Windows-authored workflow file splits into the same lines as LF.
 *
 * @returns the composed markdown, or `undefined` when no line survived. A header or footer alone is
 * not a report, so it never turns a skip into a comment.
 */
export function composeLines(lines: string, header: string, footer: string): string | undefined {
  const surviving = lines.split(/\r?\n/).filter((line) => line.trim() !== '');

  if (surviving.length === 0) {
    return undefined;
  }

  return [header, surviving.join('\n'), footer].filter((block) => block !== '').join(BLOCK_SEPARATOR);
}

/** Rejects every combination of inputs that does not name exactly one body source. */
function validateSource({ body, bodyFile, bodyLines, header, footer }: BodySource): void {
  const set = [body, bodyFile, bodyLines].filter((value) => value !== '').length;

  if (set > 1) {
    throw new BodySourceError("only one of 'body', 'body_file' and 'body_lines' may be set");
  }

  if (set === 0) {
    throw new BodySourceError("one of 'body', 'body_file' and 'body_lines' must be set");
  }

  // Ignoring them would post a comment missing text the workflow asked for.
  if (bodyLines === '' && header !== '') {
    throw new BodySourceError("'header' is only valid with 'body_lines'");
  }

  if (bodyLines === '' && footer !== '') {
    throw new BodySourceError("'footer' is only valid with 'body_lines'");
  }
}

/**
 * Reads the markdown the comment is to carry.
 *
 * An empty `body` or `body_file` is refused rather than posted: a comment holding nothing but the
 * hidden marker renders as a blank comment, and every later run would then find and rewrite that
 * blank — a misconfigured path would be indistinguishable from a report that had nothing to say.
 * `body_lines` is different: every line being empty is the caller saying there is nothing to report,
 * which is a skip, not an error.
 *
 * @returns the markdown, or `undefined` when `body_lines` was given and no line survived.
 * @throws {@link BodySourceError} if the inputs do not name exactly one source, `header` or `footer`
 * is set without `body_lines`, the file is empty, or the body carries a marker line of its own.
 * @throws {@link UnsafePathError} if `body_file` leaves the workspace.
 */
export async function resolveBody(source: BodySource, workspace: string): Promise<string | undefined> {
  validateSource(source);

  const markdown = await readSource(source, workspace);

  // The value is not echoed: it may carry whatever the workflow interpolated into it.
  if (markdown !== undefined && carriesMarkerLine(markdown)) {
    throw new BodySourceError(
      'the body carries a comment marker on a line of its own, which would let a later run for that ' +
        'identifier find and overwrite this comment',
    );
  }

  return markdown;
}

/** The markdown the one validated source names, or `undefined` when `body_lines` left nothing. */
async function readSource(
  { body, bodyFile, bodyLines, header, footer }: BodySource,
  workspace: string,
): Promise<string | undefined> {
  if (bodyLines !== '') {
    return composeLines(bodyLines, header, footer);
  }

  if (body !== '') {
    return body;
  }

  const contents = await readFile(await resolveRealWithinWorkspace(bodyFile, workspace, 'body_file'), 'utf8');

  if (contents.trim() === '') {
    throw new BodySourceError(`body_file ${quoteForLog(bodyFile)} is empty`);
  }

  return contents;
}
