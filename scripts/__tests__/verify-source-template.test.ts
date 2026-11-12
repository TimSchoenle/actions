import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { VERIFY_SOURCE_TEMPLATE, verifySourcePath, verifySourceReplacements } from '../lib/action-utils.js';
import { replaceTemplateVariables, ROOT_DIR } from '../lib/utils.js';
import { resolvePins } from '../lib/verify/pins.js';
import { renderTarget, validateSources } from '../lib/verify/render.js';
import { parseSource } from '../lib/verify/source.js';

/**
 * Contract for the verify source `bun run create-action` writes.
 *
 * These tests render the real template the way `createVerifySource` does and run the result through
 * the same parser, validator and renderer the generator uses, so a template that the generator would
 * refuse fails here, before anyone creates an action with it.
 */

/** A template placeholder left unsubstituted. GitHub expressions (`${{ ... }}`) are not placeholders. */
const UNRESOLVED_PLACEHOLDER = /(?<!\$)\{\{\s*\w+\s*\}\}/;

function render(): string {
  const template = fs.readFileSync(path.join(ROOT_DIR, 'scripts', 'templates', VERIFY_SOURCE_TEMPLATE), 'utf8');

  return replaceTemplateVariables(template, verifySourceReplacements('example-pkg', 'example-sub'));
}

describe('verify source template', () => {
  const rendered = render();
  const source = parseSource(verifySourcePath('example-pkg', 'example-sub'), rendered);

  it('leaves no placeholder unsubstituted', () => {
    expect(rendered).not.toMatch(UNRESOLVED_PLACEHOLDER);
  });

  it('names the action it is written for, in the file the generator expects', () => {
    expect(source.target).toBe('example-pkg/example-sub');
    expect(verifySourcePath('example-pkg', 'example-sub')).toBe('.github/verify/example-pkg-example-sub.yaml');
  });

  it('reaches every remote action through a PINNED key, so Renovate keeps it current', () => {
    const uses = [...rendered.matchAll(/^\s*(?:-\s*)?uses:\s*(\S+)/gm)].map((match) => match[1]);

    expect(uses.filter((value) => !value.startsWith('./') && !/^pinned:\w+$/.test(value))).toEqual([]);
    expect(() => resolvePins(rendered)).not.toThrow();
  });

  it('keeps the contract the generator enforces, and renders', () => {
    expect(() => validateSources(ROOT_DIR, [source])).not.toThrow();
    expect(() => renderTarget(source)).not.toThrow();
  });

  it('blocks egress rather than auditing it', () => {
    expect(rendered).toContain('egress-policy: block');
  });
});
