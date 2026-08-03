import { describe, expect, it } from 'vitest';

import { renderTemplate, TemplateError } from './template.js';

const DIGEST = `sha256:${'b'.repeat(64)}`;

function bag(entries: Record<string, string>): ReadonlyMap<string, string> {
  return new Map(Object.entries(entries));
}

describe('renderTemplate', () => {
  it('renders the default image reference form', () => {
    expect(renderTemplate('${tag}@${digest}', bag({ tag: 'v1.2.3', digest: DIGEST }), 'ctx')).toBe(`v1.2.3@${DIGEST}`);
  });

  it('renders a registry-qualified reference', () => {
    const variables = bag({ registry: 'ghcr.io', repository: 'owner/app', tag: 'v1' });

    expect(renderTemplate('${registry}/${repository}:${tag}', variables, 'ctx')).toBe('ghcr.io/owner/app:v1');
  });

  it('substitutes the same placeholder more than once', () => {
    expect(renderTemplate('${tag}-${tag}', bag({ tag: 'v1' }), 'ctx')).toBe('v1-v1');
  });

  // Per-image versions make this the single most important error message in the action: a service
  // short a tag must be named, never quietly given a neighbour's.
  it('names the entry that is missing a variable', () => {
    expect(() =>
      renderTemplate('${tag}@${digest}', bag({ digest: DIGEST }), "images['services.api.image.tag']"),
    ).toThrow(/images\['services\.api\.image\.tag'\]: no value for '\$\{tag\}'/);
  });

  it.each([
    ['an unterminated placeholder', '${tag'],
    ['a nested placeholder', '${a${b}}'],
    ['an empty name', '${}'],
    ['an uppercase name', '${TAG}'],
    ['a property path', '${a.b}'],
    ['a prototype name', '${__proto__}'],
  ])('rejects %s', (_label, template) => {
    expect(() => renderTemplate(template, bag({ tag: 'v1', a: 'x', b: 'y' }), 'ctx')).toThrow(TemplateError);
  });

  it.each([
    ['empty', ''],
    ['over-long', `\${tag}${'x'.repeat(512)}`],
  ])('rejects an %s template', (_label, template) => {
    expect(() => renderTemplate(template, bag({ tag: 'v1' }), 'ctx')).toThrow(TemplateError);
  });

  // A replacement *string* would treat `$&` as "the whole match"; a function replacer does not.
  it('treats a substituted value as literal text', () => {
    expect(renderTemplate('${tag}', bag({ tag: 'a-b' }), 'ctx')).toBe('a-b');
  });

  it('leaves a lone dollar sign alone', () => {
    expect(renderTemplate('a$b-${tag}', bag({ tag: 'v1' }), 'ctx')).toBe('a$b-v1');
  });
});
