import { fileURLToPath } from 'node:url';

import {
  commandInjectionPayload,
  expectCleanRejection,
  expectNoFileCommandForgery,
  expectNoInjection,
  expectSecretNotLeaked,
  fileCommandInjectionPayload,
  FORGERY_MARKER,
  INPUT_HOSTILE_CHARACTERS,
  LARGEST_DELIVERABLE_INPUT,
  linkOutside,
  OUTSIDE_SECRET,
  oversized,
  runAction,
  ScratchRepo,
  TRAVERSAL_PATHS,
  Workspace,
} from 'actions-e2e';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { markerFor, MAX_COMMENT_LENGTH } from '../src/marker.js';

import type { ActionInput, ActionOutput } from '../src/generated/action-io.js';
import type { ActionRunResult, ExpectedOutcome, ProvidedInputs, WorkspaceFiles } from 'actions-e2e';

/**
 * Hostile inputs for `actions/common/upsert-pr-comment`.
 *
 * Two distinct properties, and they pull in opposite directions. The *identifier* is structural: it
 * ends up inside an HTML comment that a later run has to find again, so anything that could close
 * that comment or break the line has to be refused outright. The *body* is data: it is markdown a
 * caller wants posted verbatim, hostile or not, and the only rule is that it must never reach the
 * step log in a form the runner parses as a workflow command.
 */

const ACTION_DIRECTORY = fileURLToPath(new URL('..', import.meta.url));

const SYMLINKS = await Workspace.symlinksSupported();

describe('upsert-pr-comment (adversarial)', () => {
  const scratch = ScratchRepo.fromEnvironment('upsert-pr-comment-adv');

  let prUrl: string;
  let prNumber: number;

  function run(
    inputs: ProvidedInputs<ActionInput>,
    expected: ExpectedOutcome = 'failure',
    files?: Workspace | WorkspaceFiles,
    env?: Readonly<Record<string, string>>,
  ): Promise<ActionRunResult<ActionOutput>> {
    return runAction<ActionInput, ActionOutput>({
      actionDirectory: ACTION_DIRECTORY,
      inputs: { token: scratch.token, pr_url: prUrl, ...inputs },
      secrets: [scratch.token],
      expect: expected,
      ...(files instanceof Workspace ? { workspace: files } : { files }),
      env,
    });
  }

  /** The body of the one comment posted under `identifier`, or `undefined` if there is none. */
  async function postedUnder(identifier: string): Promise<string | undefined> {
    const bodies = await scratch.issueComments(prNumber);
    const matching = bodies.filter((body) => body.startsWith(`${markerFor(identifier)}\n`));

    expect(matching.length, `comments carrying ${identifier}`).toBeLessThanOrEqual(1);

    return matching[0];
  }

  beforeAll(async () => {
    const defaultBranch = await scratch.defaultBranch();
    const branch = scratch.branch('adversarial');

    await scratch.createBranch(branch);
    await scratch.commitFile(branch, `${branch}/file.txt`, 'content\n', 'test: adversarial fixture');

    prNumber = await scratch.createPullRequest(branch, defaultBranch, '[e2e] adversarial');
    prUrl = `https://github.com/${scratch.repository}/pull/${prNumber}`;
  });

  afterAll(() => scratch.teardown());

  describe('identifier', () => {
    it('refuses one that would close the marker and inject markdown after it', async () => {
      const result = await run({ identifier: 'size --><img src=x onerror=alert(1)>', body: 'report' });

      expectCleanRejection(result, /identifier must be/);
      await expect(scratch.issueComments(prNumber)).resolves.toEqual([]);
    });

    // The character sits *inside* the identifier rather than at its end. Inputs arrive as
    // environment variables and `@actions/core` trims them, so a trailing carriage return, line feed
    // or line separator is gone before the action ever sees it: a case shaped that way would assert
    // on `@actions/core`'s trimming instead of on this action refusing the character.
    it.each(INPUT_HOSTILE_CHARACTERS)('refuses one carrying $name, which $risk', async ({ value }) => {
      const result = await run({ identifier: `size${value}report`, body: 'report' });

      expectCleanRejection(result);
      expectNoInjection(result);
    });

    it('refuses one long enough to bury the body', async () => {
      const result = await run({ identifier: 'x'.repeat(1000), body: 'report' });

      expectCleanRejection(result, /identifier must be/);
    });

    it('refuses an empty one rather than posting an unfindable comment', async () => {
      const result = await run({ identifier: '', body: 'report' });

      expectCleanRejection(result);
    });
  });

  describe('body', () => {
    it('posts a body full of workflow commands without letting the runner see them', async () => {
      const payload = commandInjectionPayload('image is 12 MB');

      const result = await run({ identifier: 'injected-body', body: payload }, 'success');

      expectNoInjection(result);

      // The payload is data, and data is posted: refusing it would make the action useless for the
      // reports it exists to publish. What must not happen is the runner reading it as a command.
      const bodies = await scratch.issueComments(prNumber);
      expect(bodies.some((body) => body.includes(payload))).toBe(true);
    });

    it('cuts an oversized body to what GitHub accepts instead of failing the build', async () => {
      const result = await run({ identifier: 'oversized', body: oversized(MAX_COMMENT_LENGTH) }, 'success');

      expect(result.warnings.join('\n')).toContain('cut short');

      const posted = (await scratch.issueComments(prNumber)).find((body) => body.includes(markerFor('oversized')));

      expect(posted).toBeDefined();
      expect(posted?.length).toBeLessThanOrEqual(MAX_COMMENT_LENGTH);
    });
  });

  describe('body_file', () => {
    it.each(TRAVERSAL_PATHS)('refuses $name', async ({ value }) => {
      const result = await run({ identifier: 'traversal', body_file: value });

      expectCleanRejection(result);
      expectNoInjection(result);
    });

    // A pull request can commit `report.md` as a link to `/proc/self/environ`. The path is spotless;
    // posting what it points at would publish the step's environment, token included.
    it.runIf(SYMLINKS)('refuses a body_file that links outside, and posts nothing it holds', async () => {
      const workspace = await Workspace.create();
      const outside = await linkOutside(
        workspace,
        'report.md',
        `${OUTSIDE_SECRET}
`,
      );

      try {
        const result = await run({ body_file: 'report.md', identifier: 'linked' }, 'failure', workspace);

        await expect(postedUnder('linked')).resolves.toBeUndefined();

        expectCleanRejection(result, /body_file resolves outside the workspace through a symbolic link/);
        expectSecretNotLeaked(result, OUTSIDE_SECRET);
      } finally {
        await outside.dispose();
        await workspace.dispose();
      }
    });

    it('refuses both body and body_file rather than choosing one', async () => {
      const result = await run({ identifier: 'both', body: 'inline', body_file: 'report.md' }, 'failure', {
        'report.md': 'from the file',
      });

      expectCleanRejection(result, /only one of/);
    });
  });

  // `body_lines` is where a step output meets the comment, so it is where a value a contributor
  // influenced is most likely to arrive. Three things must hold whatever that value is: it reaches the
  // comment as the same characters, it never reaches the runner as a command, and nothing the job
  // holds, its token or its environment, is ever substituted into it.
  describe('body_lines', () => {
    const canary = `${FORGERY_MARKER}-canary-secret`;
    const canaryEnv = { UPSERT_E2E_CANARY: canary };

    /** Asserts neither the token nor the canary reached the comment or either log stream. */
    function expectNothingLeaked(result: ActionRunResult<ActionOutput>, posted: string | undefined): void {
      for (const secret of [scratch.token, canary]) {
        expect(posted ?? '', 'the posted comment').not.toContain(secret);
        expect(result.stdout, 'stdout').not.toContain(secret);
        expect(result.stderr, 'stderr').not.toContain(secret);
      }
    }

    it('posts references to secrets, variables and commands verbatim, expanding none', async () => {
      const references = [
        '- ${{ secrets.GITHUB_TOKEN }} ${{ env.UPSERT_E2E_CANARY }} ${{ inputs.token }}',
        '- $UPSERT_E2E_CANARY ${UPSERT_E2E_CANARY} %UPSERT_E2E_CANARY% $INPUT_TOKEN %INPUT_TOKEN%',
        '- $(printenv UPSERT_E2E_CANARY) `printenv INPUT_TOKEN` ${process.env.INPUT_TOKEN}',
        '- {{ UPSERT_E2E_CANARY }} {{{ INPUT_TOKEN }}} <%= ENV["INPUT_TOKEN"] %>',
      ].join('\n');

      const result = await run(
        {
          identifier: 'lines-references',
          body_lines: references,
          header: '$INPUT_TOKEN',
          footer: '%INPUT_TOKEN%',
        },
        'success',
        undefined,
        canaryEnv,
      );

      const posted = await postedUnder('lines-references');

      expect(posted).toBe(`${markerFor('lines-references')}\n\n$INPUT_TOKEN\n\n${references}\n\n%INPUT_TOKEN%`);
      expectNothingLeaked(result, posted);
      expectNoInjection(result);
    });

    it.each([
      ['body_lines', (payload: string) => ({ body_lines: payload })],
      ['header', (payload: string) => ({ body_lines: '- README.md', header: payload })],
      ['footer', (payload: string) => ({ body_lines: '- README.md', footer: payload })],
    ])('posts workflow commands through %s without letting the runner see them', async (input, inputsFor) => {
      const identifier = `lines-commands-${input.replace('_', '-')}`;
      const payload = commandInjectionPayload('- README.md');

      const result = await run({ identifier, ...inputsFor(payload) }, 'success');

      expectNoInjection(result);
      await expect(postedUnder(identifier)).resolves.toContain(payload);
    });

    // A skip logs one fixed line. Nothing the lines, header or footer carried may reach the log on
    // the way to deciding there was nothing to post.
    it('skips without echoing anything the header, footer or blank lines carried', async () => {
      const result = await run(
        {
          identifier: 'lines-quiet',
          body_lines: '\n  \n\t\n',
          header: commandInjectionPayload(),
          footer: fileCommandInjectionPayload(),
        },
        'success',
        undefined,
        canaryEnv,
      );

      expect(result.outputs).toEqual({ comment_id: '', comment_url: '', operation: 'skipped' });
      expect(result.stdout).not.toContain(FORGERY_MARKER);
      expectNoInjection(result);
      expectNothingLeaked(result, undefined);
      await expect(postedUnder('lines-quiet')).resolves.toBeUndefined();
    });

    it('cannot forge an output, environment variable or path through a line', async () => {
      const result = await run(
        { identifier: 'lines-file-commands', body_lines: fileCommandInjectionPayload() },
        'success',
      );

      expectNoFileCommandForgery(result);
      expect(Object.keys(result.outputs).sort()).toEqual(['comment_id', 'comment_url', 'operation']);
      expect(result.outputs.operation).toBe('created');
    });

    // A line a contributor shaped as another identifier's marker would make the next run for that
    // identifier find this comment and overwrite it. The line is refused before any comment is read.
    it.each([
      ['body_lines', { body_lines: `- README.md\n${markerFor('lines-victim')}` }],
      ['an indented line', { body_lines: `- README.md\n    ${markerFor('lines-victim')}` }],
      ['header', { body_lines: '- README.md', header: markerFor('lines-victim') }],
      ['footer', { body_lines: '- README.md', footer: `Closing.\n${markerFor('lines-victim')}` }],
    ])('refuses a marker line planted through %s', async (_name, inputs) => {
      const result = await run({ identifier: 'lines-planted', ...inputs });

      expectCleanRejection(result, /carries a comment marker/);
      expectNoInjection(result);
      expect(result.errors.join('\n')).not.toContain(markerFor('lines-victim'));
      await expect(postedUnder('lines-planted')).resolves.toBeUndefined();
    });

    it.each(INPUT_HOSTILE_CHARACTERS)(
      'posts a line carrying $name, which $risk, without injection',
      async ({ name, value }) => {
        const identifier = `lines-char-${name.replaceAll(/[^a-z]/g, '-')}`;

        const result = await run({ identifier, body_lines: `- before${value}after\n- second` }, 'success');

        expectNoInjection(result);
        expect(result.outputs.operation).toBe('created');
      },
    );

    it('refuses a header given without body_lines, without echoing it', async () => {
      const result = await run({
        identifier: 'lines-orphan-header',
        body: 'report',
        header: commandInjectionPayload(),
      });

      expectCleanRejection(result, /'header' is only valid with 'body_lines'/);
      expectNoInjection(result);
      expect(result.errors.join('\n')).not.toContain(FORGERY_MARKER);
    });

    it('cuts the largest deliverable list of lines to what GitHub accepts', async () => {
      const lines = Array.from(
        { length: LARGEST_DELIVERABLE_INPUT / 10 },
        (_, index) => `- ${String(index).padStart(7, '0')}`,
      );

      const result = await run({ identifier: 'lines-oversized', body_lines: lines.join('\n') }, 'success');

      expect(result.warnings.join('\n')).toContain('cut short');
      expect((await postedUnder('lines-oversized'))?.length).toBeLessThanOrEqual(MAX_COMMENT_LENGTH);
    });

    it('skips the largest deliverable run of blank lines without a call', async () => {
      const result = await run(
        { identifier: 'lines-blank-flood', body_lines: ' \n'.repeat(LARGEST_DELIVERABLE_INPUT / 2) },
        'success',
      );

      expect(result.outputs.operation).toBe('skipped');
      await expect(postedUnder('lines-blank-flood')).resolves.toBeUndefined();
    });
  });

  describe('pull request url', () => {
    it.each([
      ['a bare word', 'not-a-url'],
      ['an issue rather than a pull request', 'https://github.com/owner/repo/issues/1'],
      ['a number that is not one', 'https://github.com/owner/repo/pull/abc'],
    ])('refuses %s', async (_name, url) => {
      const result = await run({ pr_url: url, identifier: 'size', body: 'report' });

      expectCleanRejection(result, /Invalid pull request URL/);
    });
  });
});
