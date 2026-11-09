/**
 * The `docs.yaml` next to an action's `action.yaml`: the facts about an action that its manifest,
 * the release manifest and git cannot supply.
 *
 * Validation is strict on purpose. An unknown key is an error rather than ignored, so a typo cannot
 * silently drop a row from the README, and a condition naming an input the action does not have is
 * an error, so renaming an input cannot leave the permissions table describing a ghost.
 */

export const DOCS_FILE_NAME = 'docs.yaml';

/** Scopes a workflow `permissions:` block accepts. */
export const TOKEN_SCOPES = [
  'actions',
  'artifact-metadata',
  'attestations',
  'checks',
  'contents',
  'deployments',
  'discussions',
  'id-token',
  'issues',
  'models',
  'packages',
  'pages',
  'pull-requests',
  'security-events',
  'statuses',
] as const;
export type TokenScope = (typeof TOKEN_SCOPES)[number];

export const RUNNER_REQUIREMENTS = ['linux', 'docker'] as const;
export type RunnerRequirement = (typeof RUNNER_REQUIREMENTS)[number];

/** When a permission is needed. Rendered as prose in the README. */
export type Condition =
  | 'always'
  | { input: string; equals: string }
  | { repository: 'private' | 'public' }
  | { all: Condition[] };

export interface Permission {
  scope: TokenScope;
  access: 'read' | 'write';
  when: Condition;
}

export interface EgressEndpoint {
  endpoint: string;
  for: string;
}

export interface Example {
  title: string;
  /** Path relative to the action directory. */
  file: string;
}

export interface ActionDocs {
  permissions: Permission[];
  egress: EgressEndpoint[];
  requires: RunnerRequirement[];
  examples: Example[];
}

/** What the validator needs to know about the action the file belongs to. */
export interface DocsContext {
  /** Repository-relative path of the `docs.yaml`, used in messages. */
  file: string;
  inputNames: ReadonlySet<string>;
}

export type DocsValidation = { ok: true; docs: ActionDocs } | { ok: false; problems: string[] };

/** Words that mark a value as unfinished. A migrated file carrying one cannot merge. */
const PLACEHOLDER = /\b(?:TODO|FIXME|TBD)\b/;

const LABEL_CHARACTERS = /^[a-z0-9-]+$/;
const MAX_LABEL_LENGTH = 63;

/** A DNS label: letters, digits and hyphens, at most 63 long, not starting or ending with a hyphen. */
function isHostLabel(label: string): boolean {
  return (
    label.length <= MAX_LABEL_LENGTH && LABEL_CHARACTERS.test(label) && !label.startsWith('-') && !label.endsWith('-')
  );
}

const PORT = /^[1-9]\d{0,4}$/;
const MAX_PORT = 65_535;

/** `host:port`, where the host may start with a `*.` wildcard label as harden-runner allows. */
function isEndpoint(endpoint: string): boolean {
  const colon = endpoint.lastIndexOf(':');
  const port = endpoint.slice(colon + 1);
  if (colon === -1 || !PORT.test(port) || Number(port) > MAX_PORT) {
    return false;
  }
  const host = endpoint.slice(0, colon);
  const labels = (host.startsWith('*.') ? host.slice(2) : host).split('.');
  return labels.every(isHostLabel);
}

const EXAMPLE_FILE = /^examples\/[\w.-]+\.ya?ml$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Collects problems with a location prefix, so every message names the key it is about. */
class Problems {
  readonly list: string[] = [];

  constructor(private readonly file: string) {}

  add(where: string, message: string): void {
    this.list.push(`${this.file}: ${where}: ${message}`);
  }
}

function checkKeys(value: Record<string, unknown>, allowed: readonly string[], where: string, problems: Problems) {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      problems.add(where, `unknown key '${key}', expected one of ${allowed.join(', ')}`);
    }
  }
}

function text(value: unknown, where: string, problems: Problems): string | undefined {
  if (typeof value !== 'string' || value.trim() === '') {
    problems.add(where, 'must be a non-empty string');
    return undefined;
  }
  if (PLACEHOLDER.test(value)) {
    problems.add(where, `still holds a placeholder: ${JSON.stringify(value)}`);
    return undefined;
  }
  return value.trim();
}

function list(value: unknown, where: string, problems: Problems): unknown[] | undefined {
  if (!Array.isArray(value)) {
    problems.add(where, 'must be a list; write [] for none');
    return undefined;
  }
  return value;
}

const CONDITION_SHAPES = "must be 'always', { input, equals }, { repository } or { all: [...] }";

function allCondition(
  value: Record<string, unknown>,
  where: string,
  context: DocsContext,
  problems: Problems,
): Condition | undefined {
  checkKeys(value, ['all'], where, problems);
  const items = list(value.all, `${where}.all`, problems);
  if (!items) {
    return undefined;
  }
  if (items.length < 2) {
    problems.add(`${where}.all`, 'needs at least two conditions');
    return undefined;
  }
  const parsed = items.map((item, index) => {
    const itemWhere = `${where}.all[${index}]`;
    // "always and x" is just "x"; refusing it keeps the rendered sentence honest.
    if (item === 'always') {
      problems.add(itemWhere, "'always' adds nothing inside 'all'; drop it");
      return undefined;
    }
    return condition(item, itemWhere, context, problems);
  });
  return parsed.every((item) => item !== undefined) ? { all: parsed as Condition[] } : undefined;
}

function repositoryCondition(value: Record<string, unknown>, where: string, problems: Problems): Condition | undefined {
  checkKeys(value, ['repository'], where, problems);
  if (value.repository !== 'private' && value.repository !== 'public') {
    problems.add(`${where}.repository`, "must be 'private' or 'public'");
    return undefined;
  }
  return { repository: value.repository };
}

function inputCondition(
  value: Record<string, unknown>,
  where: string,
  context: DocsContext,
  problems: Problems,
): Condition | undefined {
  checkKeys(value, ['input', 'equals'], where, problems);
  const input = text(value.input, `${where}.input`, problems);
  if (input !== undefined && !context.inputNames.has(input)) {
    problems.add(`${where}.input`, `action.yaml has no input '${input}'`);
    return undefined;
  }
  // GitHub hands every input to the action as a string, so `true` and 'true' mean the same. A number
  // is refused: YAML reads `1.0` as 1, while the action receives the text as written.
  const equals = value.equals;
  if (typeof equals !== 'string' && typeof equals !== 'boolean') {
    problems.add(`${where}.equals`, 'must be a string or a boolean; quote a number');
    return undefined;
  }
  return input === undefined ? undefined : { input, equals: String(equals) };
}

function condition(value: unknown, where: string, context: DocsContext, problems: Problems): Condition | undefined {
  if (value === 'always') {
    return 'always';
  }
  if (isRecord(value) && 'all' in value) {
    return allCondition(value, where, context, problems);
  }
  if (isRecord(value) && 'repository' in value) {
    return repositoryCondition(value, where, problems);
  }
  if (isRecord(value) && 'input' in value) {
    return inputCondition(value, where, context, problems);
  }
  problems.add(where, CONDITION_SHAPES);
  return undefined;
}

function permission(value: unknown, where: string, context: DocsContext, problems: Problems): Permission | undefined {
  if (!isRecord(value)) {
    problems.add(where, 'must be a map with scope, access and when');
    return undefined;
  }
  checkKeys(value, ['scope', 'access', 'when'], where, problems);

  const scope = value.scope;
  if (!TOKEN_SCOPES.includes(scope as TokenScope)) {
    problems.add(`${where}.scope`, `must be one of ${TOKEN_SCOPES.join(', ')}`);
  }
  const access = value.access;
  if (access !== 'read' && access !== 'write') {
    problems.add(`${where}.access`, "must be 'read' or 'write'");
  } else if (scope === 'id-token' && access !== 'write') {
    problems.add(`${where}.access`, "id-token only takes 'write'");
  }
  const when = condition(value.when, `${where}.when`, context, problems);

  if (!TOKEN_SCOPES.includes(scope as TokenScope) || (access !== 'read' && access !== 'write') || !when) {
    return undefined;
  }
  return { scope: scope as TokenScope, access, when };
}

function egressEndpoint(value: unknown, where: string, problems: Problems): EgressEndpoint | undefined {
  if (!isRecord(value)) {
    problems.add(where, 'must be a map with endpoint and for');
    return undefined;
  }
  checkKeys(value, ['endpoint', 'for'], where, problems);

  const endpoint = text(value.endpoint, `${where}.endpoint`, problems);
  const purpose = text(value.for, `${where}.for`, problems);
  if (endpoint !== undefined && !isEndpoint(endpoint)) {
    problems.add(
      `${where}.endpoint`,
      `must be host:port in lower case, e.g. ghcr.io:443, got ${JSON.stringify(endpoint)}`,
    );
    return undefined;
  }
  return endpoint !== undefined && purpose !== undefined ? { endpoint, for: purpose } : undefined;
}

function example(value: unknown, where: string, problems: Problems): Example | undefined {
  if (!isRecord(value)) {
    problems.add(where, 'must be a map with title and file');
    return undefined;
  }
  checkKeys(value, ['title', 'file'], where, problems);

  const title = text(value.title, `${where}.title`, problems);
  const file = text(value.file, `${where}.file`, problems);
  if (file !== undefined && !EXAMPLE_FILE.test(file)) {
    problems.add(`${where}.file`, `must be a .yaml or .yml file directly under examples/, got ${JSON.stringify(file)}`);
    return undefined;
  }
  return title !== undefined && file !== undefined ? { title, file } : undefined;
}

function duplicates<T>(items: readonly T[], key: (item: T) => string, where: string, problems: Problems): void {
  const seen = new Set<string>();
  for (const item of items) {
    const id = key(item);
    if (seen.has(id)) {
      problems.add(where, `${id} is listed twice`);
    }
    seen.add(id);
  }
}

/**
 * Validates a parsed `docs.yaml`.
 *
 * `permissions` and `egress` are required, with `[]` meaning "none": an action whose file says
 * nothing about egress must not read the same as one that needs none. `requires` and `examples` are
 * optional.
 */
export function validateDocsFile(raw: unknown, context: DocsContext): DocsValidation {
  const problems = new Problems(context.file);

  if (!isRecord(raw)) {
    problems.add('root', 'must be a YAML map');
    return { ok: false, problems: problems.list };
  }
  checkKeys(raw, ['permissions', 'egress', 'requires', 'examples'], 'root', problems);

  const permissions = (list(raw.permissions, 'permissions', problems) ?? []).map((item, index) =>
    permission(item, `permissions[${index}]`, context, problems),
  );
  const egress = (list(raw.egress, 'egress', problems) ?? []).map((item, index) =>
    egressEndpoint(item, `egress[${index}]`, problems),
  );
  const requires = (raw.requires === undefined ? [] : (list(raw.requires, 'requires', problems) ?? [])).map(
    (item, index) => {
      if (!RUNNER_REQUIREMENTS.includes(item as RunnerRequirement)) {
        problems.add(`requires[${index}]`, `must be one of ${RUNNER_REQUIREMENTS.join(', ')}`);
        return undefined;
      }
      return item as RunnerRequirement;
    },
  );
  const examples = (raw.examples === undefined ? [] : (list(raw.examples, 'examples', problems) ?? [])).map(
    (item, index) => example(item, `examples[${index}]`, problems),
  );

  const valid = <T>(items: (T | undefined)[]): T[] => items.filter((item): item is T => item !== undefined);
  const docs: ActionDocs = {
    permissions: valid(permissions),
    egress: valid(egress),
    requires: valid(requires),
    examples: valid(examples),
  };

  // One scope may appear at both levels, `contents: read` always and `contents: write` only when the
  // action commits, but the same scope and level twice is two conditions the reader has to merge.
  duplicates(docs.permissions, (item) => `${item.scope}: ${item.access}`, 'permissions', problems);
  duplicates(docs.egress, (item) => item.endpoint, 'egress', problems);
  duplicates(docs.requires, (item) => item, 'requires', problems);
  duplicates(docs.examples, (item) => item.file, 'examples', problems);

  return problems.list.length > 0 ? { ok: false, problems: problems.list } : { ok: true, docs };
}
