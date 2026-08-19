/**
 * The generator that renders the contract, its labels and its LABEL block.
 *
 * One run of one generator over one source tree, into strings every check below reads. The three
 * renderings are one set — the document, the labels that make it discoverable, and the block a
 * Dockerfile carries — and generating them separately is the one arrangement in which they can
 * disagree with each other rather than with what is committed.
 */
import { stderrTail } from './command.js';
import { GeneratorError } from './errors.js';

import type { CommandRunner } from './command.js';
import type { ContractOptions } from './options.js';

/** The renderings `--format` produces, in the order they are generated. */
export const CONTRACT_FORMATS = ['contract', 'labels', 'dockerfile'] as const;

export type ContractFormat = (typeof CONTRACT_FORMATS)[number];

/** Every rendering of one run, keyed by the format that produced it. */
export type Renderings = Readonly<Record<ContractFormat, string>>;

/** Renders one format of the contract. */
export interface ContractGenerator {
  render(format: ContractFormat): Promise<string>;
}

/** The executable the generator is run through. */
export const CARGO = 'cargo';

/**
 * The argument vector for one rendering.
 *
 * Assembled as a vector rather than a command line, so a feature list or a target name is one
 * argument whatever it contains — and validated before it gets here, so it cannot be a flag.
 *
 * `--example` or `--bin` comes from the target's own kind rather than from a branch, so the flag and
 * the name cannot be selected independently and therefore cannot disagree.
 *
 * The caller's own arguments go last, after the two the action supplies. Order is not the point —
 * a generator parses flags in any order — but a fixed position is: the two arguments this action
 * depends on sit where every message about them says they do, whatever the caller appends.
 */
export function cargoArguments(options: ContractOptions, format: ContractFormat): string[] {
  const args = ['run', '--quiet', `--${options.target.kind}`, options.target.name];

  if (options.packageName !== undefined) {
    args.push('-p', options.packageName);
  }

  if (options.features.length > 0) {
    args.push('--features', options.features.join(','));
  }

  return [...args, '--', '--format', format, '--path', options.embeddedContractPath, ...options.extraArgs];
}

/** Binds {@link ContractGenerator} to `cargo run` in the source directory. */
export function createCargoGenerator(options: ContractOptions, run: CommandRunner): ContractGenerator {
  return {
    async render(format: ContractFormat): Promise<string> {
      const args = cargoArguments(options, format);
      const result = await run(CARGO, args, { cwd: options.sourceDirectory });

      if (result.exitCode !== 0) {
        throw new GeneratorError(
          `\`cargo ${args.join(' ')}\` exited with ${result.exitCode}, so nothing was compared.` +
            `${result.stderr.trim() === '' ? '' : `\n${stderrTail(result.stderr)}`}`,
        );
      }

      return result.stdout;
    },
  };
}

/**
 * Renders every format, refusing a run that produced nothing.
 *
 * A generator that wrote nothing would make every comparison below trivially true, which is the one
 * failure this whole scheme cannot afford. It is checked per format rather than in aggregate,
 * because the interesting case is the one where two of the three came out and the third did not.
 *
 * @throws {GeneratorError} when a format renders as blank.
 */
export async function renderAll(generator: ContractGenerator): Promise<Renderings> {
  const renderings: Partial<Record<ContractFormat, string>> = {};

  for (const format of CONTRACT_FORMATS) {
    const rendered = await generator.render(format);

    if (rendered.trim() === '') {
      throw new GeneratorError(`\`--format ${format}\` produced nothing, so nothing would have been compared.`);
    }

    renderings[format] = rendered;
  }

  return renderings as Renderings;
}
