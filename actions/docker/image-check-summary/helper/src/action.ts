import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import * as core from '@actions/core';
import { quoteForLog, runAction } from 'actions-util';

import { collectFragments, parseFragmentText } from './fragment.js';
import { ActionInput, ActionOutput, getInput, setOutput } from './generated/action-io.js';
import { isFork, pullRequestFromEvent } from './pull-request.js';
import { renderTable } from './table.js';

import type { ImageFragment } from './fragment.js';
import type { PullRequestContext } from './pull-request.js';
import type { Dirent } from 'node:fs';

/**
 * The bundle `docker/image-check-summary` runs after download-artifact.
 *
 * Reads every fragment the matrix legs uploaded, renders one table, and decides whether the
 * composite may post it. A matrix leg cannot write a comment another leg owns without racing it,
 * which is why this runs as its own job, once, after all of them.
 */

/** The process-level facts this helper reads, gathered in one place so tests can supply them. */
export interface RunnerContext {
  /** `owner/repo` the workflow runs in. */
  readonly repository: string;
  /** Path of the event payload, or empty outside a runner. */
  readonly eventPath: string;
}

function readRunnerContext(): RunnerContext {
  return {
    repository: process.env['GITHUB_REPOSITORY'] ?? '',
    eventPath: process.env['GITHUB_EVENT_PATH'] ?? '',
  };
}

/** Files that hold a fragment: download-artifact puts each artifact's `fragment.json` in its own directory. */
function isFragmentFile(entry: Dirent): boolean {
  return entry.isFile() && entry.name.endsWith('.json');
}

/** Directory entries in code-unit order, so "last fragment wins" means the same thing everywhere. */
async function sortedEntries(directory: string): Promise<Dirent[]> {
  const entries = await readdir(directory, { withFileTypes: true });

  return entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/** Entries of the download directory, or none when download-artifact never created it. */
async function downloadEntries(directory: string): Promise<Dirent[]> {
  try {
    return await sortedEntries(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }

    throw error;
  }
}

/**
 * Lists every fragment file under the download directory, one level of artifact directories deep.
 *
 * Files directly in the directory are read too: download-artifact extracts a lone matching artifact
 * straight into the path, and a caller may have downloaded with `merge-multiple`. A directory that
 * does not exist holds no fragments, since a pattern that matches nothing creates nothing.
 */
async function listFragmentFiles(directory: string): Promise<string[]> {
  const files: string[] = [];

  for (const entry of await downloadEntries(directory)) {
    const entryPath = path.join(directory, entry.name);

    if (isFragmentFile(entry)) {
      files.push(entryPath);
    } else if (entry.isDirectory()) {
      const children = await sortedEntries(entryPath);

      files.push(...children.filter(isFragmentFile).map((child) => path.join(entryPath, child.name)));
    }
  }

  return files;
}

async function readFragments(directory: string): Promise<ImageFragment[]> {
  const fragments: ImageFragment[] = [];

  for (const file of await listFragmentFiles(directory)) {
    const source = quoteForLog(path.relative(directory, file).replaceAll('\\', '/'));

    fragments.push(parseFragmentText(await readFile(file, 'utf8'), source));
  }

  return fragments;
}

async function readPullRequest(context: RunnerContext): Promise<PullRequestContext | undefined> {
  if (context.eventPath === '') {
    return undefined;
  }

  return pullRequestFromEvent(JSON.parse(await readFile(context.eventPath, 'utf8')));
}

/**
 * Decides whether the composite posts the table, and says why when it does not.
 *
 * No fragments on a pull request means every leg failed before uploading, or none ran in summary
 * mode; posting an empty table would overwrite a useful one from an earlier push.
 */
function shouldComment(pullRequest: PullRequestContext | undefined, repository: string, images: number): boolean {
  if (pullRequest === undefined) {
    return false;
  }

  if (isFork(pullRequest, repository)) {
    core.notice(
      `Pull request #${pullRequest.number} comes from another repository, where GITHUB_TOKEN is read-only. ` +
        'The summary comment is skipped; the step summary carries the table.',
    );

    return false;
  }

  if (images === 0) {
    core.warning(
      'Found no docker/image-check fragments. Run the image checks with comment: summary, and this job after ' +
        'all of them with if: always(), so a failed leg still leaves its row.',
    );

    return false;
  }

  return true;
}

/** Reads the fragments, renders the table and publishes it to the step summary. */
export function run(context: RunnerContext = readRunnerContext()): Promise<void> {
  return runAction(async () => {
    const directory = getInput(ActionInput.directory, { required: true });
    const { fragments, duplicates } = collectFragments(await readFragments(directory));

    for (const platform of duplicates) {
      core.warning(`More than one fragment describes platform ${quoteForLog(platform)}; the last one read is used.`);
    }

    core.info(`Read ${fragments.length} image fragment(s).`);

    const pullRequest = await readPullRequest(context);
    const writeComment = shouldComment(pullRequest, context.repository, fragments.length);

    if (fragments.length > 0) {
      const body = renderTable(fragments);

      await core.summary.addRaw(`${body}\n`).write();
      setOutput(ActionOutput.body, body);
    }

    setOutput(ActionOutput.images, String(fragments.length));
    setOutput(ActionOutput.write_comment, String(writeComment));
  });
}
