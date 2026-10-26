import { MAX_ROUNDS } from './wipe.js';

import type { CacheEntry } from './github-api.js';
import type { StopReason, WipeResult } from './wipe.js';

/** Rows listed per table before the rest are counted instead of shown. */
export const MAX_ROWS = 50;

/** Characters that would break out of a table cell or a code span. */
const CELL_UNSAFE = /[|`\r\n]/g;

const MAX_CELL_LENGTH = 120;

/** Renders an untrusted value as a code span that cannot escape its table cell. */
function cell(value: string): string {
  const flattened = value.replace(CELL_UNSAFE, ' ').trim();
  const clipped = flattened.length > MAX_CELL_LENGTH ? `${flattened.slice(0, MAX_CELL_LENGTH)}...` : flattened;

  return clipped === '' ? '(empty)' : `\`${clipped}\``;
}

/** Renders a byte count in binary units, e.g. `1.5 MiB`. */
export function formatBytes(bytes: number): string {
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  let value = bytes;
  let unit = 0;

  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }

  return unit === 0 ? `${value} B` : `${value.toFixed(1)} ${units[unit]}`;
}

const STOP_REASONS: Record<StopReason, string> = {
  'dry-run': 'Dry run: nothing was deleted.',
  empty: 'No cache entries are left for the branch.',
  'no-progress': 'A round deleted nothing, so the remaining entries were left in place.',
  'round-limit': `Entries were still being listed after ${MAX_ROUNDS} rounds; a job may still be saving caches.`,
};

function totalBytes(entries: readonly CacheEntry[]): number {
  return entries.reduce((sum, entry) => sum + entry.sizeInBytes, 0);
}

function truncationNote(total: number): string[] {
  return total > MAX_ROWS ? ['', `${total - MAX_ROWS} more not shown.`] : [];
}

function entryTable(entries: readonly CacheEntry[]): string[] {
  const rows = entries
    .slice(0, MAX_ROWS)
    .map((entry) => `| ${cell(entry.key)} | ${entry.id} | ${formatBytes(entry.sizeInBytes)} |`);

  return ['| Key | Id | Size |', '| --- | --- | --- |', ...rows, ...truncationNote(entries.length)];
}

/**
 * Renders the outcome as Markdown for the job summary.
 *
 * Cache keys are written by whatever workflow saved the entry, so they are escaped rather than
 * trusted: a key containing `|` or a newline would otherwise break the table it sits in.
 */
export function renderSummary(result: WipeResult, repository: string, ref: string, dryRun: boolean): string {
  const lines = [
    `### Cache wipe for ${cell(ref)} in ${cell(repository)}`,
    '',
    '| Matched | Deleted | Already gone | Failed | Freed |',
    '| --- | --- | --- | --- | --- |',
    `| ${result.matched.length} | ${result.deleted.length} | ${result.alreadyGone.length} | ${result.failures.length} | ${formatBytes(totalBytes(result.deleted))} |`,
    '',
    STOP_REASONS[result.stopReason],
  ];

  if (dryRun && result.matched.length > 0) {
    lines.push('', '#### Would delete', '', ...entryTable(result.matched));
  }

  if (result.failures.length > 0) {
    const rows = result.failures
      .slice(0, MAX_ROWS)
      .map(({ entry, message }) => `| ${cell(entry.key)} | ${entry.id} | ${cell(message)} |`);

    lines.push(
      '',
      '#### Not deleted',
      '',
      '| Key | Id | Error |',
      '| --- | --- | --- |',
      ...rows,
      ...truncationNote(result.failures.length),
    );
  }

  return `${lines.join('\n')}\n`;
}
