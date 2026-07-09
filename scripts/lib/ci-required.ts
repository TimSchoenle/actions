import yaml from 'js-yaml';

// Pure helpers shared by the `generate-ci-required` script and its drift test.
// Intentionally free of any filesystem or Bun-specific APIs so the vitest suite
// (which runs under Node) can exercise the exact logic the generator uses.

/** Matches the per-action verify workflow filenames this repo gates on. */
export const VERIFY_WORKFLOW_PATTERN = /^verify-action-.+\.ya?ml$/;

/** Prefix every verify workflow's aggregate summary check must use. */
export const SUMMARY_CHECK_PREFIX = 'CI Summary:';

/** The single matcher ci-required feeds to ensure-actions-are-executed. */
export const SUMMARY_CHECK_MATCHER = '/^CI Summary:/';

/** Markers delimiting the generated workflow_run list inside ci-required.yaml. */
export const GENERATED_BEGIN = '# <<< generated: verify-workflows';
export const GENERATED_END = '# >>> generated: verify-workflows';

export interface WorkflowJob {
  id: string;
  name?: string;
  needs: string[];
}

export interface ParsedWorkflow {
  name: string;
  jobs: WorkflowJob[];
}

export function isVerifyWorkflowFile(fileName: string): boolean {
  return VERIFY_WORKFLOW_PATTERN.test(fileName);
}

function toNeedsArray(needs: unknown): string[] {
  if (typeof needs === 'string') {
    return [needs];
  }
  if (Array.isArray(needs)) {
    return needs.filter((entry): entry is string => typeof entry === 'string');
  }
  return [];
}

export function parseWorkflow(content: string): ParsedWorkflow {
  const doc = yaml.load(content) as { name?: unknown; jobs?: Record<string, unknown> } | null;
  const name = typeof doc?.name === 'string' ? doc.name : '';
  const rawJobs = doc?.jobs && typeof doc.jobs === 'object' ? doc.jobs : {};

  const jobs: WorkflowJob[] = Object.entries(rawJobs).map(([id, value]) => {
    const job = (value ?? {}) as { name?: unknown; needs?: unknown };
    return {
      id,
      name: typeof job.name === 'string' ? job.name : undefined,
      needs: toNeedsArray(job.needs),
    };
  });

  return { name, jobs };
}

export function summaryJobOf(workflow: ParsedWorkflow): WorkflowJob | undefined {
  return workflow.jobs.find((job) => job.name?.startsWith(SUMMARY_CHECK_PREFIX));
}

export function sortWorkflowNames(names: readonly string[]): string[] {
  return [...names].sort((a, b) => {
    if (a < b) {
      return -1;
    }
    if (a > b) {
      return 1;
    }
    return 0;
  });
}

export function renderWorkflowRunList(names: readonly string[]): string {
  return sortWorkflowNames(names)
    .map((name) => `      - ${name}`)
    .join('\n');
}

function markerBounds(ciRequiredContent: string): { begin: number; end: number } {
  const begin = ciRequiredContent.indexOf(GENERATED_BEGIN);
  const end = ciRequiredContent.indexOf(GENERATED_END);
  if (begin === -1 || end === -1 || end < begin) {
    throw new Error('ci-required.yaml is missing the generated verify-workflows markers.');
  }
  return { begin, end };
}

/** Rewrite the generated `workflows:` block in ci-required.yaml with `names`. */
export function applyGeneratedList(ciRequiredContent: string, names: readonly string[]): string {
  const { begin, end } = markerBounds(ciRequiredContent);
  const before = ciRequiredContent.slice(0, begin + GENERATED_BEGIN.length);
  const after = ciRequiredContent.slice(end);
  const block = `\n    workflows:\n${renderWorkflowRunList(names)}\n    `;
  return `${before}${block}${after}`;
}

/** Read the workflow names currently listed between the generated markers. */
export function extractGeneratedList(ciRequiredContent: string): string[] {
  const { begin, end } = markerBounds(ciRequiredContent);
  return ciRequiredContent
    .slice(begin + GENERATED_BEGIN.length, end)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('- '))
    .map((line) => line.slice(2).trim());
}

// ---------------------------------------------------------------------------
// Summary job generation
//
// Every verify-action-* workflow ends with a generated `summary` job that
// aggregates its other jobs into the single `CI Summary: <name>` check watched
// by ci-required.yaml. The block is delimited by markers and is fully owned by
// the generator so its `needs` list can never drift from the jobs it guards.
// It is deliberately free of any pinned `uses:` action so Renovate never edits
// generated content (which would otherwise fight the generator on every bump).
// ---------------------------------------------------------------------------

export const SUMMARY_JOB_ID = 'summary';
export const SUMMARY_MARKER_BEGIN = '# <<< generated: summary';
export const SUMMARY_MARKER_END = '# >>> generated: summary';

export function summaryNameFor(workflowName: string): string {
  return `${SUMMARY_CHECK_PREFIX} ${workflowName.replace(/^Verify /, '')}`;
}

/** The job ids a workflow's summary must depend on: every job except itself. */
export function gatedJobIds(workflow: ParsedWorkflow): string[] {
  return workflow.jobs.filter((job) => job.id !== SUMMARY_JOB_ID).map((job) => job.id);
}

/** Render the marker-delimited summary block for a verify workflow. */
export function renderSummaryBlock(workflowName: string, gatedIds: readonly string[]): string {
  const summaryName = summaryNameFor(workflowName);
  if (summaryName.includes("'")) {
    throw new Error(`Cannot generate summary for '${workflowName}': names with single quotes are unsupported.`);
  }
  const needsLines = gatedIds.map((id) => `      - ${id}`).join('\n');

  return [
    `  ${SUMMARY_MARKER_BEGIN} (run 'bun run generate-ci-required' to update)`,
    `  ${SUMMARY_JOB_ID}:`,
    `    name: '${summaryName}'`,
    '    if: ${{ always() }}',
    '    needs:',
    needsLines,
    '    runs-on: ubuntu-latest',
    '    permissions: {}',
    '    steps:',
    '      - name: Fail if any verify job did not succeed',
    "        if: ${{ contains(needs.*.result, 'failure') || contains(needs.*.result, 'cancelled') }}",
    '        run: exit 1',
    `  ${SUMMARY_MARKER_END}`,
  ].join('\n');
}

/** Remove an existing summary block (generated or hand-written, always last). */
function stripSummaryBlock(content: string): string {
  const markerIdx = content.indexOf(SUMMARY_MARKER_BEGIN);
  if (markerIdx !== -1) {
    const lineStart = content.lastIndexOf('\n', markerIdx);
    return lineStart === -1 ? '' : content.slice(0, lineStart);
  }
  const jobMatch = new RegExp(`\\n {2}${SUMMARY_JOB_ID}:\\n`).exec(content);
  if (jobMatch) {
    return content.slice(0, jobMatch.index);
  }
  return content;
}

/**
 * Rewrite a verify workflow so its trailing summary job is exactly the
 * generated block: correct name and a `needs` entry for every other job.
 */
export function applySummaryBlock(content: string): string {
  const workflow = parseWorkflow(content);
  const body = stripSummaryBlock(content).replace(/\s+$/, '');
  const block = renderSummaryBlock(workflow.name, gatedJobIds(workflow));
  return `${body}\n\n${block}\n`;
}
