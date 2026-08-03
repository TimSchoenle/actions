/**
 * The Markdown fragment describing what changed, for the pull request body.
 *
 * New values arrive charset-validated, but *old* values come out of the chart and are arbitrary
 * YAML, so they are escaped here rather than trusted. A table is the right shape for this precisely
 * because the images no longer share a version: the reviewer needs to see each service's own
 * before-and-after, not one headline version.
 */
import type { AppliedEdit } from './edits.js';

/** Characters that would break out of a table cell or a code span. */
const CELL_UNSAFE = /[|`\r\n]/g;

const MAX_CELL_LENGTH = 120;

/** Renders one value as a code span that cannot escape its cell. */
function cell(value: string): string {
  const flattened = value.replace(CELL_UNSAFE, ' ').trim();
  const clipped = flattened.length > MAX_CELL_LENGTH ? `${flattened.slice(0, MAX_CELL_LENGTH)}…` : flattened;

  return clipped === '' ? '`` ' : `\`${clipped}\``;
}

/** Renders the applied image updates as a Markdown table, in the order the caller listed them. */
export function renderSummaryTable(edits: readonly AppliedEdit[]): string {
  if (edits.length === 0) {
    return '_No image values were changed._';
  }

  const rows = edits.map((edit) => `| ${cell(edit.key)} | ${cell(edit.old)} | ${cell(edit.new)} |`);

  return ['| Key | From | To |', '| --- | --- | --- |', ...rows].join('\n');
}

/**
 * Wraps the sanitized changelog in a collapsed section, or returns nothing at all.
 *
 * The whole *section* is published rather than the bare text so the composite that assembles the
 * pull request body never has to decide whether there is a changelog: a release without one yields
 * an empty string that leaves no empty heading behind.
 */
export function renderChangelogSection(changelog: string): string {
  if (changelog === '') {
    return '';
  }

  return ['<details>', '<summary>Changelog</summary>', '', changelog, '', '</details>'].join('\n');
}
