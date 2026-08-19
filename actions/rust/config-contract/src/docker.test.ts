import { describe, expect, it } from 'vitest';

import { createDockerInspector, DOCKER } from './docker.js';
import { DockerError } from './errors.js';
import { GENERATED_LABEL_FORMAT } from './docker-format.js';

import type { CommandResult, CommandRunner } from './command.js';

const IMAGE = 'myservice:test';
const CONTAINER = 'a'.repeat(64);

interface Invocation {
  args: string[];
}

/** A runner that answers per subcommand, and records the vectors it was handed. */
function fakeDocker(answers: Record<string, Partial<CommandResult>>): {
  run: CommandRunner;
  invocations: Invocation[];
} {
  const invocations: Invocation[] = [];

  const run: CommandRunner = (command, args) => {
    expect(command).toBe(DOCKER);
    invocations.push({ args: [...args] });

    return Promise.resolve({ exitCode: 0, stdout: '', stderr: '', ...answers[args[0]] });
  };

  return { run, invocations };
}

describe('inspectLabels', () => {
  it('asks for the image config labels and parses the answer', async () => {
    const { run, invocations } = fakeDocker({ inspect: { stdout: '{"a":"1"}\n' } });

    await expect(createDockerInspector(run).inspectLabels(IMAGE)).resolves.toEqual({ a: '1' });
    expect(invocations[0].args).toEqual(['inspect', '--format', GENERATED_LABEL_FORMAT, IMAGE]);
  });

  // `docker inspect` reports `.Config.Labels` and `crane config` reports `.config.Labels`. The
  // template is a constant of this action rather than something each repository retypes, which is
  // the whole reason a `null` answer can be read as "no labels" instead of "the reader was wrong".
  it('reads the field docker documents, capitalised as docker documents it', () => {
    expect(GENERATED_LABEL_FORMAT).toBe('{{json .Config.Labels}}');
  });

  it('passes null through, leaving the meaning of it to the label reader', async () => {
    const { run } = fakeDocker({ inspect: { stdout: 'null\n' } });

    await expect(createDockerInspector(run).inspectLabels(IMAGE)).resolves.toBeNull();
  });

  it('fails when docker does, rather than reporting an image it could not read as clean', async () => {
    const { run } = fakeDocker({ inspect: { exitCode: 1, stderr: 'Error: No such object: myservice:test' } });

    await expect(createDockerInspector(run).inspectLabels(IMAGE)).rejects.toThrow(/No such object/);
  });

  it('fails when the answer is not JSON at all', async () => {
    const { run } = fakeDocker({ inspect: { stdout: '<template error>' } });

    await expect(createDockerInspector(run).inspectLabels(IMAGE)).rejects.toThrow(DockerError);
  });
});

describe('copyOut', () => {
  it('creates a container, copies the path out and removes the container', async () => {
    const { run, invocations } = fakeDocker({ create: { stdout: `${CONTAINER}\n` } });

    await expect(createDockerInspector(run).copyOut(IMAGE, '/config/contract.json', '/tmp/out')).resolves.toBe(true);
    expect(invocations.map((invocation) => invocation.args)).toEqual([
      ['create', IMAGE],
      ['cp', `${CONTAINER}:/config/contract.json`, '/tmp/out'],
      ['rm', '--force', CONTAINER],
    ]);
  });

  // Absence is an answer to the question being asked, not a failure of the tool, so it is reported
  // rather than thrown — and the container still has to go.
  it('reports a missing path as false, and still removes the container', async () => {
    const { run, invocations } = fakeDocker({ create: { stdout: CONTAINER }, cp: { exitCode: 1 } });

    await expect(createDockerInspector(run).copyOut(IMAGE, '/nope', '/tmp/out')).resolves.toBe(false);
    expect(invocations.at(-1)?.args[0]).toBe('rm');
  });

  it('removes the container even when the copy throws', async () => {
    const invocations: string[] = [];
    const run: CommandRunner = (_command, args) => {
      invocations.push(args[0]);

      if (args[0] === 'cp') {
        return Promise.reject(new Error('daemon went away'));
      }

      return Promise.resolve({ exitCode: 0, stdout: CONTAINER, stderr: '' });
    };

    await expect(createDockerInspector(run).copyOut(IMAGE, '/x', '/tmp/out')).rejects.toThrow('daemon went away');
    expect(invocations).toEqual(['create', 'cp', 'rm']);
  });

  // A failure to remove a throwaway container must not mask the verdict it was created to produce.
  it('lets a failed removal pass, having already answered the question', async () => {
    const run: CommandRunner = (_command, args) =>
      args[0] === 'rm'
        ? Promise.reject(new Error('already gone'))
        : Promise.resolve({ exitCode: 0, stdout: CONTAINER, stderr: '' });

    await expect(createDockerInspector(run).copyOut(IMAGE, '/x', '/tmp/out')).resolves.toBe(true);
  });

  it('fails when the container cannot be created at all', async () => {
    const { run } = fakeDocker({ create: { exitCode: 125, stderr: 'Unable to find image' } });

    await expect(createDockerInspector(run).copyOut(IMAGE, '/x', '/tmp/out')).rejects.toThrow(/Unable to find image/);
  });

  // The id becomes an argument to the next two calls. `docker create` printing something that is not
  // an id means the command did something other than what is assumed here, and passing it on would
  // be building an argument out of an unread answer.
  it.each([
    { name: 'nothing at all', stdout: '' },
    { name: 'a warning instead of an id', stdout: 'WARNING: platform mismatch' },
    { name: 'an id that is too short', stdout: 'abc' },
    { name: 'something flag-shaped', stdout: '--rm' },
  ])('refuses to go on when docker create prints $name', async ({ stdout }) => {
    const { run } = fakeDocker({ create: { stdout } });

    await expect(createDockerInspector(run).copyOut(IMAGE, '/x', '/tmp/out')).rejects.toThrow(/container id/);
  });

  it('takes the id from the last line, past whatever docker printed before it', async () => {
    const { run, invocations } = fakeDocker({ create: { stdout: `Unable to find image locally\n${CONTAINER}\n` } });

    await createDockerInspector(run).copyOut(IMAGE, '/x', '/tmp/out');

    expect(invocations[1].args[1]).toBe(`${CONTAINER}:/x`);
  });
});
