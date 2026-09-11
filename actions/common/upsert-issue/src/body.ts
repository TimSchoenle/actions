/**
 * Where the markdown comes from.
 *
 * Two inputs rather than one because the two shapes have different failure modes. A short status
 * line is naturally written inline; a generated report -- a repository-state table, a coverage
 * summary -- is already a file, and routing it through a `${{ }}` expression is where quoting and
 * injection problems come from. Making them exclusive keeps a workflow from setting both and silently
 * getting whichever the action happened to prefer.
 */
import { readFile } from 'node:fs/promises';

import { quoteForLog, resolveWithinWorkspace } from 'actions-util';

/** The two body inputs, exactly as the runner delivered them. */
export interface BodySource {
  body: string;
  bodyFile: string;
}

/** Raised when the body inputs do not name exactly one non-empty body. */
export class BodySourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BodySourceError';
  }
}

/**
 * Reads the markdown the issue is to carry.
 *
 * An empty result is refused rather than posted: an issue holding nothing but the hidden marker
 * renders as a blank issue, and every later run would then find and rewrite that blank -- a
 * misconfigured path would be indistinguishable from a report that had nothing to say.
 *
 * @throws {@link BodySourceError} if both inputs are set, neither is, or the file is empty.
 * @throws {@link UnsafePathError} if `body_file` leaves the workspace.
 */
export async function resolveBody({ body, bodyFile }: BodySource, workspace: string): Promise<string> {
  if (body !== '' && bodyFile !== '') {
    throw new BodySourceError("only one of 'body' and 'body_file' may be set");
  }

  if (body !== '') {
    return body;
  }

  if (bodyFile === '') {
    throw new BodySourceError("one of 'body' and 'body_file' must be set");
  }

  const contents = await readFile(resolveWithinWorkspace(bodyFile, workspace, 'body_file'), 'utf8');

  if (contents.trim() === '') {
    throw new BodySourceError(`body_file ${quoteForLog(bodyFile)} is empty`);
  }

  return contents;
}
