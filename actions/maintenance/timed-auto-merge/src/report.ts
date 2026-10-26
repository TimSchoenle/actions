import type { PullRequestOutcome, SkipReason, TimedAutoMergeReport } from './process.js';

/** The three JSON outputs, already serialised. */
export interface ReportOutputs {
  approved: string;
  skipped: string;
  failed: string;
}

/** Splits the outcomes into the `approved`, `skipped` and `failed` outputs. */
export function toOutputs(outcomes: readonly PullRequestOutcome[]): ReportOutputs {
  const approved: number[] = [];
  const skipped: { number: number; reason: SkipReason }[] = [];
  const failed: { number: number; message: string }[] = [];

  for (const outcome of outcomes) {
    switch (outcome.status) {
      case 'approved': {
        approved.push(outcome.number);
        break;
      }
      case 'skipped': {
        skipped.push({ number: outcome.number, reason: outcome.reason });
        break;
      }
      case 'failed': {
        failed.push({ message: outcome.message, number: outcome.number });
        break;
      }
    }
  }

  return { approved: JSON.stringify(approved), failed: JSON.stringify(failed), skipped: JSON.stringify(skipped) };
}

/** HTML entities for the characters that would otherwise be read as markup in a table cell. */
const CELL_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '|': '&#124;',
  '`': '&#96;',
  '[': '&#91;',
  ']': '&#93;',
  '*': '&#42;',
  _: '&#95;',
  '\\': '&#92;',
};

/**
 * Renders untrusted text as the content of one Markdown table cell.
 *
 * Branch names and API error messages reach the step summary, which GitHub renders as Markdown with
 * HTML allowed. A `|` would split the row, a newline would end the table, and `<` or `[` would let a
 * branch name inject markup or a link into the page an operator reads.
 */
export function escapeCell(text: string): string {
  return text.replaceAll(/[&<>|`[\]*_\\]/g, (character) => CELL_ESCAPES[character]).replaceAll(/\s+/g, ' ');
}

function describe(outcome: PullRequestOutcome): { result: string; detail: string } {
  switch (outcome.status) {
    case 'approved': {
      return { detail: `approved at ${outcome.headSha}, auto-merge enabled`, result: 'approved' };
    }
    case 'skipped': {
      return { detail: outcome.detail, result: `skipped (${outcome.reason})` };
    }
    case 'failed': {
      return { detail: outcome.message, result: 'failed' };
    }
  }
}

/** Renders the step summary: one row per pull request whose head branch matched. */
export function renderSummary(report: TimedAutoMergeReport, branchRegex: string): string {
  const lines = [
    '## Timed auto-merge',
    '',
    `${report.outcomes.length} of ${report.openCount} open pull request(s) matched ${escapeCell(branchRegex)}.`,
  ];

  if (report.outcomes.length > 0) {
    lines.push('', '| Pull request | Branch | Result | Detail |', '| --- | --- | --- | --- |');

    for (const outcome of report.outcomes) {
      const { detail, result } = describe(outcome);

      lines.push(`| #${outcome.number} | ${escapeCell(outcome.headRef)} | ${result} | ${escapeCell(detail)} |`);
    }
  }

  return `${lines.join('\n')}\n`;
}
