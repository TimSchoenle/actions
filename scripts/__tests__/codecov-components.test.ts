import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import { listActionFiles } from '../generate-codecov-components.js';
import {
  applyGeneratedComponents,
  collectMeasuredActions,
  COMPONENTS_BEGIN,
  COMPONENTS_END,
  renderComponents,
} from '../lib/codecov-components.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CODECOV_CONFIG_PATH = path.join(REPO_ROOT, '.github', 'codecov.yml');

const TEMPLATE = [
  'component_management:',
  '  individual_components:',
  '    - component_id: scripts',
  '      name: scripts',
  "      paths: ['scripts/**']",
  `    ${COMPONENTS_BEGIN}`,
  `    ${COMPONENTS_END}`,
  '',
].join('\n');

interface Component {
  component_id: string;
  name: string;
  paths: string[];
}

function componentsOf(content: string): Component[] {
  const doc = parse(content) as { component_management: { individual_components: Component[] } };
  return doc.component_management.individual_components;
}

describe('collectMeasuredActions', () => {
  it('keeps actions with TypeScript sources under src/, including nested helper/src/', () => {
    const actions = collectMeasuredActions([
      'actions/common/read-yaml/src/action.ts',
      'actions/docker/image-check/helper/src/index.ts',
      'actions/common/read-yaml/src/lib/parse.ts',
    ]);

    expect(actions).toEqual([
      { category: 'common', action: 'read-yaml' },
      { category: 'docker', action: 'image-check' },
    ]);
  });

  it('skips composite-only actions and files Vitest never measures', () => {
    const actions = collectMeasuredActions([
      'actions/bun/setup-cached/action.yaml',
      'actions/rust/coverage-codecov/scripts/merge.ts',
      'actions/helm/a/src/action.test.ts',
      'actions/helm/b/src/generated/action-io.ts',
      'actions/helm/c/dist/index.ts',
      'actions/helm/d/src/types.d.ts',
      'packages/ts-util/src/action.ts',
      'scripts/generate-docs.ts',
    ]);

    expect(actions).toEqual([]);
  });

  it('accepts Windows separators', () => {
    expect(collectMeasuredActions(['actions\\common\\read-yaml\\src\\action.ts'])).toEqual([
      { category: 'common', action: 'read-yaml' },
    ]);
  });

  it('sorts by category, then action, regardless of input order', () => {
    const actions = collectMeasuredActions([
      'actions/security/codeql/src/a.ts',
      'actions/common/upsert-issue/src/a.ts',
      'actions/common/create-branch/src/a.ts',
    ]);

    expect(actions.map(({ category, action }) => `${category}/${action}`)).toEqual([
      'common/create-branch',
      'common/upsert-issue',
      'security/codeql',
    ]);
  });
});

describe('renderComponents', () => {
  it('renders one entry per action with a category-qualified id, name and path', () => {
    expect(renderComponents([{ category: 'common', action: 'read-yaml' }])).toBe(
      [
        '    - component_id: common-read-yaml',
        '      name: common/read-yaml',
        "      paths: ['actions/common/read-yaml/**']",
      ].join('\n'),
    );
  });

  it('renders nothing for no actions', () => {
    expect(renderComponents([])).toBe('');
  });
});

describe('applyGeneratedComponents', () => {
  const actions = [
    { category: 'common', action: 'read-yaml' },
    { category: 'helm', action: 'apply-chart-updates' },
  ];

  it('splices the components between the markers and keeps the hand-written entries', () => {
    const result = applyGeneratedComponents(TEMPLATE, actions);

    expect(componentsOf(result)).toEqual([
      { component_id: 'scripts', name: 'scripts', paths: ['scripts/**'] },
      { component_id: 'common-read-yaml', name: 'common/read-yaml', paths: ['actions/common/read-yaml/**'] },
      {
        component_id: 'helm-apply-chart-updates',
        name: 'helm/apply-chart-updates',
        paths: ['actions/helm/apply-chart-updates/**'],
      },
    ]);
  });

  it('is idempotent', () => {
    const once = applyGeneratedComponents(TEMPLATE, actions);

    expect(applyGeneratedComponents(once, actions)).toBe(once);
  });

  it('replaces a stale list instead of appending to it', () => {
    const stale = applyGeneratedComponents(TEMPLATE, actions);
    const result = applyGeneratedComponents(stale, [{ category: 'security', action: 'codeql' }]);

    expect(componentsOf(result).map((component) => component.component_id)).toEqual(['scripts', 'security-codeql']);
  });

  it('leaves valid YAML when no action is measured', () => {
    const result = applyGeneratedComponents(TEMPLATE, []);

    expect(result).toBe(TEMPLATE);
    expect(componentsOf(result)).toHaveLength(1);
  });

  it.each([
    ['both markers', TEMPLATE.replace(COMPONENTS_BEGIN, '').replace(COMPONENTS_END, '')],
    ['the begin marker', TEMPLATE.replace(COMPONENTS_BEGIN, '')],
    ['the end marker', TEMPLATE.replace(COMPONENTS_END, '')],
  ])('throws a clear error when %s are missing', (_label, content) => {
    expect(() => applyGeneratedComponents(content, actions)).toThrow(/missing the .* markers/);
  });

  it('throws when the markers are reversed', () => {
    const reversed = `${COMPONENTS_END}\n${COMPONENTS_BEGIN}\n`;

    expect(() => applyGeneratedComponents(reversed, actions)).toThrow(/missing the .* markers/);
  });
});

// Drift guard over the real repository: adding or removing an action without regenerating the list
// fails CI instead of leaving the Codecov comment without that action's component.
describe('.github/codecov.yml', () => {
  const committed = fs.readFileSync(CODECOV_CONFIG_PATH, 'utf8');
  const measured = collectMeasuredActions(listActionFiles());

  it('discovers the measured actions', () => {
    expect(measured.length).toBeGreaterThan(0);
  });

  it('component list is byte-for-byte what the generator would emit', () => {
    // Regenerate with: bun run generate-codecov-components
    expect(applyGeneratedComponents(committed, measured)).toEqual(committed);
  });

  it('component ids are unique', () => {
    const ids = componentsOf(committed).map((component) => component.component_id);

    expect(new Set(ids).size).toBe(ids.length);
  });
});
