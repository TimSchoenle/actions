/**
 * Markdown building blocks for the generated README regions.
 *
 * Action READMEs are excluded from oxfmt, so these functions own the final layout. Tables are padded
 * to aligned columns so the raw file reads as well as the rendered one, matching the hand-written
 * tables already in the repository.
 */

/** Collapses every run of whitespace, line breaks included, to one space. */
export function collapseWhitespace(text: string): string {
  return text.replaceAll(/\s+/g, ' ').trim();
}

/** Makes text safe for one table cell: one line, and no `|` that would split the cell. */
export function tableCell(text: string): string {
  return collapseWhitespace(text).replaceAll('|', String.raw`\|`);
}

/**
 * Wraps text in a code span, widening the fence when the text itself contains backticks.
 *
 * CommonMark closes a code span at the first backtick run of the same length as the opener, so a
 * default such as `` `x` `` needs a two-backtick fence, padded with spaces.
 */
export function codeSpan(text: string): string {
  const longestRun = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  const fence = '`'.repeat(longestRun + 1);
  const padding = longestRun > 0 ? ' ' : '';
  return `${fence}${padding}${text}${padding}${fence}`;
}

/** Renders an aligned Markdown table. Cells must already be escaped with {@link tableCell}. */
export function table(headers: readonly string[], rows: readonly (readonly string[])[]): string {
  for (const row of rows) {
    if (row.length !== headers.length) {
      throw new Error(`Table row has ${row.length} cells, expected ${headers.length}: ${JSON.stringify(row)}`);
    }
  }

  const widths = headers.map((header, column) => Math.max(3, header.length, ...rows.map((row) => row[column].length)));
  const line = (cells: readonly string[]) =>
    `| ${cells.map((cell, column) => cell.padEnd(widths[column])).join(' | ')} |`;

  return [line(headers), line(widths.map((width) => '-'.repeat(width))), ...rows.map(line)].join('\n');
}
