// Pure helpers shared by the `generate-codecov-components` script and its drift test.
// Free of any filesystem or Bun-specific API so the vitest suite (which runs under Node) can
// exercise the exact logic the generator uses.

/** Markers delimiting the generated component list inside `.github/codecov.yml`. */
export const COMPONENTS_BEGIN = '# <<< generated: action-components';
export const COMPONENTS_END = '# >>> generated: action-components';

/** Indent of a list entry under `component_management.individual_components`. */
const ENTRY_INDENT = '    ';

/** Sources Vitest never measures, mirroring `coverage.exclude` in vitest.config.ts. */
const UNMEASURED_PATTERN = /(?:\.test\.ts|\.d\.ts)$|\/generated\/|\/dist\/|\/node_modules\//;

export interface MeasuredAction {
  category: string;
  action: string;
}

function compareActions(a: MeasuredAction, b: MeasuredAction): number {
  const left = `${a.category}/${a.action}`;
  const right = `${b.category}/${b.action}`;
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

/**
 * The action a TypeScript source belongs to: `actions/<category>/<action>/` followed by any path
 * that passes through a `src/` directory, which also covers `docker/image-check/helper/src/`.
 */
function actionSourceOf(filePath: string): MeasuredAction | undefined {
  const segments = filePath.split('/');
  const [root, category, action] = segments;
  if (root !== 'actions' || segments.length < 5 || !filePath.endsWith('.ts')) {
    return undefined;
  }
  if (!segments.slice(3, -1).includes('src')) {
    return undefined;
  }
  return { category, action };
}

/**
 * The actions Vitest measures, given every file path under the repository root. A composite-only
 * action has no TypeScript sources and contributes no line to the coverage report, so it gets no
 * component. Paths may use either separator; the result is sorted by `<category>/<action>`.
 */
export function collectMeasuredActions(filePaths: readonly string[]): MeasuredAction[] {
  const seen = new Map<string, MeasuredAction>();
  for (const filePath of filePaths) {
    const normalized = filePath.replaceAll('\\', '/');
    if (UNMEASURED_PATTERN.test(normalized)) {
      continue;
    }
    const source = actionSourceOf(normalized);
    if (source) {
      seen.set(`${source.category}/${source.action}`, source);
    }
  }
  return [...seen.values()].sort(compareActions);
}

/** Render one Codecov component entry per action, in the order given. */
export function renderComponents(actions: readonly MeasuredAction[]): string {
  return actions
    .map(({ category, action }) =>
      [
        `${ENTRY_INDENT}- component_id: ${category}-${action}`,
        `${ENTRY_INDENT}  name: ${category}/${action}`,
        `${ENTRY_INDENT}  paths: ['actions/${category}/${action}/**']`,
      ].join('\n'),
    )
    .join('\n');
}

function markerBounds(codecovContent: string): { begin: number; end: number } {
  const begin = codecovContent.indexOf(COMPONENTS_BEGIN);
  const end = codecovContent.indexOf(COMPONENTS_END);
  if (begin === -1 || end === -1 || end < begin) {
    throw new Error(
      `.github/codecov.yml is missing the '${COMPONENTS_BEGIN}' / '${COMPONENTS_END}' markers around the generated action components.`,
    );
  }
  return { begin, end };
}

/** Rewrite the generated component list in `.github/codecov.yml` with one entry per action. */
export function applyGeneratedComponents(codecovContent: string, actions: readonly MeasuredAction[]): string {
  const { begin, end } = markerBounds(codecovContent);
  const before = codecovContent.slice(0, begin + COMPONENTS_BEGIN.length);
  const after = codecovContent.slice(end);
  const rendered = renderComponents(actions);
  const block = rendered === '' ? `\n${ENTRY_INDENT}` : `\n${rendered}\n${ENTRY_INDENT}`;
  return `${before}${block}${after}`;
}
