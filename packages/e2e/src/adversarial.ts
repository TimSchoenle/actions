/**
 * Hostile inputs, and the assertions that say an action survived them.
 *
 * Every action here is reachable from a workflow that a fork can trigger, and most of them read
 * content the repository does not control: a `values.yaml` from a pull request, a check-run name from
 * the API, a branch ref from a `pull_request` payload. That content ends up in three places where it
 * stops being data — the stdout stream the runner parses for commands, the command files a later step
 * reads back as outputs and environment, and the file system the workspace is checked out into.
 *
 * The payloads below are shared rather than written per case so that adding one new trick tests every
 * action at once, and so that the assertions can be exact: each payload carries {@link FORGERY_MARKER}
 * and nothing an action legitimately emits does.
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { expect } from 'vitest';

import { RUNNER_LINE_BREAK } from './workflow-commands.js';

import type { ActionRunResult } from './run-action.js';
import type { Workspace, WorkspaceFiles } from './workspace.js';

/**
 * Marker every forged construct carries, so an assertion can name it without matching real output.
 *
 * Deliberately not a word any action, error message or fixture uses.
 */
export const FORGERY_MARKER = 'e2e-forgery-8f3a';

/**
 * The command names the runner acts on when it sees them at the start of a line of stdout.
 *
 * `set-env` and `add-path` are refused by default, but a caller that sets
 * `ACTIONS_ALLOW_UNSECURE_COMMANDS` turns them back on for every step of the job — and they are the
 * two with the most direct leverage, so their absence from the payload would be the gap that matters.
 */
const RUNNER_COMMANDS = [
  'error',
  'warning',
  'notice',
  'debug',
  'add-mask',
  'set-output',
  'save-state',
  'set-env',
  'add-path',
  'group',
  'endgroup',
  'echo',
  'add-matcher',
  'remove-matcher',
] as const;

/**
 * A value that forges one workflow command of every kind, if the action echoes it unescaped.
 *
 * The first line is ordinary text, because that is the realistic shape: an attacker does not need the
 * *whole* value to be hostile, only one line of it. `stop-commands` comes last so that it cannot
 * suppress the forgeries under test in the same stream — it is asserted on in its own right, as the
 * nastiest of the set: it silences every command the action itself issues afterwards, so a caller
 * waiting on `add-mask` gets an unmasked secret and one waiting on an annotation gets silence.
 */
const FORGED_COMMAND_LINES: readonly string[] = [
  ...RUNNER_COMMANDS.map((command) => `::${command} name=${FORGERY_MARKER}::${FORGERY_MARKER}-${command}`),
  `::stop-commands::${FORGERY_MARKER}-token`,
];

export function commandInjectionPayload(lead = 'ordinary-looking-value', lineBreak: RunnerLineBreak = '\n'): string {
  return [lead, ...FORGED_COMMAND_LINES, `${FORGERY_MARKER}-trailer`].join(lineBreak);
}

/** A sequence the runner reads as the end of a line of stdout. */
export type RunnerLineBreak = '\n' | '\r' | '\r\n';

/**
 * Every way the runner ends a line, for running {@link commandInjectionPayload} through each.
 *
 * The lone carriage return is the one worth having: the runner's `ReadLine` splits on it, while an
 * escaping routine written with only `\n` in mind lets it straight through. An action that escapes
 * the line feed and forgets the carriage return passes the default payload and fails this one.
 */
export const RUNNER_LINE_BREAKS: ReadonlyArray<{ name: string; value: RunnerLineBreak }> = [
  { name: 'line feeds', value: '\n' },
  { name: 'lone carriage returns', value: '\r' },
  { name: 'CRLF pairs', value: '\r\n' },
];

/**
 * A value shaped like the file format `GITHUB_OUTPUT` uses, to forge a second output.
 *
 * `@actions/core` writes `key<<delimiter`, the value, then the delimiter on its own line. A value
 * containing a plausible delimiter line followed by `key=value` appends an output its caller never
 * declared — which for `GITHUB_ENV` is an environment variable in every later step of the job.
 * `core` defends against exactly this by refusing a value containing its own random delimiter, and
 * that refusal is what {@link expectNoFileCommandForgery} checks still holds.
 */
export function fileCommandInjectionPayload(): string {
  return [
    'ordinary-looking-value',
    'EOF',
    `${FORGERY_MARKER}_INJECTED=true`,
    'GITHUB_TOKEN=stolen',
    `${FORGERY_MARKER}<<EOF`,
    'forged',
    'EOF',
  ].join('\n');
}

/** Written by code point, so this file itself holds no control characters. */
function unit(codePoint: number): string {
  return String.fromCodePoint(codePoint);
}

/**
 * Characters that mean something to a terminal, a parser or a file system rather than to a reader.
 *
 * Each is paired with what it is dangerous *for*, because the interesting assertion differs: a NUL
 * truncates a path in a C API, a CR rewrites the current log line, a bidi override reverses how a
 * reviewer reads the code around it.
 *
 * `asInput` records whether the runner can even deliver the character to an action. Inputs arrive as
 * environment variables, and a NUL cannot appear in one on any supported platform — so a case that
 * fed it through an input would be testing the harness, not the action. It stays in the list because
 * it is perfectly reachable through *file content*, which is where it matters.
 */
export const HOSTILE_CHARACTERS = [
  { name: 'NUL', value: unit(0x00), risk: 'truncates a path at the OS boundary', asInput: false },
  { name: 'carriage return', value: unit(0x0d), risk: 'rewrites the current log line', asInput: true },
  { name: 'line feed', value: unit(0x0a), risk: 'starts a line the runner parses for commands', asInput: true },
  {
    name: 'ANSI escape',
    value: `${unit(0x1b)}[2K${unit(0x1b)}[1A`,
    risk: 'erases log lines already written',
    asInput: true,
  },
  { name: 'DEL', value: unit(0x7f), risk: 'renders as nothing at all', asInput: true },
  {
    name: 'right-to-left override',
    value: unit(0x20_2e),
    risk: 'reverses how the rest of the line reads',
    asInput: true,
  },
  {
    name: 'left-to-right isolate',
    value: unit(0x20_66),
    risk: 'reorders a line the way Trojan Source does, unbalanced by any pop',
    asInput: true,
  },
  { name: 'zero-width space', value: unit(0x20_0b), risk: 'hides a difference between two names', asInput: true },
  {
    name: 'next line',
    value: unit(0x85),
    risk: 'breaks a line for Unicode-aware readers, and JSON leaves it unescaped',
    asInput: true,
  },
  {
    name: 'line separator',
    value: unit(0x20_28),
    risk: 'breaks a line for some consumers and not others',
    asInput: true,
  },
] as const;

/** The subset of {@link HOSTILE_CHARACTERS} a workflow can actually put into an action input. */
export const INPUT_HOSTILE_CHARACTERS = HOSTILE_CHARACTERS.filter((entry) => entry.asInput);

/**
 * Paths that try to leave the directory they are resolved against.
 *
 * The Windows-shaped entries are not padding: `path.resolve` on Windows treats `C:\\` and a UNC
 * prefix as absolute and discards everything to their left, so a check written as "does the joined
 * path still start with the root" passes while the result points somewhere else entirely.
 */
export const TRAVERSAL_PATHS = [
  { name: 'a parent walk', value: '../../../../../../../../etc/passwd' },
  { name: 'a parent walk through a real directory', value: 'charts/../../../secret.yaml' },
  { name: 'a POSIX absolute path', value: '/etc/passwd' },
  { name: 'a Windows absolute path', value: 'C:/Windows/win.ini' },
  { name: 'a UNC path', value: '//127.0.0.1/share/file.yaml' },
  { name: 'a backslash parent walk', value: '..\\..\\..\\..\\secret.yaml' },
] as const;

/**
 * Paths that *look* like an escape but are ordinary relative names to a file system.
 *
 * Kept separate and asserted on separately, because the correct outcome is the opposite one. Node
 * performs no percent-decoding and no tilde expansion, so `%2e%2e%2f` is a directory whose name
 * happens to contain percent signs and `~` is a directory called `~`. A containment check that
 * rejected these would be reading them the way a shell or a web server does, and would then have to
 * explain why a repository may not contain a file called `~`.
 */
export const DECEPTIVE_PATHS = [
  { name: 'a URL-encoded parent walk', value: '%2e%2e%2f%2e%2e%2fsecret.yaml' },
  { name: 'a home-relative path', value: '~/.ssh/id_ed25519' },
  { name: 'a name that starts with a dash', value: '--output=/tmp/owned' },
  { name: 'a doubled separator', value: 'docs//README.md' },
] as const;

/**
 * Content planted outside the workspace, which no action may ever read back into anything it produces.
 *
 * Long enough for {@link expectSecretNotLeaked}, and carrying the marker so it matches nothing real.
 */
export const OUTSIDE_SECRET = `${FORGERY_MARKER}-outside-the-workspace`;

/** A file or directory outside the workspace that a symlink inside it points at. */
export interface OutsideTarget {
  /** Absolute path the link resolves to. */
  readonly path: string;
  /** Reads a file back from the outside directory, to prove nothing was written through the link. */
  read(relativePath: string): Promise<string>;
  /** Removes the outside directory. Disposing the workspace removes the link, never what it points at. */
  dispose(): Promise<void>;
}

/**
 * Commits the one file-system trick containment by path cannot see: a symlink that leaves.
 *
 * `resolveWithinWorkspace` rejects `../secret` and `/etc/passwd` by reading the path as written. A
 * pull request can instead commit `README.hbs` as a link to `/proc/self/environ`, and that path is
 * spotless — `README.hbs`, inside the checkout, no `..` anywhere. Git records the link, checkout
 * materialises it, and an action that opens the path reads whatever the link points at: the
 * environment of the step, holding its token, rendered into a file that is then committed.
 *
 * `contents` as a string plants one file and links to it; as a map it plants a directory, for the
 * inputs that name one (`docs-dir`, `partials-dir`, a chart directory). Callers gate on
 * {@link Workspace.symlinksSupported}, as for any link.
 */
export async function linkOutside(
  workspace: Workspace,
  linkPath: string,
  contents: string | WorkspaceFiles,
): Promise<OutsideTarget> {
  const root = await mkdtemp(path.join(tmpdir(), 'actions-e2e-outside-'));
  const target = typeof contents === 'string' ? path.join(root, 'target') : root;

  if (typeof contents === 'string') {
    await writeFile(target, contents, 'utf8');
  } else {
    for (const [relativePath, text] of Object.entries(contents)) {
      await mkdir(path.dirname(path.join(root, relativePath)), { recursive: true });
      await writeFile(path.join(root, relativePath), text, 'utf8');
    }
  }

  await workspace.symlink(linkPath, target);

  return {
    path: target,
    read: (relativePath) => readFile(path.join(root, relativePath), 'utf8'),
    dispose: () => rm(root, { recursive: true, force: true }),
  };
}

/**
 * Patterns whose backtracking is superlinear, for any input compiled as a regular expression.
 *
 * A workflow input reaching `new RegExp` is a denial-of-service seam on a billed runner: the step
 * does not fail, it simply never ends. Each pattern is paired with the subject that makes it blow up.
 *
 * CodeQL reports two of these as `js/redos`, correctly: they are catastrophic by construction, which
 * is the point of the fixture rather than a defect being waved through. The only code that compiles
 * one is the assertion that it is a valid regular expression, and nothing ever runs one against its
 * subject — see the note in `adversarial.test.ts`. This file is excluded in `codeql-config.yml` on
 * that basis.
 */
export const REDOS_PATTERNS = [
  { name: 'nested quantifiers', pattern: '^(a+)+$', subject: `${'a'.repeat(40)}!` },
  { name: 'alternation with overlap', pattern: '^(a|a)*$', subject: `${'a'.repeat(40)}!` },
  { name: 'an unbounded prefix', pattern: '^(.*a){30}$', subject: `${'a'.repeat(60)}!` },
] as const;

/** A YAML document whose aliases expand to more nodes than memory holds, if the parser lets them. */
export function yamlAliasBomb(depth = 8, width = 9): string {
  const lines = [`l0: &l0 [${Array.from({ length: width }, () => '"x"').join(',')}]`];

  for (let level = 1; level <= depth; level++) {
    const previous = Array.from({ length: width }, () => `*l${level - 1}`).join(',');

    lines.push(`l${level}: &l${level} [${previous}]`);
  }

  return `${lines.join('\n')}\n`;
}

/** A string of `bytes` printable characters, for asserting an action bounds what it accepts. */
export function oversized(bytes: number): string {
  return 'A'.repeat(bytes);
}

/**
 * The largest payload a workflow could actually hand an action through an input.
 *
 * An input reaches the action as an `INPUT_*` environment variable, and Linux caps a single entry of
 * the environment at `MAX_ARG_STRLEN` — 32 pages, 131072 bytes — including the name and the `=`.
 * A larger value never reaches the action at all: `spawn` fails with `E2BIG`, which tests the kernel
 * rather than the action, and only on Linux, since Windows has no equivalent limit. This leaves
 * headroom for the variable's name. `run-action.ts` enforces the ceiling with a legible error.
 *
 * A payload that must be larger still belongs in a file, the way `render-template` writes its
 * two-megabyte template — a file has no such limit and is how a real workflow would carry one.
 */
export const LARGEST_DELIVERABLE_INPUT = 100_000;

/**
 * Exactly the messages a payload's forged commands carry.
 *
 * Matched by equality, never by substring, and the distinction is the whole assertion. An action that
 * *quotes* the payload into a legitimate annotation — `core.setFailed('File not found: <payload>')` —
 * produces one properly escaped `::error::` line whose message contains the marker, and that is
 * correct behaviour, not a forgery. Only a message that *is* one of these came from a `::` line the
 * action never wrote.
 */
function forgedMessages(): Set<string> {
  return new Set(RUNNER_COMMANDS.map((command) => `${FORGERY_MARKER}-${command}`));
}

/**
 * The payload's own command lines, wherever they appear as whole lines of `stdout`.
 *
 * The runner trims a line before looking for the `::` prefix, so leading whitespace is no defence and
 * is trimmed here too. A payload that reaches the log *escaped* — `%0A` in place of its newlines —
 * never produces one of these, because it never produces a second line at all.
 */
function forgedCommandLines(stdout: string): string[] {
  const forged = new Set(FORGED_COMMAND_LINES);

  return stdout.split(RUNNER_LINE_BREAK).filter((line) => forged.has(line.trim()));
}

/**
 * Asserts the run published no workflow command that came out of a payload.
 *
 * Both halves matter. The parsed channels prove the runner would have *acted* on a forgery, and the
 * raw stream catches the commands this harness does not model — `save-state`, `add-matcher`,
 * `stop-commands` — which are the ones with the most leverage.
 */
export function expectNoForgedCommands(result: ActionRunResult<string>): void {
  const forged = forgedMessages();
  const channels = {
    errors: result.errors,
    warnings: result.warnings,
    notices: result.notices,
    debug: result.debug,
    masks: result.masks,
  };

  for (const [channel, messages] of Object.entries(channels)) {
    expect(
      messages.filter((message) => forged.has(message)),
      `forged ${channel}`,
    ).toEqual([]);
  }

  expect(forgedCommandLines(result.stdout), 'lines of stdout the runner would read as commands').toEqual([]);
}

/**
 * Asserts the run wrote no key a payload put there, in any of the three command files.
 *
 * Keys, not values: an action publishing hostile content *as an output* is doing its job — the defect
 * is a second key appearing beside it. That distinction is exactly what parsing gives and a scan of
 * the raw bytes cannot: {@link fileCommandInjectionPayload} contains the forged line either way, and
 * only the parse says whether it ended up as a key or as part of a value.
 */
export function expectNoFileCommandForgery(result: ActionRunResult<string>): void {
  const files = {
    GITHUB_OUTPUT: result.outputs as Record<string, string>,
    GITHUB_ENV: result.exportedEnv,
    GITHUB_STATE: result.state,
  };

  for (const [name, values] of Object.entries(files)) {
    expect(
      Object.keys(values).filter((key) => key.includes(FORGERY_MARKER)),
      `keys forged into ${name}`,
    ).toEqual([]);
    // The prize a `GITHUB_ENV` forgery is after, and worth naming rather than leaving to the marker.
    expect(values, `${name} must not gain a token`).not.toHaveProperty('GITHUB_TOKEN');
  }

  expect(
    result.addedPath.filter((entry) => entry.includes(FORGERY_MARKER)),
    'directories forged into GITHUB_PATH',
  ).toEqual([]);
}

/**
 * Asserts a hostile value reached neither the command stream nor the command files.
 *
 * The assertion nearly every adversarial case wants, so it is one call rather than two remembered
 * ones. An action is still free to publish the value as an output — that is data, and data is fine.
 */
export function expectNoInjection(result: ActionRunResult<string>): void {
  expectNoForgedCommands(result);
  expectNoFileCommandForgery(result);
}

/**
 * Asserts the action failed for a stated reason rather than by crashing.
 *
 * A rejected hostile input is only a good outcome if the step *explains itself*: an uncaught
 * `TypeError`, a stack trace on stderr or a non-zero exit with an empty annotation all leave a
 * maintainer unable to tell a defence from a bug.
 */
export function expectCleanRejection(result: ActionRunResult<string>, expectedMessage?: RegExp): void {
  expect(result.exitCode, 'the step must fail').not.toBe(0);
  expect(result.errors.join('\n'), 'a rejection must be annotated').not.toBe('');
  expectNoCrash(result);

  if (expectedMessage !== undefined) {
    expect(result.errors.join('\n')).toMatch(expectedMessage);
  }
}

/**
 * The built-in error types, which a deliberate rejection never surfaces as the top of its chain.
 *
 * Each action wraps what it means to report in a domain error — `UnsafePathError`,
 * `ExtraParseError` — and attaches the underlying failure as its `cause`. A built-in reaching the top
 * therefore means nothing caught it: a `TypeError` from reading a property of `undefined`, a
 * `RangeError` from a blown stack, a `SyntaxError` from a parse nobody guarded. As a cause further
 * down the chain the same `SyntaxError` is fine, which is why only the head is inspected.
 */
const BUILT_IN_ERROR_HEAD = /^(?:Aggregate|Eval|Range|Reference|Syntax|Type|URI)Error: /;

/**
 * The one built-in that is a deliberate refusal: `@actions/core`'s `getBooleanInput` rejects
 * anything outside `true`/`True`/`TRUE`/`false`/`False`/`FALSE` by throwing a bare `TypeError`
 * whose message names the input and lists the accepted spellings. The annotation already says
 * everything a caller needs, so it is a rejection, not a crash, whatever its class.
 */
const ACTIONS_CORE_BOOLEAN_REJECTION = 'TypeError: Input does not meet YAML 1.2 "Core Schema" specification: ';

/** Whether a failure chain is headed by a built-in error that nothing deliberately raised. */
function isUncaughtBuiltIn(chain: string): boolean {
  return BUILT_IN_ERROR_HEAD.test(chain) && !chain.startsWith(ACTIONS_CORE_BOOLEAN_REJECTION);
}

/** The messages V8 gives the faults an action's own code can hit, as opposed to its input. */
const RUNTIME_FAULTS = [
  'Cannot read properties of',
  'Cannot set properties of',
  'is not a function',
  'is not iterable',
  'is not defined',
  'Maximum call stack size exceeded',
  'Invalid string length',
  'Invalid array length',
] as const;

/** The first frame of a stack trace as node prints it, which only an uncaught error leaves on stderr. */
const STACK_FRAME = /^ {4}at /m;

/**
 * Asserts the action did not crash, whether or not it failed.
 *
 * The weaker cases — "handles a value far longer than any real one" — accept either outcome, and
 * without this the only thing they would rule out is an unhandled rejection. Three signals, each
 * from a different place a crash shows up:
 *
 * - **stderr**, where node prints an uncaught error and its stack. Every action reports through
 *   `@actions/core`, which writes to stdout, so a stack frame on stderr was thrown past it.
 * - **The head of the failure chain**, which `runAction` in `actions-util` writes to the debug
 *   channel as the full stack. Its first line names the error type; see {@link BUILT_IN_ERROR_HEAD}.
 * - **The annotation**, which for the same crash reads `Cannot read properties of undefined` — said
 *   separately, because it is the line a caller actually sees.
 */
export function expectNoCrash(result: ActionRunResult<string>): void {
  expect(result.stderr, 'nothing may be thrown past the action').not.toContain('UnhandledPromiseRejection');
  expect(result.stderr, 'an uncaught error leaves its stack on stderr').not.toMatch(STACK_FRAME);
  expect(
    result.debug.filter((message) => isUncaughtBuiltIn(message)),
    'a failure must be a domain error, not a built-in that nothing caught',
  ).toEqual([]);
  expect(
    result.errors.filter((message) => RUNTIME_FAULTS.some((fault) => message.includes(fault))),
    'an annotation must explain the failure, not report a fault in the action',
  ).toEqual([]);
}

/**
 * The forms a secret takes on its way out, beyond its own spelling.
 *
 * `git` is the usual route: `actions/checkout` and anything modelled on it authenticate with an
 * `http.extraheader` of `AUTHORIZATION: basic <base64 of x-access-token:TOKEN>`, so a token that
 * never appears verbatim can still be in the log, or in `.git/config`, one encoding away. A URL
 * carries it percent-encoded. A base64 encoding of a *longer* string that merely contains the token
 * at another alignment is not caught; these are the shapes the tooling actually produces.
 */
function leakedForms(secret: string): Array<{ form: string; value: string }> {
  const base64 = (text: string): string => Buffer.from(text, 'utf8').toString('base64');

  return [
    { form: 'verbatim', value: secret },
    { form: 'percent-encoded', value: encodeURIComponent(secret) },
    { form: 'base64', value: base64(secret) },
    { form: 'base64 git credential', value: base64(`x-access-token:${secret}`) },
  ];
}

/** An `add-mask` of the secret itself, which the runner consumes rather than prints. */
function isMaskOf(line: string, secret: string): boolean {
  return line.trimStart() === `::add-mask::${secret}`;
}

/**
 * Asserts a secret reached none of the places a later reader could find it.
 *
 * Every channel the run produced, not only the log: an output or an exported variable is read by
 * every later step and printed by any of them, and the step summary is rendered on the run page for
 * anyone with read access. `alsoScan` takes what only the case knows to look at — the workspace's
 * `.git/config` after an action that pushes, a file it rendered.
 *
 * The one occurrence allowed is the action registering the secret with `add-mask`: that line is the
 * defence, and the runner consumes it rather than printing it.
 */
export function expectSecretNotLeaked(
  result: ActionRunResult<string>,
  secret: string,
  alsoScan: Readonly<Record<string, string>> = {},
): void {
  expect(secret.length, 'a secret this short would match ordinary text').toBeGreaterThanOrEqual(8);

  const stdout = result.stdout
    .split(RUNNER_LINE_BREAK)
    .filter((line) => !isMaskOf(line, secret))
    .join('\n');
  const channels: Record<string, string> = {
    stdout,
    stderr: result.stderr,
    'step summary': result.stepSummary,
    GITHUB_OUTPUT: result.raw.GITHUB_OUTPUT,
    GITHUB_ENV: result.raw.GITHUB_ENV,
    GITHUB_STATE: result.raw.GITHUB_STATE,
    GITHUB_PATH: result.addedPath.join('\n'),
    ...alsoScan,
  };

  for (const [channel, text] of Object.entries(channels)) {
    for (const { form, value } of leakedForms(secret)) {
      // A boolean rather than `not.toContain`, whose failure message would print the secret itself.
      expect(text.includes(value), `the secret reached ${channel} ${form}`).toBe(false);
    }
  }
}
