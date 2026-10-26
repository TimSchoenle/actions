import type { SkipReason, UpdateResult } from './update.js';

/** Characters that would break out of a table cell or a code span. */
const CELL_UNSAFE = /[|`\r\n]/g;

const MAX_CELL_LENGTH = 200;

/** Renders an untrusted value as a code span that cannot escape its table cell. */
function cell(value: string): string {
  const flattened = value.replace(CELL_UNSAFE, ' ').trim();
  const clipped = flattened.length > MAX_CELL_LENGTH ? `${flattened.slice(0, MAX_CELL_LENGTH)}...` : flattened;

  return clipped === '' ? '(empty)' : `\`${clipped}\``;
}

const SKIP_DESCRIPTIONS: Record<SkipReason, string> = {
  draft: 'draft, and skip_drafts is set',
  'fork-not-writable': 'fork does not allow maintainers to push',
  'head-repository-deleted': 'head repository was deleted',
  'label-removed': 'label removed before its turn',
  'not-open': 'closed before its turn',
  'up-to-date': 'already contains its base',
};

/**
 * Renders the outcome as Markdown for the job summary, one row per labelled pull request.
 *
 * Error messages come back from the API and the label from the caller, so both are escaped.
 */
export function renderSummary(result: UpdateResult, repository: string, label: string): string {
  const rows = [
    ...result.updated.map((number) => `| #${number} | updated | update requested |`),
    ...result.skipped.map(({ number, reason }) => `| #${number} | skipped | ${SKIP_DESCRIPTIONS[reason]} |`),
    ...result.failed.map(
      ({ kind, message, number }) =>
        `| #${number} | ${kind === 'rejected' ? 'rejected' : 'failed'} | ${cell(message)} |`,
    ),
  ];

  const lines = [`### Branch updates for ${cell(label)} in ${cell(repository)}`, ''];

  if (rows.length === 0) {
    lines.push('No open pull request carries the label.');
  } else {
    lines.push('| Pull request | Outcome | Detail |', '| --- | --- | --- |', ...rows);
  }

  return `${lines.join('\n')}\n`;
}
