import { codeSpan, collapseWhitespace, table, tableCell } from './markdown.js';

import type { ActionDocs, Condition, RunnerRequirement } from './docs-file.js';
import type { ActionManifest } from './manifest.js';
import type { Regions } from './markers.js';

/** A released action: the tag and, when it resolves locally, the commit it points at. */
export interface Release {
  tag: string;
  sha: string | undefined;
}

export interface LoadedExample {
  title: string;
  /** The example workflow with this action's `uses:` already pinned. */
  content: string;
}

/** Everything one README is generated from, already read from disk. */
export interface ReadmeModel {
  repoId: string;
  /** Repository-relative action directory, e.g. `actions/security/zizmor`. */
  actionPath: string;
  manifest: ActionManifest;
  /**
   * `undefined` while release-please has no version for the action. A version whose tag does not
   * resolve yet, as in a release pull request, still counts: see {@link usesReference}.
   */
  release: Release | undefined;
  docs: ActionDocs;
  examples: LoadedExample[];
  hasChangelog: boolean;
  /** File name of the action's end-to-end workflow under `.github/workflows`, if it has one. */
  e2eWorkflow: string | undefined;
  /** Repository-relative files that call this action, sorted. */
  callers: string[];
}

/** From an action README at `actions/<category>/<name>/README.md` back to the repository root. */
const TO_ROOT = '../../../';

/** Callers listed inline; past this the list folds into a `<details>` block. */
const CALLERS_SHOWN_INLINE = 5;

/**
 * The `uses:` value for this action: SHA-pinned with the tag as a comment, or a placeholder.
 *
 * A tag that does not resolve yet falls back to the tag itself, as the root README does. That is
 * the state of a release pull request, where the tag is created only once it merges; the reference
 * is valid from that moment, and the next run on a branch with the tag pins its commit.
 */
export function usesReference(model: Pick<ReadmeModel, 'repoId' | 'actionPath' | 'release'>): string {
  const target = `${model.repoId}/${model.actionPath}`;
  if (!model.release) {
    return `${target}@<ref>`;
  }
  return `${target}@${model.release.sha ?? model.release.tag} # tag=${model.release.tag}`;
}

function runtimeLabel(runtime: string): string {
  if (runtime === 'composite') {
    return 'Composite action';
  }
  if (runtime === 'docker') {
    return 'Docker container action';
  }
  if (runtime.startsWith('node')) {
    return `JavaScript action (${runtime})`;
  }
  return codeSpan(runtime);
}

const REQUIREMENT_LABELS: Readonly<Record<RunnerRequirement, string>> = {
  linux: 'Linux runners only',
  docker: 'needs Docker',
};

function renderHeader(model: ReadmeModel): string {
  const facts = [
    model.release
      ? `[${model.release.tag}](https://github.com/${model.repoId}/releases/tag/${model.release.tag})`
      : 'Not released yet',
    runtimeLabel(model.manifest.runtime),
    ...model.docs.requires.map((requirement) => REQUIREMENT_LABELS[requirement]),
  ];
  // One paragraph, so a multi-line description cannot put a line of its own into the README.
  const description = collapseWhitespace(model.manifest.description);
  return [`# ${model.manifest.name}`, ...(description ? [description] : []), facts.join(' · ')].join('\n\n');
}

function renderMinimalUsage(model: ReadmeModel): string {
  const required = model.manifest.inputs.filter((input) => input.required && input.default === undefined);
  const lines = [`- uses: ${usesReference(model)}`];
  if (required.length > 0) {
    lines.push('  with:', ...required.map((input) => `    ${input.name}: # required, see Inputs`));
  }
  return `## Usage\n\n${['```yaml', ...lines, '```'].join('\n')}`;
}

function renderUsage(model: ReadmeModel): string {
  if (model.examples.length === 0) {
    return renderMinimalUsage(model);
  }
  const sections = model.examples.map(
    (example) => `### ${example.title}\n\n\`\`\`yaml\n${example.content.trimEnd()}\n\`\`\``,
  );
  return ['## Usage', ...sections].join('\n\n');
}

function renderInputs(model: ReadmeModel): string {
  if (model.manifest.inputs.length === 0) {
    return '## Inputs\n\nThis action takes no inputs.';
  }
  const rows = model.manifest.inputs.map((input) => [
    codeSpan(input.name),
    input.required ? 'yes' : 'no',
    input.default === undefined || input.default === '' ? '' : tableCell(codeSpan(input.default)),
    tableCell(input.description),
  ]);
  return `## Inputs\n\n${table(['Input', 'Required', 'Default', 'Description'], rows)}`;
}

function renderOutputs(model: ReadmeModel): string {
  if (model.manifest.outputs.length === 0) {
    return '## Outputs\n\nThis action sets no outputs.';
  }
  const rows = model.manifest.outputs.map((output) => [codeSpan(output.name), tableCell(output.description)]);
  return `## Outputs\n\n${table(['Output', 'Description'], rows)}`;
}

/** Renders a condition as the end of the sentence "Needed when …". */
export function describeCondition(condition: Condition): string {
  if (condition === 'always') {
    return 'always';
  }
  if ('all' in condition) {
    return condition.all.map(describeCondition).join(' and ');
  }
  if ('repository' in condition) {
    return `the repository is ${condition.repository}`;
  }
  if ('set' in condition) {
    return `${codeSpan(condition.input)} is set`;
  }
  return `${codeSpan(condition.input)} is ${codeSpan(condition.equals)}`;
}

function renderPermissions(docs: ActionDocs): string {
  if (docs.permissions.length === 0) {
    return '## Permissions\n\nNeeds no token permissions.';
  }
  const rows = docs.permissions.map((permission) => [
    codeSpan(`${permission.scope}: ${permission.access}`),
    tableCell(describeCondition(permission.when)),
  ]);
  // Only an action that is handed a token gets a column saying whose permission it is; for every
  // other action it would repeat "the job token" on each row.
  if (!docs.permissions.some((permission) => permission.token !== undefined)) {
    return `## Permissions\n\n${table(['Permission', 'Needed when'], rows)}`;
  }
  const withHolder = docs.permissions.map((permission, index) => [
    rows[index][0],
    permission.token === undefined ? 'the job token' : `the token in ${codeSpan(permission.token)}`,
    rows[index][1],
  ]);
  return `## Permissions\n\n${table(['Permission', 'Held by', 'Needed when'], withHolder)}`;
}

function renderEgress(docs: ActionDocs): string {
  if (docs.egress.length === 0) {
    return '## Egress\n\nReaches no endpoint beyond those the runner itself needs.';
  }
  const rows = docs.egress.map((entry) => [codeSpan(entry.endpoint), tableCell(entry.for)]);
  return [
    '## Egress',
    'A job that runs `step-security/harden-runner` with `egress-policy: block` has to allow:',
    table(['Endpoint', 'For'], rows),
  ].join('\n\n');
}

function link(repositoryPath: string): string {
  return `[${codeSpan(repositoryPath)}](${TO_ROOT}${repositoryPath})`;
}

function renderReference(model: ReadmeModel): string {
  const lines: string[] = [];
  if (model.hasChangelog) {
    lines.push('- Changelog: [CHANGELOG.md](./CHANGELOG.md)');
  }
  if (model.e2eWorkflow) {
    lines.push(`- End-to-end tests: ${link(`.github/workflows/${model.e2eWorkflow}`)}`);
  }
  if (model.callers.length === 0) {
    lines.push('- Not called from anywhere else in this repository.');
    return `## Reference\n\n${lines.join('\n')}`;
  }

  const callerList = model.callers.map((caller) => `- ${link(caller)}`).join('\n');
  if (model.callers.length <= CALLERS_SHOWN_INLINE) {
    lines.push('- Called from this repository by:', ...callerList.split('\n').map((line) => `  ${line}`));
    return `## Reference\n\n${lines.join('\n')}`;
  }
  // A long list folds away: the count is the useful fact, the paths are there for whoever wants them.
  const details = `<details>\n<summary>Called from ${model.callers.length} files in this repository</summary>\n\n${callerList}\n\n</details>`;
  return `## Reference\n\n${lines.join('\n')}\n\n${details}`;
}

/** Renders the content of every region for one action. */
export function renderRegions(model: ReadmeModel): Regions {
  return {
    header: renderHeader(model),
    usage: renderUsage(model),
    inputs: renderInputs(model),
    outputs: renderOutputs(model),
    permissions: renderPermissions(model.docs),
    egress: renderEgress(model.docs),
    reference: renderReference(model),
  };
}
