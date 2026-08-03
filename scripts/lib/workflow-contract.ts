import { parse } from 'yaml';

// Pure helpers backing the strict-shell repo contract. Deliberately free of any filesystem or
// Bun-specific API so the vitest suite (which runs under Node) can exercise them against inline
// fixtures as well as against the real workflows on disk.

/** Preamble every multi-command `run:` block must open with. */
export const STRICT_SHELL_PREAMBLE = 'set -euo pipefail';

/**
 * Shells whose steps are in scope. `set -euo pipefail` is bash/POSIX syntax, so a step that opts
 * into `pwsh`, `python` or `cmd` cannot satisfy the contract and is not asked to. An unset `shell`
 * means GitHub's default, which is bash on the Linux runners this repo targets.
 */
const STRICT_SHELL_NAMES: ReadonlySet<string> = new Set(['bash', 'sh']);

export interface RunBlock {
  /** Path into the workflow document, e.g. `jobs.e2e.steps[3]`. */
  location: string;
  /** The step's `name:`, when it has one; the only human-readable handle a reader has. */
  name?: string;
  script: string;
}

interface RawDefaults {
  run?: { shell?: unknown };
}

function defaultShellOf(defaults: unknown): string | undefined {
  const shell = ((defaults ?? {}) as RawDefaults).run?.shell;
  return typeof shell === 'string' ? shell : undefined;
}

function runBlockOf(rawStep: unknown, location: string, inheritedShell: string | undefined): RunBlock | undefined {
  const step = (rawStep ?? {}) as { name?: unknown; run?: unknown; shell?: unknown };
  if (typeof step.run !== 'string') {
    return undefined;
  }

  const shell = typeof step.shell === 'string' ? step.shell : inheritedShell;
  if (shell !== undefined && !STRICT_SHELL_NAMES.has(shell)) {
    return undefined;
  }

  return {
    location,
    name: typeof step.name === 'string' ? step.name : undefined,
    script: step.run,
  };
}

/**
 * Every `run:` block in `content` that is executed by a strict-shell-capable shell.
 *
 * Steps are read from the parsed document rather than from the raw text so that block, folded and
 * quoted scalars all arrive here as the script the runner would actually execute.
 */
export function collectRunBlocks(content: string): RunBlock[] {
  const doc = parse(content) as { defaults?: unknown; jobs?: unknown } | null;
  const workflowShell = defaultShellOf(doc?.defaults);
  const jobs = doc?.jobs && typeof doc.jobs === 'object' ? (doc.jobs as Record<string, unknown>) : {};

  const blocks: RunBlock[] = [];
  for (const [jobId, rawJob] of Object.entries(jobs)) {
    const job = (rawJob ?? {}) as { defaults?: unknown; steps?: unknown };
    const jobShell = defaultShellOf(job.defaults) ?? workflowShell;
    const steps: unknown[] = Array.isArray(job.steps) ? job.steps : [];

    for (const [index, rawStep] of steps.entries()) {
      const block = runBlockOf(rawStep, `jobs.${jobId}.steps[${index}]`, jobShell);
      if (block) {
        blocks.push(block);
      }
    }
  }

  return blocks;
}

/**
 * The commands a `run:` block actually executes.
 *
 * Blank lines and whole-line comments carry no behaviour, and a backslash-continued command is one
 * command however many lines it occupies. Anything else that spans lines — a heredoc body, a
 * multi-line string — is counted as several commands; that only ever makes the contract stricter,
 * and the alternative is embedding a shell parser.
 */
export function effectiveCommands(script: string): string[] {
  const commands: string[] = [];
  let continued = '';

  for (const rawLine of script.split('\n')) {
    const line = rawLine.trim();
    if (continued === '' && (line === '' || line.startsWith('#'))) {
      continue;
    }
    if (line.endsWith('\\')) {
      continued += `${line.slice(0, -1).trim()} `;
      continue;
    }
    commands.push(`${continued}${line}`.trim());
    continued = '';
  }

  if (continued !== '') {
    commands.push(continued.trim());
  }

  return commands;
}

/**
 * Whether a block has to open with {@link STRICT_SHELL_PREAMBLE}.
 *
 * The line is drawn at more than one command. A single-command block (`run: bun run lint`,
 * `run: exit 1`, or a folded scalar that collapses to one command) cannot swallow a failure: its
 * exit code is the step's exit code, which GitHub already checks. The hazard the preamble addresses
 * is the second command running after the first one failed, so it starts at the second command.
 */
export function requiresStrictShell(script: string): boolean {
  return effectiveCommands(script).length > 1;
}

/** Every `run:` block in `content` that must open with the preamble but does not. */
export function findStrictShellViolations(content: string): RunBlock[] {
  return collectRunBlocks(content).filter((block) => {
    const commands = effectiveCommands(block.script);
    return commands.length > 1 && commands[0] !== STRICT_SHELL_PREAMBLE;
  });
}
