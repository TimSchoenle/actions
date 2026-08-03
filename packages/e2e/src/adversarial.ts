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
import { expect } from 'vitest';

import type { ActionRunResult } from './run-action.js';

/**
 * Marker every forged construct carries, so an assertion can name it without matching real output.
 *
 * Deliberately not a word any action, error message or fixture uses.
 */
export const FORGERY_MARKER = 'e2e-forgery-8f3a';

/** The command names the runner acts on when it sees them at the start of a line of stdout. */
const RUNNER_COMMANDS = [
  'error',
  'warning',
  'notice',
  'debug',
  'add-mask',
  'set-output',
  'save-state',
  'group',
  'add-matcher',
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

export function commandInjectionPayload(lead = 'ordinary-looking-value'): string {
  return [lead, ...FORGED_COMMAND_LINES, `${FORGERY_MARKER}-trailer`].join('\n');
}

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
  { name: 'zero-width space', value: unit(0x20_0b), risk: 'hides a difference between two names', asInput: true },
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

  return stdout.split(/\r?\n/).filter((line) => forged.has(line.trim()));
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
  expect(result.stderr, 'nothing may be thrown past the action').not.toContain('UnhandledPromiseRejection');

  if (expectedMessage !== undefined) {
    expect(result.errors.join('\n')).toMatch(expectedMessage);
  }
}
