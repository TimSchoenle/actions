/**
 * The job summary: Markdown and HTML appended to the file the runner names in `GITHUB_STEP_SUMMARY`.
 *
 * The subset of `@actions/core`'s `summary` this repository uses, rendering exactly the same markup.
 * Like the toolkit's, the builder does not escape what it is given: callers escape untrusted text
 * before adding it (see the `escapeHtml` helpers beside each caller).
 */
import { constants } from 'node:fs';
import { access, appendFile, writeFile } from 'node:fs/promises';
import { EOL } from 'node:os';

/** The environment variable the runner names the summary file in. */
export const SUMMARY_ENV_VAR = 'GITHUB_STEP_SUMMARY';

/** One cell of {@link Summary.addTable}: plain content, or content with header and span attributes. */
export type SummaryTableCell = string | SummaryTableCellObject;

export interface SummaryTableCellObject {
  /** The cell's content. */
  data: string;
  /** Render as `<th>` rather than `<td>`. */
  header?: boolean;
  /** The `colspan` attribute. */
  colspan?: string;
  /** The `rowspan` attribute. */
  rowspan?: string;
}

/** Options for {@link Summary.write}. */
export interface SummaryWriteOptions {
  /** Replace the file's content instead of appending to it. */
  overwrite?: boolean;
}

/** A job summary under construction, written to the summary file by {@link Summary.write}. */
export class Summary {
  private buffer = '';
  private filePath: string | undefined;

  /** The summary file, resolved and checked once, then reused for every later write. */
  private async resolveFilePath(): Promise<string> {
    if (this.filePath !== undefined) {
      return this.filePath;
    }

    const fromEnv = process.env[SUMMARY_ENV_VAR];
    if (!fromEnv) {
      throw new Error(
        `Unable to find environment variable for $${SUMMARY_ENV_VAR}. Check if your runtime environment supports job summaries.`,
      );
    }

    try {
      await access(fromEnv, constants.R_OK | constants.W_OK);
    } catch {
      throw new Error(
        `Unable to access summary file: '${fromEnv}'. Check if the file has correct read/write permissions.`,
      );
    }

    this.filePath = fromEnv;

    return fromEnv;
  }

  /** Wraps `content` in `tag`, which is left open when there is no content. */
  private wrap(tag: string, content: string | null, attributes: Readonly<Record<string, string>> = {}): string {
    const rendered = Object.entries(attributes)
      .map(([key, value]) => ` ${key}="${value}"`)
      .join('');

    return content ? `<${tag}${rendered}>${content}</${tag}>` : `<${tag}${rendered}>`;
  }

  /** Writes the buffer to the summary file, appending unless told to overwrite, and empties it. */
  async write(options?: SummaryWriteOptions): Promise<Summary> {
    const filePath = await this.resolveFilePath();
    const writeFunction = options?.overwrite ? writeFile : appendFile;

    await writeFunction(filePath, this.buffer, { encoding: 'utf8' });

    return this.emptyBuffer();
  }

  /** The buffered content, not yet written. */
  stringify(): string {
    return this.buffer;
  }

  /** Whether nothing is buffered. */
  isEmptyBuffer(): boolean {
    return this.buffer.length === 0;
  }

  /** Discards the buffered content without writing it. */
  emptyBuffer(): Summary {
    this.buffer = '';

    return this;
  }

  /** Appends `text` verbatim, followed by a line break when `addEOL` is set. */
  addRaw(text: string, addEOL = false): Summary {
    this.buffer += text;

    return addEOL ? this.addEOL() : this;
  }

  /** Appends the platform's line break. */
  addEOL(): Summary {
    return this.addRaw(EOL);
  }

  /** Appends a heading of `level` 1–6; any other level renders as `<h1>`. */
  addHeading(text: string, level?: number | string): Summary {
    const tag = `h${level}`;
    const allowed = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(tag) ? tag : 'h1';

    return this.addRaw(this.wrap(allowed, text)).addEOL();
  }

  /** Appends a table, one array of cells per row. */
  addTable(rows: readonly (readonly SummaryTableCell[])[]): Summary {
    const body = rows
      .map((row) => {
        const cells = row
          .map((cell) => {
            if (typeof cell === 'string') {
              return this.wrap('td', cell);
            }

            const { header, data, colspan, rowspan } = cell;
            const attributes: Record<string, string> = {
              ...(colspan && { colspan }),
              ...(rowspan && { rowspan }),
            };

            return this.wrap(header ? 'th' : 'td', data, attributes);
          })
          .join('');

        return this.wrap('tr', cells);
      })
      .join('');

    return this.addRaw(this.wrap('table', body)).addEOL();
  }
}

/** The step's job summary. One instance, as in `@actions/core`, so every caller appends to one buffer. */
export const summary = new Summary();
