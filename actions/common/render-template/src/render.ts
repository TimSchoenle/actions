import Handlebars from 'handlebars';

import { TemplateCompileError, TemplateRenderError, UndefinedReferenceError } from './errors.js';
import { HELPERS, registerHelpers } from './helpers.js';
import { findUndefinedReferences } from './strict-references.js';

import type { HandlebarsEnvironment } from './helpers.js';
import type { PartialTemplate } from './partials.js';
import type { TemplateMap } from './variables.js';

/** Everything one render needs. Nothing here is read from disk or from the environment. */
export interface RenderRequest {
  /** Path of the template, used only to attribute failures. */
  templatePath: string;
  templateSource: string;
  variables: TemplateMap;
  partials: readonly PartialTemplate[];
  /** Fail on a reference the variables do not define, rather than rendering it as an empty string. */
  strict: boolean;
  /** HTML-escape interpolated values. Off for Markdown and config output. */
  escapeHtml: boolean;
}

/**
 * Denies a template every route to `Object.prototype`.
 *
 * Handlebars has had this access control since 4.6 precisely because `{{ constructor.constructor }}`
 * is otherwise a path from a template to arbitrary code. The defaults already deny it; they are
 * restated because a default that is load-bearing should be visible at the place that depends on it,
 * and because an upgrade that relaxed one would otherwise change this action's behaviour silently.
 */
const RUNTIME_OPTIONS: Readonly<Handlebars.RuntimeOptions> = Object.freeze({
  allowProtoPropertiesByDefault: false,
  allowProtoMethodsByDefault: false,
  allowedProtoProperties: {},
  allowedProtoMethods: {},
});

/**
 * Compiler settings shared by the template and every partial.
 *
 * `compat` stays off: a lookup that misses in the current scope must not silently resolve against a
 * parent one, or a renamed variable keeps rendering the wrong value from an enclosing block.
 *
 * `preventIndent` is on. By default Handlebars re-indents a partial's every line to match the column
 * its `{{> }}` call sits at, which is right for HTML and wrong for Markdown, where four leading
 * spaces turn a table into a code block.
 */
function compileOptions(request: RenderRequest): CompileOptions {
  return {
    compat: false,
    noEscape: !request.escapeHtml,
    preventIndent: true,
    strict: request.strict,
  };
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Compiles one source eagerly, attributing a syntax error to the file it is actually in.
 *
 * `compile` alone is lazy: it returns a delegate that parses on first invocation, so a malformed
 * partial surfaces during the *template's* render and is reported against the template's path. The
 * caller then goes looking for a `{{#each` with no closing tag in a file that does not contain one.
 * Parsing here first moves the failure to the file that caused it, and handing `compile` the
 * resulting AST — which it accepts in place of a source string — keeps it to a single parse.
 */
function parseSource(
  environment: HandlebarsEnvironment,
  source: string,
  sourcePath: string,
  options: CompileOptions,
): hbs.AST.Program {
  try {
    return environment.parse(source, options);
  } catch (error) {
    throw new TemplateCompileError(sourcePath, reason(error), error);
  }
}

function compileSource(
  environment: HandlebarsEnvironment,
  source: string,
  sourcePath: string,
  options: CompileOptions,
): HandlebarsTemplateDelegate {
  return compileParsed(environment, parseSource(environment, source, sourcePath, options), sourcePath, options);
}

function compileParsed(
  environment: HandlebarsEnvironment,
  program: hbs.AST.Program,
  sourcePath: string,
  options: CompileOptions,
): HandlebarsTemplateDelegate {
  try {
    return environment.compile(program, options);
  } catch (error) {
    throw new TemplateCompileError(sourcePath, reason(error), error);
  }
}

/** The helper names a variable reference is allowed to collide with without being reported. */
const HELPER_NAMES: ReadonlySet<string> = new Set(Object.keys(HELPERS));

/**
 * Builds an environment holding only this render's helpers and partials.
 *
 * `Handlebars.create` rather than the shared singleton: registration on the singleton is global and
 * permanent, so two renders in one process — every test file, and any future action that renders
 * twice — would see each other's partials. An isolated environment makes a render a function of its
 * request and nothing else.
 */
function prepareEnvironment(request: RenderRequest): HandlebarsEnvironment {
  const environment = Handlebars.create();
  registerHelpers(environment);

  const options = compileOptions(request);
  for (const partial of request.partials) {
    environment.registerPartial(partial.name, compileSource(environment, partial.source, partial.path, options));
  }

  return environment;
}

/**
 * Renders a template against its variables.
 *
 * Pure with respect to the request: the same request always produces the same string, which is what
 * lets the caller compare the result against the committed file and treat a difference as real drift
 * rather than as engine noise. Everything that could break that — locale-dependent ordering, clocks,
 * randomness, ambient partial registrations — is excluded by the helper set and by the isolated
 * environment above.
 *
 * @throws {TemplateCompileError} if the template or one of the partials is not valid Handlebars.
 * @throws {UndefinedReferenceError} if `strict` is set and the template reads root-scope names the
 * variables do not define. Checked ahead of rendering because Handlebars' own strict mode covers
 * only bare interpolations; see `strict-references.ts`.
 * @throws {TemplateRenderError} if rendering fails, which under `strict` includes a bare `{{ name }}`
 * whose leaf segment is undefined.
 */
export function renderTemplate(request: RenderRequest): string {
  const environment = prepareEnvironment(request);
  const options = compileOptions(request);
  const program = parseSource(environment, request.templateSource, request.templatePath, options);

  if (request.strict) {
    const undefinedNames = findUndefinedReferences(program, request.variables, HELPER_NAMES);
    if (undefinedNames.length > 0) {
      throw new UndefinedReferenceError(request.templatePath, undefinedNames);
    }
  }

  const template = compileParsed(environment, program, request.templatePath, options);

  try {
    return template(request.variables, RUNTIME_OPTIONS);
  } catch (error) {
    throw new TemplateRenderError(request.templatePath, reason(error), error);
  }
}
