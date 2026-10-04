import { readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';

import * as core from '@actions/core';
import { quoteForLog, resolveWithinWorkspace, runAction, workspaceRoot } from 'actions-util';

import { createCommandRunner, inspectImageSize } from './docker.js';
import { GateError, InvalidInputError, PlanError } from './errors.js';
import { evaluateGates, formatMib } from './gates.js';
import { ActionInput, ActionOutput, getInput, setOutput } from './generated/action-io.js';
import { resolveOptions } from './options.js';
import { createPlanLocation, readPlan, writePlan } from './plan.js';
import { codeScanningUrl, isFork, pullRequestFromEvent } from './pull-request.js';
import { renderComment, renderStepSummary, toFragment } from './render.js';
import { countSarifText } from './sarif.js';

import type { CommandRunner } from './docker.js';
import type { CheckOptions, RawInputs } from './options.js';
import type { Plan } from './plan.js';
import type { PullRequestContext } from './pull-request.js';
import type { ImageResult } from './render.js';

/**
 * The bundle the `docker/image-check` composite runs between its own steps.
 *
 * The composite owns the steps only the runner can run — Trivy, upload-sarif, upsert-pr-comment,
 * upload-artifact — and calls this helper around them in three phases. The order is the design:
 * publish the evidence first, enforce the gates last, so a red build always carries its reason.
 *
 * 1. `measure` validates every input, reads the image size and decides what may be published.
 * 2. `report` counts the SARIF results and renders the step summary, the comment and the fragment.
 * 3. `enforce` warns and fails on the thresholds.
 */

/** The composite input the ignore file arrives through, named in every message about it. */
const IGNORE_FILE_INPUT = 'trivy-ignore-file';

/** The phases, by the value of the `phase` input. */
const PHASES = ['measure', 'report', 'enforce'] as const;

type Phase = (typeof PHASES)[number];

/** The process-level facts the phases read, gathered in one place so tests can supply them. */
export interface RunnerContext {
  readonly runnerTemp: string;
  readonly workspace: string;
  /** `owner/repo` the workflow runs in. */
  readonly repository: string;
  readonly serverUrl: string;
  /** Path of the event payload, or empty outside a runner. */
  readonly eventPath: string;
}

/** The ports this helper reaches through, injected so `run` stays testable without Docker. */
export interface ActionDependencies {
  readonly runCommand: CommandRunner;
  readonly context: RunnerContext;
}

function readRunnerContext(): RunnerContext {
  const runnerTemp = process.env['RUNNER_TEMP'];

  return {
    runnerTemp: runnerTemp === undefined || runnerTemp === '' ? tmpdir() : runnerTemp,
    workspace: workspaceRoot(),
    repository: process.env['GITHUB_REPOSITORY'] ?? '',
    serverUrl: process.env['GITHUB_SERVER_URL'] ?? 'https://github.com',
    eventPath: process.env['GITHUB_EVENT_PATH'] ?? '',
  };
}

function defaultDependencies(): ActionDependencies {
  return { runCommand: createCommandRunner(), context: readRunnerContext() };
}

function readInputs(): RawInputs {
  return {
    image: getInput(ActionInput.image),
    platform: getInput(ActionInput.platform),
    sizeWarningMib: getInput(ActionInput.size_warning_mib),
    sizeLimitMib: getInput(ActionInput.size_limit_mib),
    trivySeverity: getInput(ActionInput.trivy_severity),
    trivyIgnoreUnfixed: getInput(ActionInput.trivy_ignore_unfixed),
    trivyFailOnFindings: getInput(ActionInput.trivy_fail_on_findings),
    trivyIgnoreFile: getInput(ActionInput.trivy_ignore_file),
    uploadSarif: getInput(ActionInput.upload_sarif),
    sarifCategory: getInput(ActionInput.sarif_category),
    comment: getInput(ActionInput.comment),
    commentIdentifier: getInput(ActionInput.comment_identifier),
  };
}

function parsePhase(value: string): Phase {
  if (!(PHASES as readonly string[]).includes(value)) {
    throw new InvalidInputError('phase', `${quoteForLog(value)} is not a phase. Expected ${PHASES.join(', ')}.`);
  }

  return value as Phase;
}

async function readPullRequest(context: RunnerContext): Promise<PullRequestContext | undefined> {
  if (context.eventPath === '') {
    return undefined;
  }

  return pullRequestFromEvent(JSON.parse(await readFile(context.eventPath, 'utf8')));
}

async function assertIgnoreFileExists(options: CheckOptions, workspace: string): Promise<void> {
  if (options.ignoreFile === '') {
    return;
  }

  const resolved = resolveWithinWorkspace(options.ignoreFile, workspace, IGNORE_FILE_INPUT);
  const isFile = await stat(resolved).then(
    (stats) => stats.isFile(),
    () => false,
  );

  if (!isFile) {
    throw new InvalidInputError(
      IGNORE_FILE_INPUT,
      `${quoteForLog(options.ignoreFile)} is not a file in the workspace.`,
    );
  }
}

/** Decides what this run may publish, which depends on the event as much as on the inputs. */
function publication(
  options: CheckOptions,
  pullRequest: PullRequestContext | undefined,
  context: RunnerContext,
): Pick<Plan, 'codeScanningUrl' | 'uploadFragment' | 'uploadSarif' | 'writeComment'> {
  const fork = pullRequest !== undefined && isFork(pullRequest, context.repository);

  if (fork) {
    core.notice(
      `Pull request #${pullRequest.number} comes from another repository, where GITHUB_TOKEN is read-only. ` +
        'The SARIF upload and the pull request comment are skipped; the step summary carries the result.',
    );
  }

  const onPullRequest = pullRequest !== undefined && !fork;
  const uploadSarif = options.uploadSarif && !fork;

  return {
    uploadSarif,
    writeComment: onPullRequest && options.comment === 'per-image',
    uploadFragment: onPullRequest && options.comment === 'summary',
    codeScanningUrl:
      uploadSarif && onPullRequest ? codeScanningUrl(context.serverUrl, context.repository, pullRequest.number) : '',
  };
}

async function measure(dependencies: ActionDependencies): Promise<void> {
  const { context } = dependencies;
  const options = resolveOptions(readInputs(), (value) =>
    resolveWithinWorkspace(value, context.workspace, IGNORE_FILE_INPUT),
  );

  await assertIgnoreFileExists(options, context.workspace);

  const sizeBytes = await inspectImageSize(dependencies.runCommand, options.image);
  const pullRequest = await readPullRequest(context);
  const publish = publication(options, pullRequest, context);
  const location = await createPlanLocation(context.runnerTemp, options.slug);
  const gates = evaluateGates({ ...options, sizeBytes, findings: 0 });

  const plan: Plan = {
    version: 1,
    image: options.image,
    platform: options.platform,
    sizeBytes,
    warningMib: options.warningMib,
    limitMib: options.limitMib,
    severity: options.severity,
    failOnFindings: options.failOnFindings,
    sarifPath: location.sarifPath,
    fragmentPath: location.fragmentPath,
    ...publish,
    findings: null,
  };

  await writePlan(location.planPath, plan);

  core.info(`Image ${quoteForLog(options.image)} is ${formatMib(sizeBytes)} MiB uncompressed (${sizeBytes} bytes).`);

  setOutput(ActionOutput.image, options.image);
  setOutput(ActionOutput.size_bytes, String(sizeBytes));
  setOutput(ActionOutput.size_mib, formatMib(sizeBytes));
  setOutput(ActionOutput.over_warning, String(gates.overWarning));
  setOutput(ActionOutput.severity, options.severity);
  setOutput(ActionOutput.ignore_unfixed, String(options.ignoreUnfixed));
  setOutput(ActionOutput.ignore_file, options.ignoreFile);
  setOutput(ActionOutput.sarif_path, location.sarifPath);
  setOutput(ActionOutput.sarif_category, options.sarifCategory);
  setOutput(ActionOutput.upload_sarif, String(publish.uploadSarif));
  setOutput(ActionOutput.comment_identifier, options.commentIdentifier);
  setOutput(ActionOutput.write_comment, String(publish.writeComment));
  setOutput(ActionOutput.upload_fragment, String(publish.uploadFragment));
  setOutput(ActionOutput.fragment_name, `image-check-${options.slug}`);
  setOutput(ActionOutput.fragment_path, location.fragmentPath);
  setOutput(ActionOutput.plan, location.planPath);
}

function resultOf(plan: Plan, findings: number): ImageResult {
  return {
    image: plan.image,
    platform: plan.platform,
    sizeBytes: plan.sizeBytes,
    warningMib: plan.warningMib,
    limitMib: plan.limitMib,
    severity: plan.severity,
    findings,
  };
}

async function report(context: RunnerContext): Promise<void> {
  const planPath = getInput(ActionInput.plan);
  const plan = await readPlan(planPath, context.runnerTemp);
  const findings = countSarifText(await readFile(plan.sarifPath, 'utf8'));
  const result = resultOf(plan, findings);

  core.info(`Trivy reported ${findings} result(s) at ${plan.severity}.`);

  await core.summary.addRaw(renderStepSummary(result)).write();

  if (plan.writeComment) {
    setOutput(
      ActionOutput.comment_body,
      renderComment(result, plan.codeScanningUrl === '' ? undefined : plan.codeScanningUrl),
    );
  }

  if (plan.uploadFragment) {
    await writeFile(plan.fragmentPath, `${JSON.stringify(toFragment(result))}\n`, 'utf8');
  }

  await writePlan(planPath, { ...plan, findings });

  setOutput(ActionOutput.findings, String(findings));
}

function describeImage(plan: Plan): string {
  return plan.platform === '' ? quoteForLog(plan.image) : `${quoteForLog(plan.image)} (${plan.platform})`;
}

async function enforce(context: RunnerContext): Promise<void> {
  const plan = await readPlan(getInput(ActionInput.plan), context.runnerTemp);

  if (plan.findings === null) {
    throw new PlanError('The plan file has no findings count. The report phase must run before enforce.');
  }

  const decision = evaluateGates({ ...plan, findings: plan.findings });
  const size = `${describeImage(plan)} is ${formatMib(plan.sizeBytes)} MiB uncompressed`;
  const failures: string[] = [];

  if (decision.overWarning) {
    core.warning(`${size}, above the ${plan.warningMib} MiB warning threshold (size-warning-mib).`, {
      title: 'Docker image size',
    });
  }

  if (decision.overLimit) {
    failures.push(`${size}, above the ${plan.limitMib} MiB limit (size-limit-mib).`);
  }

  if (decision.failsOnFindings) {
    failures.push(
      `Trivy reported ${plan.findings} finding(s) at ${plan.severity} for ${describeImage(plan)}, ` +
        'and trivy-fail-on-findings is true.',
    );
  }

  if (failures.length > 0) {
    throw new GateError(failures);
  }

  core.info(`${size}; every gate passed.`);
}

/** Runs the phase the `phase` input names. */
export function run(dependencies: ActionDependencies = defaultDependencies()): Promise<void> {
  return runAction(async () => {
    const phase = parsePhase(getInput(ActionInput.phase, { required: true }));

    switch (phase) {
      case 'measure': {
        await measure(dependencies);
        break;
      }
      case 'report': {
        await report(dependencies.context);
        break;
      }
      case 'enforce': {
        await enforce(dependencies.context);
        break;
      }
    }
  });
}
