import fs from 'node:fs';

import { readReleaseFiles } from './lib/release-tags.js';
import { checkoutSourceTagGit, gitCapture, planSourceTags, tagsToCreate } from './lib/source-tags.js';
import { ROOT_DIR } from './lib/utils.js';

import type { SourceTagDecision } from './lib/source-tags.js';

// Plans the release-please source tags of every package and writes the ones to create as JSON:
//
//   bun scripts/bootstrap-source-tags.ts [--output <file>] [--strict]
//
// Read-only: it creates no tag. The apply job of .github/workflows/bootstrap-source-tags.yml creates
// what the plan lists, with the release App, after checking each commit is on the default branch.
// Needs a checkout with the full history and every tag (fetch-depth: 0, fetch-tags: true).
//
// An unresolved package is reported as a warning and left out of the output. With --strict it also
// fails the run. Without it the plan job stays green and the preflight job of release.yml, which
// checks every source tag, is what fails, with the list of missing tags.

const OUTPUT_FLAG = '--output';
const STRICT_FLAG = '--strict';

export interface BootstrapArgs {
  readonly output: string | undefined;
  readonly strict: boolean;
}

export function parseArgs(argv: readonly string[]): BootstrapArgs {
  let output: string | undefined;
  let strict = false;
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === STRICT_FLAG) {
      strict = true;
    } else if (argument === OUTPUT_FLAG && index + 1 < argv.length && output === undefined) {
      output = argv[++index];
    } else {
      throw new Error(`Usage: bootstrap-source-tags [${OUTPUT_FLAG} <file>] [${STRICT_FLAG}]; got ${argument}.`);
    }
  }

  return { output, strict };
}

/** One line per decision, in the form a workflow log renders: unresolved ones as warnings. */
export function describeDecision(decision: SourceTagDecision): string {
  switch (decision.kind) {
    case 'present':
      return `present    ${decision.tag} at ${decision.sha}`;
    case 'create':
      return `create     ${decision.tag} at ${decision.sha} (${decision.reason})`;
    case 'unresolved':
      return `::warning title=Unresolved source tag::${decision.tag}: ${decision.reason}`;
  }
}

export interface BootstrapIo {
  readonly root: string;
  readonly log: (line: string) => void;
  readonly writeFile: (file: string, content: string) => void;
}

const defaultIo: BootstrapIo = {
  root: ROOT_DIR,
  log: (line) => console.log(line),
  writeFile: (file, content) => fs.writeFileSync(file, content, { flag: 'wx' }),
};

/** @returns the process exit code */
export async function main(argv: readonly string[] = Bun.argv.slice(2), io: BootstrapIo = defaultIo): Promise<number> {
  try {
    const args = parseArgs(argv);
    const decisions = await planSourceTags(await readReleaseFiles(io.root), checkoutSourceTagGit(gitCapture(io.root)));
    for (const decision of decisions) {
      io.log(describeDecision(decision));
    }

    const create = tagsToCreate(decisions);
    const unresolved = decisions.filter((decision) => decision.kind === 'unresolved').length;
    io.log(
      `${decisions.length} package(s): ${decisions.length - create.length - unresolved} present, ` +
        `${create.length} to create, ${unresolved} unresolved.`,
    );
    if (args.output !== undefined) {
      io.writeFile(args.output, `${JSON.stringify(create)}\n`);
    }

    return args.strict && unresolved > 0 ? 1 : 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));

    return 1;
  }
}

if (import.meta.main) {
  process.exit(await main());
}
