import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * The documentation index the README's docs table is rendered from.
 *
 * Built by walking the directory rather than by reading a list someone maintains, because the list
 * is the thing that goes stale: a document added in one pull request and indexed in the next is a
 * document nobody links to in between.
 */
export interface DocEntry {
  /** Path relative to the workspace, POSIX-separated, so the same value renders on either OS. */
  path: string;
  /** The document's own first heading, falling back to its filename. */
  title: string;
  /** Its first paragraph, collapsed to one line. Empty when the document has no prose. */
  summary: string;
}

/** How much of a first paragraph is kept. A table cell stops being readable well before this. */
const SUMMARY_LIMIT = 200;

/** Files that are documentation to a reader rather than to a linter. */
const DOCUMENTED_EXTENSIONS = new Set(['.md', '.markdown']);

/** An ATX heading, e.g. `# Title`. Setext headings are not read; nothing in the estate uses them. */
const ATX_HEADING = /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/;

/** Fenced code, which may contain anything at all and must not be read as prose. */
const FENCE = /^\s{0,3}(?:```|~~~)/;

/** Markdown inline syntax that carries no meaning once the text is inside a table cell. */
const INLINE_MARKUP = /!?\[([^\]]*)\]\([^)]*\)|[*_`]/g;

/** Strips links, emphasis and code spans down to their text. */
function plainText(markdown: string): string {
  return markdown.replaceAll(INLINE_MARKUP, '$1').replaceAll(/\s+/g, ' ').trim();
}

function truncate(text: string): string {
  if (text.length <= SUMMARY_LIMIT) {
    return text;
  }

  // Cut at a word boundary so the ellipsis does not land mid-word. A single word longer than the
  // limit has no boundary to find, and is cut where it is.
  const cut = text.slice(0, SUMMARY_LIMIT);
  const boundary = cut.lastIndexOf(' ');

  return `${(boundary > SUMMARY_LIMIT / 2 ? cut.slice(0, boundary) : cut).trimEnd()}…`;
}

/**
 * Pulls the first heading and the first paragraph out of a Markdown document.
 *
 * Both are read from the document itself so that editing a document's own opening lines updates the
 * index, with no second place to remember. Front matter and fenced blocks are skipped: a YAML fence
 * at the top of a file would otherwise be read as the summary, and a shell comment inside a fence
 * would be read as the heading.
 */
export function summarise(source: string, fallbackTitle: string): { title: string; summary: string } {
  const lines = source.split('\n');
  let title: string | undefined;
  let summary = '';
  let inFence = false;
  let index = 0;

  // Front matter, which is a fence of its own kind and must not be mistaken for a horizontal rule.
  if (lines[0]?.trim() === '---') {
    const close = lines.indexOf('---', 1);
    index = close === -1 ? lines.length : close + 1;
  }

  for (; index < lines.length; index++) {
    const line = lines[index];

    if (FENCE.test(line)) {
      inFence = !inFence;
      continue;
    }

    if (inFence || line.trim() === '') {
      continue;
    }

    const heading = ATX_HEADING.exec(line);

    if (heading !== null) {
      // The first heading names the document. A later one starts a section, and a section title is
      // not a summary, so the search for prose continues past it rather than stopping.
      title ??= plainText(heading[1]);
      continue;
    }

    // An HTML comment banner — every generated file in this estate opens with one — is not prose.
    if (line.trimStart().startsWith('<!--')) {
      const close = lines.findIndex((candidate, at) => at >= index && candidate.includes('-->'));
      index = close === -1 ? lines.length : close;
      continue;
    }

    summary = truncate(plainText(line));
    break;
  }

  return { title: title ?? fallbackTitle, summary };
}

/** Every file under a directory, depth-first, with paths relative to `root`. */
async function collect(root: string, directory: string, found: string[]): Promise<void> {
  const entries = await fs.readdir(directory, { withFileTypes: true });

  // Sorted here rather than at the end: readdir order differs between platforms, and an unsorted
  // index would re-render the README with the same rows in a different order on a different runner.
  for (const entry of entries.toSorted((a, b) => (a.name < b.name ? -1 : 1))) {
    const entryPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      await collect(root, entryPath, found);
    } else if (entry.isFile()) {
      found.push(entryPath);
    }
  }
}

/**
 * Builds the documentation index for a directory.
 *
 * A directory that does not exist yields an empty index rather than an error. Most repositories in
 * the estate have no `docs/` yet, and a payload step that fails on its absence would make adopting
 * the standard a two-step migration for no gain — the template renders no table from an empty list.
 *
 * Non-Markdown files are indexed by path with no summary. `docs/config.contract.json` is a document
 * a reader follows a link to, and leaving it out of the table would be the index lying about what
 * the directory holds.
 */
export async function buildDocsIndex(workspace: string, docsDir: string): Promise<DocEntry[]> {
  const root = docsDir.trim();

  if (root === '') {
    return [];
  }

  const absolute = path.resolve(workspace, root);
  const files: string[] = [];

  try {
    if (!(await fs.stat(absolute)).isDirectory()) {
      return [];
    }
  } catch {
    return [];
  }

  await collect(absolute, absolute, files);

  return Promise.all(
    files.map(async (file) => {
      const relative = path.relative(workspace, file).replaceAll('\\', '/');
      const extension = path.extname(file).toLowerCase();

      if (!DOCUMENTED_EXTENSIONS.has(extension)) {
        return { path: relative, title: relative, summary: '' };
      }

      const source = await fs.readFile(file, 'utf8');

      return { path: relative, ...summarise(source, relative) };
    }),
  );
}
