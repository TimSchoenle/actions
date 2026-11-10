import fs from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { toRepoPath } from 'action-graph';
import { parseRepository, runAction } from 'actions-util';
import * as core from 'actions-util/core';

import { ActionInput, ActionOutput, getInput, setOutput } from './generated/action-io.js';
import { createReleaseStateApi } from './github.js';
import { plan, preflight } from './plan.js';

import type { ReleaseStateApi } from './github.js';
import type { PlanOptions } from './plan.js';
import type { RepositoryCoordinates } from 'actions-util';

/** The process-level facts this action reads, gathered in one place so tests can supply them. */
export interface RunnerContext {
  readonly repository: string;
  readonly temp: string;
}

function readRunnerContext(): RunnerContext {
  return {
    repository: process.env['GITHUB_REPOSITORY'] ?? '',
    temp: process.env['RUNNER_TEMP'] || tmpdir(),
  };
}

/** Injection seam for tests; defaults to the real GitHub API. */
export type ApiFactory = (token: string, repository: RepositoryCoordinates) => ReleaseStateApi;

function readSha(): string {
  const sha = getInput(ActionInput.sha, { required: true });
  if (!/^[0-9a-f]{40}$/.test(sha) && !/^[0-9a-f]{64}$/.test(sha)) {
    throw new Error(`sha must be a full lowercase commit id; got ${JSON.stringify(sha)}.`);
  }

  return sha;
}

function readPattern(): RegExp {
  const source = getInput(ActionInput['consumer-tag-pattern'], { required: true });
  try {
    // The pattern is workflow configuration, written by the repository's maintainers.
    // eslint-disable-next-line security/detect-non-literal-regexp
    return new RegExp(source, 'u');
  } catch (error) {
    throw new Error(`consumer-tag-pattern is not a valid regular expression: ${(error as Error).message}`, {
      cause: error,
    });
  }
}

function readAuthorId(): number | undefined {
  const value = getInput(ActionInput['release-pr-author-id']);
  if (value === '') {
    return undefined;
  }
  if (!/^[1-9]\d{0,15}$/.test(value)) {
    throw new Error(`release-pr-author-id must be empty or a numeric user ID; got ${JSON.stringify(value)}.`);
  }

  return Number(value);
}

/**
 * The longest source tag prefix: the source tag adds the component and version to it, and the tag
 * as a whole has to stay within the 250 characters publish-build-commit accepts.
 */
const MAX_PREFIX_LENGTH = 100;

function readOptions(): PlanOptions {
  const prefix = getInput(ActionInput['source-tag-prefix'], { required: true });
  if (
    prefix.length > MAX_PREFIX_LENGTH ||
    !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(prefix) ||
    prefix.includes('..') ||
    prefix.includes('//')
  ) {
    throw new Error(
      `source-tag-prefix must be at most ${MAX_PREFIX_LENGTH} letters, digits, '.', '_', '-' and '/', without '..' or '//'; got ${JSON.stringify(prefix)}.`,
    );
  }
  const pendingLabel = getInput(ActionInput['pending-label'], { required: true });

  return {
    sha: readSha(),
    configFile: toRepoPath(getInput(ActionInput['config-file'], { required: true }), 'config-file'),
    manifestFile: toRepoPath(getInput(ActionInput['manifest-file'], { required: true }), 'manifest-file'),
    sourceTagPrefix: prefix,
    consumerTagPattern: readPattern(),
    releasePrAuthorId: readAuthorId(),
    pendingLabel,
  };
}

async function runPlan(api: ReleaseStateApi, options: PlanOptions, context: RunnerContext): Promise<void> {
  const result = await plan(api, options);
  const notesDirectory = fs.mkdtempSync(path.join(context.temp, 'release-notes-'));
  setOutput(ActionOutput['notes-dir'], notesDirectory);

  if (!result.isRelease) {
    core.info(result.reason);
    setOutput(ActionOutput['is-release'], 'false');
    setOutput(ActionOutput['pull-request'], '');
    setOutput(ActionOutput.releases, '[]');
    return;
  }

  const releases = result.releases.map((release) => {
    const notesFile = path.join(notesDirectory, `${release.consumerTag}.md`);
    fs.writeFileSync(notesFile, release.notes, { flag: 'wx' });

    return {
      path: release.path,
      component: release.component ?? null,
      version: release.version,
      consumerTag: release.consumerTag,
      sourceTag: release.sourceTag,
      releaseName: release.releaseName,
      notesFile,
    };
  });

  core.info(
    `Pull request #${result.pullRequest} releases ${releases.map((release) => release.consumerTag).join(', ')}.`,
  );
  setOutput(ActionOutput['is-release'], 'true');
  setOutput(ActionOutput['pull-request'], String(result.pullRequest));
  setOutput(ActionOutput.releases, JSON.stringify(releases));
}

/**
 * Reads release-please state at a commit, read-only.
 *
 * `preflight` fails unless every package has the source tag of its manifest version. `plan` decides
 * whether the commit releases anything and writes each release's notes to a file outside the checkout.
 */
export function run(
  context: RunnerContext = readRunnerContext(),
  factory: ApiFactory = createReleaseStateApi,
): Promise<void> {
  return runAction(async () => {
    const mode = getInput(ActionInput.mode, { required: true });
    if (mode !== 'preflight' && mode !== 'plan') {
      throw new Error(`mode must be preflight or plan; got ${JSON.stringify(mode)}.`);
    }
    const options = readOptions();
    const token = getInput(ActionInput.token, { required: true });
    core.setSecret(token);
    const api = factory(token, parseRepository(context.repository));

    if (mode === 'preflight') {
      const tags = await preflight(api, options);
      core.info(`All ${tags.length} source tags exist at ${options.sha}.`);
      return;
    }
    await runPlan(api, options, context);
  });
}
