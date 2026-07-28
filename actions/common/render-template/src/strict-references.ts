/**
 * The gap Handlebars' own `strict` option leaves open.
 *
 * `strict: true` makes a bare `{{ name }}` throw when `name` is undefined — but only there. The
 * compiler marks a path for strict lookup solely when it is a *simple* mustache, so every path that
 * appears as an argument falls back to a silent `undefined`:
 *
 *     {{ missing }}                       throws
 *     {{#each missing}}…{{/each}}         renders nothing
 *     {{#each (sortBy missing "n")}}…      renders nothing
 *     {{#if missing}}…{{/if}}             renders the inverse branch
 *
 * For a generated README that is the worst possible behaviour: a typo in `{{#each actions}}` emits a
 * table with a header and no rows, the drift check accepts it because it is reproducible, and the
 * documentation is quietly wrong. This module closes the gap by checking argument paths against the
 * supplied variables before anything is rendered.
 *
 * Deliberately limited to the template's root scope. A block introduces a scope whose shape comes
 * from the data rather than from the variables map — inside `{{#each actions}}`, `{{ name }}` refers
 * to an element, and nothing here could know whether that element has one. Descending would trade a
 * class of caught typos for a class of false failures, so blocks are not descended into at all: what
 * is checked is exactly what the caller's `variables` map is responsible for defining.
 */

/** Names Handlebars resolves itself; they are never looked up in the variables. */
const BUILTIN_NAMES: ReadonlySet<string> = new Set(['this', 'else']);

type Expression = hbs.AST.Expression;
type Statement = hbs.AST.Statement;

function isPathExpression(node: hbs.AST.Node): node is hbs.AST.PathExpression {
  return node.type === 'PathExpression';
}

function isSubExpression(node: hbs.AST.Node): node is hbs.AST.SubExpression {
  return node.type === 'SubExpression';
}

/**
 * Whether a path refers to something the caller's variables must define.
 *
 * `@index` and friends come from the runtime, `../x` reaches a scope this does not model, and `this`
 * is the context itself. None of them is the caller's to declare.
 */
function isRootDataReference(path: hbs.AST.PathExpression): boolean {
  return !path.data && path.depth === 0 && path.parts.length > 0 && !BUILTIN_NAMES.has(path.parts[0]);
}

/** Collects the root names an expression and its nested sub-expressions read from the variables. */
function fromExpression(expression: Expression, helpers: ReadonlySet<string>, found: Set<string>): void {
  if (isSubExpression(expression)) {
    // The sub-expression's own path is the helper being called, not a variable. Its arguments are.
    fromArguments(expression, helpers, found);
    return;
  }

  if (isPathExpression(expression) && isRootDataReference(expression)) {
    const name = expression.parts[0];

    // A name that is also a registered helper is ambiguous to Handlebars itself, so it is left
    // alone: reporting it would be a false failure on a template that renders correctly.
    if (!helpers.has(name)) {
      found.add(name);
    }
  }
}

/** Collects from the arguments of a helper call — its positional parameters and its hash values. */
function fromArguments(
  call: hbs.AST.MustacheStatement | hbs.AST.BlockStatement | hbs.AST.SubExpression,
  helpers: ReadonlySet<string>,
  found: Set<string>,
): void {
  for (const parameter of call.params) {
    fromExpression(parameter, helpers, found);
  }

  for (const pair of call.hash?.pairs ?? []) {
    fromExpression(pair.value, helpers, found);
  }
}

function fromStatement(statement: Statement, helpers: ReadonlySet<string>, found: Set<string>): void {
  if (statement.type === 'MustacheStatement') {
    const mustache = statement as hbs.AST.MustacheStatement;

    // A mustache with no arguments is a plain interpolation, which Handlebars' own strict lookup
    // already covers. Only a helper invocation needs checking here.
    if (mustache.params.length > 0 || (mustache.hash?.pairs.length ?? 0) > 0) {
      fromArguments(mustache, helpers, found);
    }

    return;
  }

  if (statement.type === 'BlockStatement') {
    // The block's body is a new scope and is deliberately not descended into; its arguments are
    // evaluated in this one.
    fromArguments(statement as hbs.AST.BlockStatement, helpers, found);
  }
}

/**
 * The root-scope variable names a template requires, in the order they first appear.
 *
 * Order is stable so that a failure lists the same names in the same sequence on every run, which
 * keeps the message diffable when it is pasted into an issue.
 */
export function collectRequiredNames(program: hbs.AST.Program, helpers: ReadonlySet<string>): string[] {
  const found = new Set<string>();

  for (const statement of program.body) {
    fromStatement(statement, helpers, found);
  }

  return [...found];
}

/** The required names the variables do not define. */
export function findUndefinedReferences(
  program: hbs.AST.Program,
  variables: Readonly<Record<string, unknown>>,
  helpers: ReadonlySet<string>,
): string[] {
  return collectRequiredNames(program, helpers).filter((name) => !Object.hasOwn(variables, name));
}
