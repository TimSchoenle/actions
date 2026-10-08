import { describe, expect, it } from 'vitest';

import {
  commandInjectionPayload,
  expectCleanRejection,
  expectNoCrash,
  expectNoFileCommandForgery,
  expectNoForgedCommands,
  expectNoInjection,
  expectSecretNotLeaked,
  fileCommandInjectionPayload,
  FORGERY_MARKER,
  HOSTILE_CHARACTERS,
  LARGEST_DELIVERABLE_INPUT,
  oversized,
  REDOS_PATTERNS,
  RUNNER_LINE_BREAKS,
  TRAVERSAL_PATHS,
  yamlAliasBomb,
} from './adversarial.js';
import { parseFileCommands } from './github-file-commands.js';
import { parseWorkflowCommands } from './workflow-commands.js';

import type { ActionRunResult } from './run-action.js';

/**
 * A run result assembled from a stdout stream and a `GITHUB_OUTPUT` body.
 *
 * Built through the same parsers `runAction` uses rather than by hand: an assertion tested against a
 * hand-written result proves only that the assertion agrees with the test author.
 */
function resultOf(stdout: string, outputFile = '', envFile = ''): ActionRunResult<string> {
  return {
    ...parseWorkflowCommands(stdout),
    exitCode: 0,
    outputs: parseFileCommands(outputFile),
    exportedEnv: parseFileCommands(envFile),
    state: {},
    addedPath: [],
    stepSummary: '',
    raw: { GITHUB_OUTPUT: outputFile, GITHUB_ENV: envFile, GITHUB_STATE: '' },
    stdout,
    stderr: '',
    workspace: '/tmp/workspace',
  };
}

/** What an action that echoes its input unescaped writes, which is the defect under test. */
function echoedRaw(value: string): string {
  return `Reading value...\n✅ Read value: ${value}\n`;
}

/** What an action that quotes its input writes: one line, whatever the value contains. */
function echoedQuoted(value: string): string {
  return `Reading value...\n✅ Read value: ${JSON.stringify(value)}\n`;
}

describe('commandInjectionPayload', () => {
  it('forges a command on every channel the harness models', () => {
    const commands = parseWorkflowCommands(commandInjectionPayload());

    expect(commands.errors).toEqual([`${FORGERY_MARKER}-error`]);
    expect(commands.warnings).toEqual([`${FORGERY_MARKER}-warning`]);
    expect(commands.notices).toEqual([`${FORGERY_MARKER}-notice`]);
    expect(commands.debug).toEqual([`${FORGERY_MARKER}-debug`]);
    expect(commands.masks).toEqual([`${FORGERY_MARKER}-add-mask`]);
  });

  it('starts with an innocuous line, because a real payload does not announce itself', () => {
    expect(commandInjectionPayload('1.2.3').split('\n')[0]).toBe('1.2.3');
  });

  it.each(RUNNER_LINE_BREAKS)('forges the same commands when its lines end in $name', ({ value }) => {
    const commands = parseWorkflowCommands(commandInjectionPayload('1.2.3', value));

    expect(commands.errors).toEqual([`${FORGERY_MARKER}-error`]);
    expect(commands.masks).toEqual([`${FORGERY_MARKER}-add-mask`]);
  });

  it('includes the commands a caller can re-enable, since those have the most leverage', () => {
    const payload = commandInjectionPayload();

    expect(payload).toContain(`::set-env name=${FORGERY_MARKER}::`);
    expect(payload).toContain(`::add-path name=${FORGERY_MARKER}::`);
  });

  it('carries the marker on every forged line, so an assertion can name them exactly', () => {
    const forged = commandInjectionPayload()
      .split('\n')
      .filter((line) => line.startsWith('::'));

    expect(forged.length).toBeGreaterThan(5);
    expect(forged.every((line) => line.includes(FORGERY_MARKER))).toBe(true);
  });
});

describe('expectNoForgedCommands', () => {
  it('passes when the value was quoted onto a single line', () => {
    expect(() => expectNoForgedCommands(resultOf(echoedQuoted(commandInjectionPayload())))).not.toThrow();
  });

  it('fails when the value reached stdout unescaped', () => {
    expect(() => expectNoForgedCommands(resultOf(echoedRaw(commandInjectionPayload())))).toThrow();
  });

  it('catches a command the harness does not itself model', () => {
    const stdout = `fine\n::stop-commands::${FORGERY_MARKER}-token\n`;

    // Nothing lands in `errors`, `warnings` or `masks` — only the raw-stream half sees this one.
    expect(parseWorkflowCommands(stdout).errors).toEqual([]);
    expect(() => expectNoForgedCommands(resultOf(stdout))).toThrow();
  });

  // The defect this catches: an escaper that handles `\n` and forgets `\r`. The runner still splits.
  it('fails when the value reached stdout with only lone carriage returns between its lines', () => {
    expect(() => expectNoForgedCommands(resultOf(echoedRaw(commandInjectionPayload('1', '\r'))))).toThrow();
  });

  it('passes when a carriage-return payload was quoted onto a single line', () => {
    expect(() => expectNoForgedCommands(resultOf(echoedQuoted(commandInjectionPayload('1', '\r'))))).not.toThrow();
  });

  it('tolerates a command the action legitimately issued', () => {
    expect(() => expectNoForgedCommands(resultOf('::error::Key not found in chart.yaml\n'))).not.toThrow();
  });
});

describe('expectNoFileCommandForgery', () => {
  const payload = fileCommandInjectionPayload();

  it('passes when the payload was written as one heredoc value', () => {
    const written = `value<<ghadelimiter\n${payload}\nghadelimiter\n`;

    expect(parseFileCommands(written)['value']).toBe(payload);
    expect(() => expectNoFileCommandForgery(resultOf('', written))).not.toThrow();
  });

  it('fails when the payload closed the heredoc and appended a key', () => {
    const written = `value<<EOF\n${payload}\nEOF\n`;

    expect(() => expectNoFileCommandForgery(resultOf('', written))).toThrow();
  });

  it('fails when a token was forged into GITHUB_ENV', () => {
    expect(() => expectNoFileCommandForgery(resultOf('', '', 'GITHUB_TOKEN=stolen\n'))).toThrow();
  });

  it('fails when a directory was forged into GITHUB_PATH', () => {
    const result = { ...resultOf(''), addedPath: [`/tmp/${FORGERY_MARKER}/bin`] };

    expect(() => expectNoFileCommandForgery(result)).toThrow();
  });

  it('accepts a hostile value published as data under a declared key', () => {
    const written = `value<<ghadelimiter\n${commandInjectionPayload()}\nghadelimiter\n`;

    expect(() => expectNoFileCommandForgery(resultOf('', written))).not.toThrow();
  });
});

describe('expectNoInjection', () => {
  it('rejects a run that is clean in one channel and forged in the other', () => {
    const written = `value<<EOF\n${fileCommandInjectionPayload()}\nEOF\n`;

    expect(() => expectNoInjection(resultOf('all fine\n', written))).toThrow();
  });
});

describe('expectCleanRejection', () => {
  it('accepts a failure that annotated its reason', () => {
    const result = { ...resultOf("::error::Key 'a.b' not found\n"), exitCode: 1 };

    expect(() => expectCleanRejection(result, /not found/)).not.toThrow();
  });

  it('rejects a failure that annotated nothing', () => {
    expect(() => expectCleanRejection({ ...resultOf(''), exitCode: 1 })).toThrow();
  });

  it('rejects a run that did not fail at all', () => {
    expect(() => expectCleanRejection(resultOf('::error::something\n'))).toThrow();
  });

  it('rejects a failure whose reason does not match', () => {
    const result = { ...resultOf('::error::Unknown error occurred\n'), exitCode: 1 };

    expect(() => expectCleanRejection(result, /not found/)).toThrow();
  });
});

describe('expectNoCrash', () => {
  /** What `runAction` in `actions-util` writes for a failure: the chain on debug, the message on error. */
  function failedWith(head: string, message: string, stderr = ''): ActionRunResult<string> {
    const stack = `${head}: ${message}\n    at run (/action/dist/index.js:1:1)`;
    const escaped = stack.replaceAll('%', '%25').replaceAll('\n', '%0A');

    return { ...resultOf(`::debug::${escaped}\n::error::${message}\n`), exitCode: 1, stderr };
  }

  it('accepts a domain error, whatever it wraps', () => {
    const result = failedWith('ExtraParseError', 'extra: not valid JSON.');
    const wrapped = { ...result, debug: [`${result.debug[0]}\nCaused by: SyntaxError: Unexpected token`] };

    expect(() => expectNoCrash(wrapped)).not.toThrow();
  });

  it.each([
    ['TypeError', "Cannot read properties of undefined (reading 'tag')"],
    ['RangeError', 'Maximum call stack size exceeded'],
    ['SyntaxError', 'Unexpected end of JSON input'],
  ])('rejects a %s that nothing caught', (head, message) => {
    expect(() => expectNoCrash(failedWith(head, message))).toThrow();
  });

  it('rejects a fault in the annotation even when the head was rewrapped as a plain Error', () => {
    expect(() => expectNoCrash(failedWith('Error', 'payload.release is not iterable'))).toThrow();
  });

  it('rejects a stack printed to stderr, which only an uncaught error leaves there', () => {
    const stderr = 'file:///action/dist/index.js:1\nError: boom\n    at run (/action/dist/index.js:1:1)\n';

    expect(() => expectNoCrash({ ...resultOf(''), exitCode: 1, stderr })).toThrow();
  });

  it('accepts a successful run with nothing on stderr', () => {
    expect(() => expectNoCrash(resultOf('done\n'))).not.toThrow();
  });
});

describe('expectSecretNotLeaked', () => {
  const secret = 'ghs_e2eSecretValue0123456789';
  const base64 = (text: string): string => Buffer.from(text, 'utf8').toString('base64');

  it('accepts a run that registered the secret with add-mask and printed it nowhere else', () => {
    expect(() => expectSecretNotLeaked(resultOf(`::add-mask::${secret}\nworking\n`), secret)).not.toThrow();
  });

  it.each([
    ['the log', resultOf(`token is ${secret}\n`)],
    ['an output', resultOf('', `token<<ghadelimiter\n${secret}\nghadelimiter\n`)],
    ['an exported variable', resultOf('', '', `LEAK=${secret}\n`)],
    ['the step summary', { ...resultOf(''), stepSummary: `| token | ${secret} |` }],
    ['stderr, percent-encoded', { ...resultOf(''), stderr: `GET https://x?t=${encodeURIComponent(secret)}` }],
    ['the log, as a git basic credential', resultOf(`AUTHORIZATION: basic ${base64(`x-access-token:${secret}`)}\n`)],
  ])('rejects the secret in %s', (_, result) => {
    expect(() => expectSecretNotLeaked(result, secret)).toThrow();
  });

  it('scans what the case hands it besides the run', () => {
    const gitConfig = `[http]\n\textraheader = AUTHORIZATION: basic ${base64(`x-access-token:${secret}`)}\n`;

    expect(() => expectSecretNotLeaked(resultOf(''), secret, { '.git/config': gitConfig })).toThrow();
  });

  it('never prints the secret in its own failure message', () => {
    let failure: unknown;

    try {
      expectSecretNotLeaked(resultOf(`token is ${secret}\n`), secret);
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).not.toContain(secret);
  });

  it('refuses a secret short enough to match ordinary text', () => {
    expect(() => expectSecretNotLeaked(resultOf('a'), 'abc')).toThrow();
  });
});

describe('the payload catalogue', () => {
  it('names a distinct risk for every hostile character', () => {
    const values = HOSTILE_CHARACTERS.map((entry) => entry.value);

    expect(new Set(values).size).toBe(values.length);
    expect(HOSTILE_CHARACTERS.every((entry) => entry.risk.length > 0)).toBe(true);
  });

  it('offers traversal paths in both path syntaxes', () => {
    expect(TRAVERSAL_PATHS.some((entry) => entry.value.includes('\\'))).toBe(true);
    expect(TRAVERSAL_PATHS.some((entry) => entry.value.startsWith('/'))).toBe(true);
  });

  // Deliberately never executed here: running one against its subject is the denial of service, and
  // it would hang this suite exactly as it would hang a runner. The subject ends with a character the
  // pattern cannot consume, which is what forces the engine through every backtracking path.
  it('pairs every catastrophic pattern with a subject that cannot match it', () => {
    for (const { pattern, subject } of REDOS_PATTERNS) {
      expect(() => new RegExp(pattern)).not.toThrow();
      expect(subject.endsWith('!'), pattern).toBe(true);
      expect(pattern.includes('!'), pattern).toBe(false);
    }
  });

  it('builds an alias bomb that expands geometrically', () => {
    const bomb = yamlAliasBomb(3, 4);

    expect(bomb.split('\n').filter((line) => line !== '')).toHaveLength(4);
    expect(bomb).toContain('l3: &l3 [*l2,*l2,*l2,*l2]');
  });

  it('sizes an oversized value exactly', () => {
    expect(oversized(1024)).toHaveLength(1024);
  });

  // The ceiling is the kernel's, not the harness's: `MAX_ARG_STRLEN` bounds one environment entry,
  // name and `=` included, and an action input is one. A payload over it fails as `spawn E2BIG` on a
  // runner while passing on Windows, which has no equivalent limit — so the headroom is the point.
  it('leaves the largest deliverable input room for a variable name inside one environment entry', () => {
    const entry = `INPUT_SOME-REASONABLY-LONG-ACTION-INPUT-NAME=${oversized(LARGEST_DELIVERABLE_INPUT)}`;

    expect(Buffer.byteLength(entry, 'utf8')).toBeLessThan(131_072);
  });
});
