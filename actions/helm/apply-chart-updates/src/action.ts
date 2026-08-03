import * as core from '@actions/core';
import { runAction } from 'actions-util';

import { sanitizeChangelog } from './changelog.js';
import { readChartVersion, resolveChartFiles } from './chart-files.js';
import { assertSemver, bumpChartVersion, parseBumpKind } from './chart-version.js';
import { getInput, setOutput } from './generated/action-io.js';
import { compilePattern, parseImages, parsePositiveInteger, parseVariables } from './inputs.js';
import { renderChangelogSection, renderSummaryTable } from './summary.js';
import { applyUpdate } from './update.js';

import type { UpdateRequest } from './update.js';

const DEFAULT_CHANGELOG_MAX_BYTES = 30_000;

/** Named once because it is both an input and an output, and the two must not drift apart. */
const CHART_VERSION = 'chart-version';

/** Everything derived from the inputs, resolved before anything is written. */
interface Plan {
  readonly request: UpdateRequest;
  /** Repository-relative paths of the files the update touches, for the commit file pattern. */
  readonly relativePaths: readonly string[];
  readonly changelog: string;
}

/**
 * Chooses the chart version to write.
 *
 * An explicit `chart-version` wins over `version-bump` rather than conflicting with it, and says so
 * in the log: a caller that pins the version and leaves `version-bump` at its default has not made a
 * mistake worth failing a release over, but should be able to see which one took effect.
 */
function resolveChartVersion(explicit: string, bump: string, current: string): string {
  if (explicit !== '') {
    core.info(`Using the explicit chart-version '${explicit}'; version-bump is ignored`);

    return assertSemver(explicit, CHART_VERSION);
  }

  return bumpChartVersion(current, parseBumpKind(bump));
}

/**
 * Reads and validates every input.
 *
 * All of it, including the changelog, before `applyUpdate` writes anything — a malformed
 * `changelog-max-bytes` must not be discovered after the chart has already been rewritten.
 */
async function buildPlan(): Promise<Plan> {
  const { chartFile, valuesFile, relativePaths } = resolveChartFiles(
    getInput('chart-path', { required: true }),
    process.env.GITHUB_WORKSPACE ?? process.cwd(),
  );

  const previousChartVersion = await readChartVersion(chartFile);
  const appVersion = getInput('app-version');
  const changelogMaxBytes = parsePositiveInteger(
    getInput('changelog-max-bytes'),
    'changelog-max-bytes',
    DEFAULT_CHANGELOG_MAX_BYTES,
  );

  return {
    request: {
      chartFile,
      valuesFile,
      images: parseImages(getInput('images', { required: true })),
      sharedVariables: parseVariables(getInput('variables') || '{}'),
      valueTemplate: getInput('value-template'),
      keyPattern: compilePattern(getInput('key-pattern'), 'key-pattern'),
      valuePattern: compilePattern(getInput('value-pattern'), 'value-pattern'),
      previousChartVersion,
      chartVersion: resolveChartVersion(getInput(CHART_VERSION).trim(), getInput('version-bump'), previousChartVersion),
      // An empty input and an absent one are the same thing to the runner, and both mean "this chart
      // has no single app version" — the normal case once its services release independently.
      appVersion: appVersion === '' ? undefined : appVersion,
    },
    relativePaths,
    changelog: sanitizeChangelog(getInput('changelog'), changelogMaxBytes),
  };
}

/**
 * Applies the chart update and publishes what changed.
 *
 * The two Markdown outputs exist so the composite that opens the pull request never assembles a body
 * out of caller-controlled text itself: both fragments leave here already safe to paste.
 */
export function run(): Promise<void> {
  return runAction(async () => {
    const { request, relativePaths, changelog } = await buildPlan();

    core.info(`Updating ${request.images.length} image value(s) in ${request.valuesFile}`);

    const { imageEdits } = await applyUpdate(request);

    for (const edit of imageEdits) {
      core.info(`  ${edit.key}: ${edit.old} -> ${edit.new}`);
    }

    core.info(`Chart version: ${request.previousChartVersion} -> ${request.chartVersion}`);

    setOutput(CHART_VERSION, request.chartVersion);
    setOutput('previous-chart-version', request.previousChartVersion);
    setOutput('updated-count', String(imageEdits.length));
    setOutput('changes', JSON.stringify(imageEdits));
    setOutput('summary-markdown', renderSummaryTable(imageEdits));
    setOutput('changelog-markdown', renderChangelogSection(changelog));
    setOutput('files', relativePaths.join(' '));
  });
}
