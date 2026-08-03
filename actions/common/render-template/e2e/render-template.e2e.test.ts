import { fileURLToPath } from 'node:url';

import { runAction, Workspace } from 'actions-e2e';
import { afterEach, describe, expect, it } from 'vitest';

import type { ActionInput, ActionOutput } from '../src/generated/action-io.js';
import type { ActionRunResult, ExpectedOutcome, ProvidedInputs, WorkspaceFiles } from 'actions-e2e';

/**
 * End-to-end cases for `actions/common/render-template`, replacing the six jobs of
 * `verify-action-common-render-template.yaml` — including its ten-way render matrix and nine-way
 * failure matrix, which together cost nineteen runner slots.
 *
 * The action only touches the filesystem, so these cases need no token and no scratch repository.
 */

const ACTION_DIRECTORY = fileURLToPath(new URL('..', import.meta.url));

const TEMPLATE = 'README.hbs';
const OUTPUT = 'out/README.md';

/** Every template feature the action must support, asserted on the rendered bytes. */
const RENDER_CASES = [
  {
    name: 'interpolation',
    template: '# {{ repo }}\n\nVersion {{ version }}.\n',
    variables: { repo: 'acme/actions', version: '1.4.0' },
    expected: '# acme/actions\n\nVersion 1.4.0.\n',
  },
  {
    name: 'nested paths',
    template: '{{ repo.owner }}/{{ repo.name }}@{{ repo.meta.branch }}',
    variables: { repo: { owner: 'acme', name: 'actions', meta: { branch: 'main' } } },
    expected: 'acme/actions@main',
  },
  {
    name: 'a markdown table from #each',
    template:
      '| Action | Description |\n| --- | --- |\n{{#each actions}}| `{{ name }}` | {{ description }} |\n{{/each}}\n',
    variables: {
      actions: [
        { name: 'read-yaml', description: 'Read a value' },
        { name: 'clippy', description: 'Lint Rust' },
      ],
    },
    expected: '| Action | Description |\n| --- | --- |\n| `read-yaml` | Read a value |\n| `clippy` | Lint Rust |\n',
  },
  {
    name: 'a sorted table, independently of input order',
    template: '{{#each (sortBy actions "name")}}{{ name }}\n{{/each}}\n',
    variables: { actions: [{ name: 'zebra' }, { name: 'alpha' }, { name: 'middle' }] },
    expected: 'alpha\nmiddle\nzebra\n',
  },
  {
    name: 'conditionals',
    template:
      '{{#if hasWorkflows}}has workflows{{else}}no workflows{{/if}}\n{{#if hasActions}}has actions{{else}}no actions{{/if}}\n',
    variables: { hasWorkflows: true, hasActions: false },
    expected: 'has workflows\nno actions\n',
  },
  {
    name: 'the #each data variables',
    template: '{{#each tags}}{{ @index }}:{{ this }}{{#unless @last}}, {{/unless}}{{/each}}',
    variables: { tags: ['ci', 'docs', 'rust'] },
    expected: '0:ci, 1:docs, 2:rust',
  },
  {
    name: 'table cell escaping',
    template: '| {{ mdCell description }} |',
    variables: { description: 'Read a|b\nacross lines' },
    expected: '| Read a\\|b<br>across lines |',
  },
  {
    name: 'no HTML escaping by default',
    template: '{{ snippet }}',
    variables: { snippet: '<!-- ACTIONS_TABLE --> & "quotes" & \'apostrophes\'' },
    expected: '<!-- ACTIONS_TABLE --> & "quotes" & \'apostrophes\'',
  },
  {
    name: 'unicode intact',
    template: '{{ text }}',
    variables: { text: '✅ Grüße — 日本語 — 🚀' },
    expected: '✅ Grüße — 日本語 — 🚀',
  },
  {
    name: 'the helper set',
    template:
      '{{ upper name }} {{ lower name }} {{ count tags }} {{ join (sort tags) "|" }}\n{{ default missingValue "fallback" }} {{ replace slug "-" "_" }}\n',
    variables: { name: 'Actions', tags: ['c', 'a', 'b'], missingValue: '', slug: 'render-template-action' },
    expected: 'ACTIONS actions 3 a|b|c\nfallback render_template_action\n',
  },
];

/** Inputs the action must reject, each of which must also leave no output file behind. */
const FAILURE_CASES = [
  { name: 'an undefined block argument', template: '{{#each actions}}row{{/each}}', variables: '{"other":1}' },
  { name: 'an undefined interpolation', template: '{{ missing }}', variables: '{}' },
  { name: 'an undefined helper argument', template: '{{ join tags }}', variables: '{}' },
  { name: 'variables that are not JSON', template: 'x', variables: 'title: Actions\n' },
  { name: 'variables that are not an object', template: 'x', variables: '["a","b"]' },
  { name: 'a prototype-reaching key', template: 'x', variables: '{"__proto__":{"polluted":true}}' },
  { name: 'a malformed template', template: '{{#each items}}unclosed', variables: '{"items":[]}' },
  { name: 'a missing template file', missingTemplate: true, variables: '{}' },
  { name: 'a missing partials directory', template: 'x', variables: '{}', partialsDir: 'no/such/directory' },
];

describe('render-template', () => {
  let workspace: Workspace;

  afterEach(async () => {
    await workspace.dispose();
  });

  function render(
    inputs: ProvidedInputs<ActionInput>,
    expected: ExpectedOutcome = 'success',
  ): Promise<ActionRunResult<ActionOutput>> {
    return runAction<ActionInput, ActionOutput>({
      actionDirectory: ACTION_DIRECTORY,
      inputs: { template: TEMPLATE, output: OUTPUT, ...inputs },
      workspace,
      expect: expected,
    });
  }

  async function withFiles(files: WorkspaceFiles): Promise<void> {
    workspace = await Workspace.create(files);
  }

  it.each(RENDER_CASES)('renders $name', async ({ template, variables, expected }) => {
    await withFiles({ [TEMPLATE]: template });

    const result = await render({ variables: JSON.stringify(variables) });

    // A byte-exact comparison, not a pattern match: a stray blank line or a lost trailing newline is
    // a real defect in a generated file and is exactly what a grep cannot see.
    await expect(workspace.read(OUTPUT)).resolves.toBe(expected);
    expect(result.outputs['changed']).toBe('true');
    expect(result.outputs['output-path']).toBe(OUTPUT);
  });

  it.each(FAILURE_CASES)('fails on $name', async ({ template, variables, missingTemplate, partialsDir }) => {
    await withFiles(missingTemplate === true ? {} : { [TEMPLATE]: template as string });

    await render({ variables, ...(partialsDir === undefined ? {} : { 'partials-dir': partialsDir }) }, 'failure');

    await expect(workspace.exists(OUTPUT)).resolves.toBe(false);
  });

  it('resolves a nested partial by path without re-indenting it', async () => {
    await withFiles({
      [TEMPLATE]: '# {{ repo }}\n\n{{> tables/actions }}\n\n{{> footer }}\n',
      'partials/tables/actions.hbs':
        '| Action | Description |\n| --- | --- |\n{{#each (sortBy actions "name")}}| `{{ name }}` | {{ mdCell description }} |\n{{/each}}\n',
      'partials/footer.hbs': '---\nGenerated from README.hbs.\n',
    });

    const result = await render({
      output: 'docs/generated/README.md',
      'partials-dir': 'partials',
      variables: JSON.stringify({
        repo: 'acme/actions',
        actions: [
          { name: 'read-yaml', description: 'Read a|value' },
          { name: 'clippy', description: 'Lint Rust' },
        ],
      }),
    });

    await expect(workspace.read('docs/generated/README.md')).resolves.toBe(
      '# acme/actions\n\n| Action | Description |\n| --- | --- |\n| `clippy` | Lint Rust |\n| `read-yaml` | Read a\\|value |\n\n---\nGenerated from README.hbs.\n',
    );
    expect(result.outputs['output-path']).toBe('docs/generated/README.md');
    expect(result.outputs['changed']).toBe('true');
  });

  it('reports no change when identical inputs are rendered twice', async () => {
    const variables = JSON.stringify({ tags: ['docs', 'ci', 'rust'] });

    await withFiles({ [TEMPLATE]: '{{#each (sort tags)}}- {{ this }}\n{{/each}}' });

    const first = await render({ variables });
    const rendered = await workspace.read(OUTPUT);
    const second = await render({ variables });
    // Reordering the input must not reorder the output, or a generated file churns forever.
    const reordered = await render({ variables: JSON.stringify({ tags: ['rust', 'docs', 'ci'] }) });

    expect(first.outputs['changed']).toBe('true');
    expect(second.outputs['changed']).toBe('false');
    expect(reordered.outputs['changed']).toBe('false');
    expect(second.outputs['checksum']).toBe(first.outputs['checksum']);
    await expect(workspace.read(OUTPUT)).resolves.toBe(rendered);
  });

  it('passes check mode for a current file and fails it for a stale or missing one', async () => {
    const variables = JSON.stringify({ title: 'Actions' });

    await withFiles({ [TEMPLATE]: '# {{ title }}\n', [OUTPUT]: '# Actions\n' });

    const current = await render({ variables, check: 'true' });

    expect(current.outputs['changed']).toBe('false');

    await workspace.write({ [OUTPUT]: '# Actions\nhand-edited line\n' });
    await render({ variables, check: 'true' }, 'failure');
    await render({ output: 'absent/README.md', variables, check: 'true' }, 'failure');

    // Check mode must not write, so the hand-edited file is still there untouched.
    await expect(workspace.read(OUTPUT)).resolves.toBe('# Actions\nhand-edited line\n');
    await expect(workspace.exists('absent/README.md')).resolves.toBe(false);
  });

  it('reaches no prototype member from a template', async () => {
    await withFiles({
      [TEMPLATE]: '[{{ constructor }}][{{ constructor.constructor }}][{{ toString }}][{{ repo.constructor.name }}]',
    });

    await render({ variables: JSON.stringify({ repo: { name: 'actions' } }), strict: 'false' });

    await expect(workspace.read(OUTPUT)).resolves.toBe('[][][][]');
  });
});
