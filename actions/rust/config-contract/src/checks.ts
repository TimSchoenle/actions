/**
 * The four comparisons, and the rule that governs all of them.
 *
 * Every enabled check runs, and every fault any of them found is reported before the step fails. A
 * run that names one missing label and hides two — or fails on the Dockerfile and never looks at the
 * image at all — is a second round trip through a pipeline that already took minutes.
 *
 * A check is skipped only by emptying its input, which is what lets a repository with no image, or
 * no committed contract, take only the half that applies to it. Nothing else skips: a check whose
 * file is missing, whose region is absent or whose image cannot be read is a *finding*. An unrun
 * check reported as a passing image is the failure mode this whole scheme exists to remove.
 */
import path from 'node:path';

import { isContractDocument } from './contract-document.js';
import { diffContent } from './diff.js';
import { describeRegionProblem, extractLabelRegion } from './dockerfile-region.js';
import { describeLabelFault, findLabelFaults, readImageLabels } from './labels.js';

import type { ImageInspector } from './docker.js';
import type { Renderings } from './generator.js';
import type { ContractLabel } from './labels.js';
import type { ContractOptions, OptionalPath } from './options.js';

/**
 * The checks this action can run, named once each.
 *
 * Bound to constants rather than written as literals at every use, because each id appears in the
 * list, in the finding its check produces and in the skip that stands in for it — three places that
 * have to agree, and that a published output makes part of this action's contract.
 */
const DOCKERFILE_BLOCK = 'dockerfile-block';
const COMMITTED_CONTRACT = 'committed-contract';
const IMAGE_LABELS = 'image-labels';
const EMBEDDED_CONTRACT = 'embedded-contract';

/** Every check, in the order they are evaluated. */
export const CHECK_IDS = [DOCKERFILE_BLOCK, COMMITTED_CONTRACT, IMAGE_LABELS, EMBEDDED_CONTRACT] as const;

export type CheckId = (typeof CHECK_IDS)[number];

/** One fault, ready to be rendered as an annotation. */
export interface Finding {
  readonly check: CheckId;
  readonly message: string;
  /** Repository-relative path the annotation is anchored to, when the fault is in a file. */
  readonly file?: string;
}

/** What a run of the checks concluded. */
export interface CheckReport {
  readonly ran: CheckId[];
  readonly skipped: CheckId[];
  readonly findings: Finding[];
}

/** Reads a file, or reports that there is nothing readable at the path. */
export type FileReader = (absolutePath: string) => Promise<string | undefined>;

/** Everything the checks need that they do not compute themselves. */
export interface CheckContext {
  readonly options: ContractOptions;
  readonly renderings: Renderings;
  /** The parsed `--format labels` rendering, shared with the action's `labels` output. */
  readonly labels: readonly ContractLabel[];
  readonly readFile: FileReader;
  readonly inspector: ImageInspector;
  /** Directory the embedded contract is copied into, normally `RUNNER_TEMP`. */
  readonly tempDirectory: string;
}

/** Name the copy of the embedded contract is given, inside the step's own temporary directory. */
const EMBEDDED_COPY = 'embedded.contract.json';

/** Builds a finding for one check, anchored to a file when there is one to anchor to. */
function findingIn(check: CheckId, file: string | undefined, message: string): Finding[] {
  return [file === undefined ? { check, message } : { check, message, file }];
}

/**
 * The cheap half: it needs no image, and it reports a renamed key in the pull request that renamed
 * it, in a diff a reviewer reads rather than in a build log nobody opens.
 */
async function checkDockerfileBlock(context: CheckContext, dockerfile: OptionalPath): Promise<Finding[]> {
  const fault = (message: string): Finding[] => findingIn(DOCKERFILE_BLOCK, dockerfile.workspaceRelative, message);
  const content = await context.readFile(dockerfile.absolute);

  if (content === undefined) {
    return fault(`${dockerfile.input} does not exist, so its LABEL block was never compared.`);
  }

  const region = extractLabelRegion(content);

  if (region.kind === 'problem') {
    return fault(`${dockerfile.input} ${describeRegionProblem(region.problem)}`);
  }

  const difference = diffContent(context.renderings.dockerfile, region.content);

  return difference === undefined
    ? []
    : fault(
        `${dockerfile.input}: the terrace-config:labels region is not the block this contract publishes. ` +
          `Paste the output of \`--format dockerfile\`.\n${difference}`,
      );
}

/**
 * `--format contract` is rendered without `--version`, `--revision` or `--created`, so it is
 * byte-reproducible across rebuilds and releases: the committed copy describes the configuration
 * surface, and the copy inside an image additionally names the build it came from. That is what lets
 * this be a diff rather than a semantic comparison.
 */
async function checkCommittedContract(context: CheckContext, contract: OptionalPath): Promise<Finding[]> {
  const fault = (message: string): Finding[] => findingIn(COMMITTED_CONTRACT, contract.workspaceRelative, message);
  const content = await context.readFile(contract.absolute);

  if (content === undefined) {
    return fault(`${contract.input} does not exist. Redirect \`--format contract\` into it and commit the result.`);
  }

  const difference = diffContent(context.renderings.contract, content);

  return difference === undefined
    ? []
    : fault(
        `${contract.input}: the committed contract is not the one these types produce. ` +
          `Regenerate it with \`--format contract\` and commit the diff.\n${difference}`,
      );
}

/**
 * The half no source diff can give, and the reason a hand-written LABEL block is safe at all.
 *
 * A diff sees the recipe: it cannot see a build argument that failed to interpolate, a label a base
 * image overrode, or a LABEL line deleted on a branch nobody diffed. This sees what a registry will
 * actually serve. Extra labels are ignored on purpose — every image carries
 * `org.opencontainers.image.*` and whatever its base contributed, and none of that is this
 * document's business.
 */
async function checkImageLabels(context: CheckContext, reference: string): Promise<Finding[]> {
  const actual = readImageLabels(await context.inspector.inspectLabels(reference));

  return findLabelFaults(context.labels, actual).map((entry) => ({
    check: IMAGE_LABELS,
    message: `${reference}: ${describeLabelFault(entry)}`,
  }));
}

/**
 * The label says where the document is; this says something is actually there.
 *
 * It deliberately does not compare the two documents — see `contract-document.ts` for why the
 * embedded copy is not the byte-reproducible one the drift check uses.
 */
async function checkEmbeddedContract(context: CheckContext, reference: string): Promise<Finding[]> {
  const { embeddedContractPath } = context.options;
  const fault = (message: string): Finding[] => findingIn(EMBEDDED_CONTRACT, undefined, `${reference}: ${message}`);
  const destination = path.join(context.tempDirectory, EMBEDDED_COPY);

  if (!(await context.inspector.copyOut(reference, embeddedContractPath, destination))) {
    return fault(
      `nothing is at \`${embeddedContractPath}\`, which is the path its own \`dev.terrace.config.contract.path\` ` +
        'label advertises. The image is not self-describing; check the COPY that was meant to put it there.',
    );
  }

  const content = await context.readFile(destination);

  if (content === undefined) {
    return fault(`\`${embeddedContractPath}\` is not a readable file — a directory, most likely.`);
  }

  return isContractDocument(content)
    ? []
    : fault(`the file at \`${embeddedContractPath}\` is not a terrace-config contract.`);
}

/**
 * Runs every enabled check and collects what they found.
 *
 * Sequential rather than concurrent: they share one `docker` daemon and one temporary directory, and
 * the order is what makes the annotations read the way a reviewer would work through them — source
 * first, image second.
 */
export async function runChecks(context: CheckContext): Promise<CheckReport> {
  const { dockerfile, contract, image } = context.options;
  const ran: CheckId[] = [];
  const skipped: CheckId[] = [];
  const findings: Finding[] = [];

  const record = async (id: CheckId, check: () => Promise<Finding[]>): Promise<void> => {
    ran.push(id);
    findings.push(...(await check()));
  };

  if (dockerfile === undefined) {
    skipped.push(DOCKERFILE_BLOCK);
  } else {
    await record(DOCKERFILE_BLOCK, () => checkDockerfileBlock(context, dockerfile));
  }

  if (contract === undefined) {
    skipped.push(COMMITTED_CONTRACT);
  } else {
    await record(COMMITTED_CONTRACT, () => checkCommittedContract(context, contract));
  }

  if (image === undefined) {
    skipped.push(IMAGE_LABELS, EMBEDDED_CONTRACT);
  } else {
    await record(IMAGE_LABELS, () => checkImageLabels(context, image.reference));
    await record(EMBEDDED_CONTRACT, () => checkEmbeddedContract(context, image.reference));
  }

  return { ran, skipped, findings };
}
