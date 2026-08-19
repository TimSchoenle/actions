import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { CARGO, CONTRACT_FORMATS, cargoArguments, createCargoGenerator, renderAll } from './generator.js';
import { GeneratorError } from './errors.js';
import { resolveOptions } from './options.js';

import type { CommandResult, CommandRunner } from './command.js';
import type { ContractFormat, ContractGenerator } from './generator.js';
import type { RawInputs } from './options.js';

const WORKSPACE = path.resolve('/workspace');

const DEFAULTS: RawInputs = {
  source_directory: '.',
  example: 'config-schema',
  bin: '',
  package: '',
  features: '',
  dockerfile: '',
  contract: '',
  image: '',
  contract_path: '/config/contract.json',
  extra_args: '',
};

function options(overrides: Partial<RawInputs> = {}) {
  return resolveOptions({ ...DEFAULTS, ...overrides }, WORKSPACE);
}

interface Invocation {
  command: string;
  args: string[];
  cwd: string | undefined;
}

/** A runner that records what it was asked to run and answers from a canned table. */
function recordingRunner(answer: (args: readonly string[]) => Partial<CommandResult>): {
  run: CommandRunner;
  invocations: Invocation[];
} {
  const invocations: Invocation[] = [];

  const run: CommandRunner = (command, args, runOptions) => {
    invocations.push({ command, args: [...args], cwd: runOptions.cwd });

    return Promise.resolve({ exitCode: 0, stdout: '', stderr: '', ...answer(args) });
  };

  return { run, invocations };
}

/** A generator whose renderings are supplied directly, for exercising `renderAll` alone. */
function fixedGenerator(renderings: Partial<Record<ContractFormat, string>>): ContractGenerator {
  return { render: (format) => Promise.resolve(renderings[format] ?? 'rendered') };
}

describe('cargoArguments', () => {
  it('renders the minimal invocation for a root package with no features', () => {
    expect(cargoArguments(options(), 'contract')).toEqual([
      'run',
      '--quiet',
      '--example',
      'config-schema',
      '--',
      '--format',
      'contract',
      '--path',
      '/config/contract.json',
    ]);
  });

  // The flag comes from the target's own kind, so a run cannot select `--bin` and then name the
  // example, which is the one way these two could disagree.
  it('selects a binary target with --bin rather than --example', () => {
    const args = cargoArguments(options({ example: '', bin: 'config-contract' }), 'contract');

    expect(args.slice(0, 4)).toEqual(['run', '--quiet', '--bin', 'config-contract']);
    expect(args).not.toContain('--example');
  });

  it("appends the caller's own arguments after the two the action supplies", () => {
    const args = cargoArguments(options({ extra_args: '--service api' }), 'contract');

    expect(args.slice(args.indexOf('--'))).toEqual([
      '--',
      '--format',
      'contract',
      '--path',
      '/config/contract.json',
      '--service',
      'api',
    ]);
  });

  it('emits nothing at all for an empty extra_args', () => {
    expect(cargoArguments(options({ extra_args: '   ' }), 'contract')).toEqual(cargoArguments(options(), 'contract'));
  });

  it('carries a quoted generator argument through as one argument', () => {
    expect(cargoArguments(options({ extra_args: '--label "two words"' }), 'labels')).toContain('two words');
  });

  it('passes a workspace member as -p', () => {
    expect(cargoArguments(options({ package: 'api-config' }), 'labels')).toContain('-p');
    expect(cargoArguments(options({ package: 'api-config' }), 'labels')).toContain('api-config');
  });

  it('joins features into the single argument cargo expects', () => {
    const args = cargoArguments(options({ features: 'config-schema, cli' }), 'labels');

    expect(args[args.indexOf('--features') + 1]).toBe('config-schema,cli');
  });

  // Everything after `--` belongs to the generator, not to cargo. A format that landed before it
  // would be read as a cargo flag, which is a different failure from the one it looks like.
  it('puts the generator flags after the separator', () => {
    const args = cargoArguments(options({ package: 'api', features: 'a' }), 'dockerfile');
    const separator = args.indexOf('--');

    expect(separator).toBeGreaterThan(-1);
    expect(args.slice(0, separator)).not.toContain('--format');
    expect(args.slice(separator + 1)).toEqual(['--format', 'dockerfile', '--path', '/config/contract.json']);
  });

  // A vector, not a command line: nothing here is ever re-split by a shell, so an argument holding
  // whitespace stays one argument. `features` is the only input that turns whitespace into a
  // separator, and it does so before this point, in the parser that also refuses a flag.
  it('emits one argument per element, none of them holding whitespace', () => {
    const args = cargoArguments(options({ features: 'a b' }), 'contract');

    expect(args).toContain('a,b');
    expect(args.filter((argument) => /\s/.test(argument))).toEqual([]);
  });
});

describe('createCargoGenerator', () => {
  it('runs cargo in the source directory, not in the workspace root', async () => {
    const { run, invocations } = recordingRunner(() => ({ stdout: 'rendered' }));
    const resolved = options({ source_directory: 'services/api' });

    await createCargoGenerator(resolved, run).render('contract');

    expect(invocations).toHaveLength(1);
    expect(invocations[0].command).toBe(CARGO);
    expect(invocations[0].cwd).toBe(path.join(WORKSPACE, 'services', 'api'));
  });

  it('returns exactly what the generator wrote to stdout', async () => {
    const { run } = recordingRunner(() => ({ stdout: '{"terrace_contract":1}\n' }));

    await expect(createCargoGenerator(options(), run).render('contract')).resolves.toBe('{"terrace_contract":1}\n');
  });

  it('fails the step when cargo does, quoting what it said', async () => {
    const { run } = recordingRunner(() => ({ exitCode: 101, stderr: 'error: no example target named `x`' }));

    await expect(createCargoGenerator(options(), run).render('contract')).rejects.toThrow(GeneratorError);
    await expect(createCargoGenerator(options(), run).render('contract')).rejects.toThrow(/no example target/);
  });

  it('names the exit code, which is how a cargo failure is told from a generator failure', async () => {
    const { run } = recordingRunner(() => ({ exitCode: 101 }));

    await expect(createCargoGenerator(options(), run).render('labels')).rejects.toThrow(/exited with 101/);
  });
});

describe('renderAll', () => {
  it('renders every format of one run', async () => {
    const renderings = await renderAll(fixedGenerator({ contract: 'c', labels: 'l', dockerfile: 'd' }));

    expect(renderings).toEqual({ contract: 'c', labels: 'l', dockerfile: 'd' });
  });

  it('renders the three formats and nothing else', async () => {
    const asked: ContractFormat[] = [];

    await renderAll({
      render: (format) => {
        asked.push(format);

        return Promise.resolve('x');
      },
    });

    expect(asked).toEqual([...CONTRACT_FORMATS]);
  });

  // A generator that wrote nothing would make every comparison trivially true. The interesting case
  // is the one where two of the three came out and the third did not, so it is checked per format.
  it.each(CONTRACT_FORMATS)('refuses a run whose %s rendering is blank', async (format) => {
    await expect(renderAll(fixedGenerator({ [format]: '   \n' }))).rejects.toThrow(GeneratorError);
    await expect(renderAll(fixedGenerator({ [format]: '' }))).rejects.toThrow(
      new RegExp(`--format ${format}\` produced nothing`),
    );
  });
});

describe('the generator run as a whole', () => {
  it('renders three formats from one source tree in one pass', async () => {
    const { run, invocations } = recordingRunner((args) => ({ stdout: `rendered ${args.at(-3)}` }));

    const renderings = await renderAll(createCargoGenerator(options(), run));

    expect(invocations).toHaveLength(3);
    expect(invocations.map((invocation) => invocation.args.at(-3))).toEqual([...CONTRACT_FORMATS]);
    expect(renderings.contract).toBe('rendered contract');
    expect(renderings.dockerfile).toBe('rendered dockerfile');
  });

  it('stops at the first format that fails, having compared nothing', async () => {
    const { run, invocations } = recordingRunner((args) =>
      args.includes('labels') ? { exitCode: 1 } : { stdout: 'x' },
    );

    await expect(renderAll(createCargoGenerator(options(), run))).rejects.toThrow(GeneratorError);
    expect(invocations).toHaveLength(2);
  });
});
