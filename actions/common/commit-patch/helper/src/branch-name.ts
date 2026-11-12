/**
 * Validates the branch a patch is committed to.
 *
 * The rules are those of `git check-ref-format --branch`, plus one: a name starting with `refs/` is
 * refused. Workflows guard the default branch by comparing the name with it, and a branch literally
 * named `refs/heads/main` passes that comparison while the API may resolve it to `main` itself.
 * Checking here, before anything is downloaded, keeps a name the API would read differently from
 * reaching the write.
 */

/** Printable characters git refuses anywhere in a ref name. */
const FORBIDDEN_PRINTABLE: ReadonlySet<string> = new Set(['~', '^', ':', '?', '*', '[', '\\']);

/** Whether git refuses `character` anywhere in a ref name: a control character, DEL, space or `~^:?*[\`. */
function isForbiddenCharacter(character: string): boolean {
  const code = character.codePointAt(0) ?? 0;

  return code <= 0x20 || code === 0x7f || FORBIDDEN_PRINTABLE.has(character);
}

/** Why `name` is not a branch name git accepts, or `undefined` when it is one. */
function refFormatViolation(name: string): string | undefined {
  if (name === '' || name === '@') {
    return 'it is empty or "@"';
  }
  if (name.startsWith('refs/')) {
    return 'it starts with refs/; give the branch name alone';
  }
  if (name.startsWith('-')) {
    return 'it starts with "-"';
  }
  if ([...name].some((character) => isForbiddenCharacter(character))) {
    return 'it contains a control character, a space or one of ~^:?*[\\';
  }
  if (name.includes('..') || name.includes('@{') || name.includes('//')) {
    return 'it contains "..", "@{" or "//"';
  }
  if (name.startsWith('/') || name.endsWith('/') || name.endsWith('.')) {
    return 'it starts or ends with "/", or ends with "."';
  }
  if (name.split('/').some((component) => component.startsWith('.') || component.endsWith('.lock'))) {
    return 'a component starts with "." or ends with ".lock"';
  }

  return undefined;
}

/**
 * @returns `name`, unchanged.
 * @throws if git would refuse `name` as a branch name, or it starts with `refs/`.
 */
export function validateBranchName(name: string): string {
  const violation = refFormatViolation(name);

  if (violation !== undefined) {
    throw new Error(`branch must be a branch name git accepts; ${JSON.stringify(name)} is not, because ${violation}.`);
  }

  return name;
}
