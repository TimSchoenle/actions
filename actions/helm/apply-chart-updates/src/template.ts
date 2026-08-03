/**
 * The value template: `${name}` substitution and nothing else.
 *
 * A general template engine would be a poor trade here. The grammar a Helm image reference needs is
 * `${tag}@${digest}` — occasionally `${registry}/${repository}:${tag}` — and every feature beyond
 * that (helpers, property paths, loops, partials) is surface an attacker can reach with a crafted
 * variable name. So: one placeholder form, a validated name, a hard error for anything undefined,
 * and no re-scanning of what was substituted.
 */
import type { VariableBag } from './inputs.js';

/** Raised when a template is malformed or references a variable no entry defines. */
export class TemplateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TemplateError';
  }
}

/**
 * A placeholder. The name is captured with a class that excludes both braces, so a nested `${a${b}}`
 * cannot be read as a well-formed placeholder — it leaves a stray `${` behind, which the
 * completeness check below rejects.
 */
const PLACEHOLDER = /\$\{([^{}]*)\}/g;

/** Mirrors `VARIABLE_NAME` in `inputs.ts`: a name that cannot be defined can never be referenced. */
const PLACEHOLDER_NAME = /^[a-z][a-z0-9_]*$/;

const MAX_TEMPLATE_LENGTH = 512;

/**
 * Renders `template` against `variables`.
 *
 * `context` names what is being rendered (the image key) so a missing variable points at the entry
 * that is short one, rather than at "the template". With per-image versions that distinction is the
 * whole error message: one service missing its `tag` must be a failure naming that service, never a
 * silent fallback to a neighbour's version.
 *
 * @throws {TemplateError} for a malformed template, an invalid placeholder name, or an undefined
 * variable.
 */
export function renderTemplate(template: string, variables: VariableBag, context: string): string {
  if (template.length === 0) {
    throw new TemplateError('value-template must not be empty');
  }

  if (template.length > MAX_TEMPLATE_LENGTH) {
    throw new TemplateError(`value-template must be at most ${MAX_TEMPLATE_LENGTH} characters, got ${template.length}`);
  }

  // A function replacer, not a replacement string: `$&`, `$1` and `$'` are special in the latter, so
  // a digest containing them would splice parts of the template back into its own output.
  const rendered = template.replace(PLACEHOLDER, (_match, name: string) => {
    if (!PLACEHOLDER_NAME.test(name)) {
      throw new TemplateError(`value-template has an invalid placeholder '\${${name}}'`);
    }

    const value = variables.get(name);

    if (value === undefined) {
      throw new TemplateError(`${context}: no value for '\${${name}}'`);
    }

    return value;
  });

  // Variable values cannot contain `$` or braces, so a surviving `${` can only come from the
  // template itself — an unterminated or nested placeholder that matched nothing.
  if (rendered.includes('${')) {
    throw new TemplateError(`value-template has an unterminated placeholder: '${template}'`);
  }

  return rendered;
}
