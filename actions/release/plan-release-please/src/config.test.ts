import { describe, expect, it } from 'vitest';

import { parseManifest, parseReleaseConfig, ReleaseConfigError, releasePleaseTag } from './config.js';

describe('parseReleaseConfig', () => {
  it('applies release-please defaults and top-level overrides, sorted by path', () => {
    const config = JSON.stringify({
      'tag-separator': '@',
      packages: {
        'actions/b': { component: 'src-actions-b', 'include-v-in-tag': false },
        'actions/a': { component: 'src-actions-a', 'changelog-path': 'docs/CHANGES.md', 'tag-separator': '-' },
        '.': { 'include-component-in-tag': false },
      },
    });

    expect(parseReleaseConfig(config, 'c.json')).toEqual([
      { path: '.', component: undefined, tagSeparator: '@', includeV: true, changelogPath: 'CHANGELOG.md' },
      {
        path: 'actions/a',
        component: 'src-actions-a',
        tagSeparator: '-',
        includeV: true,
        changelogPath: 'actions/a/docs/CHANGES.md',
      },
      {
        path: 'actions/b',
        component: 'src-actions-b',
        tagSeparator: '@',
        includeV: false,
        changelogPath: 'actions/b/CHANGELOG.md',
      },
    ]);
  });

  it.each([
    ['not JSON', '{', /not valid JSON/],
    ['no packages', '{}', /'packages' must be a non-empty object/],
    ['a package without a component', '{"packages":{"a":{}}}', /sets no 'component'/],
    ['a wrong type', '{"packages":{"a":{"component":"x","include-v-in-tag":"yes"}}}', /must be true or false/],
    [
      'a wrong top-level type',
      '{"tag-separator":1,"packages":{"a":{"component":"x","tag-separator":"-"}}}',
      /'tag-separator' must be a string/,
    ],
    ['an escaping path', '{"packages":{"../a":{"component":"x"}}}', /'\.\.' segment/],
    ['a package that is not an object', '{"packages":{"a":true}}', /must be an object/],
  ])('rejects %s', (_name, text, message) => {
    expect(() => parseReleaseConfig(text, 'c.json')).toThrow(ReleaseConfigError);
    expect(() => parseReleaseConfig(text, 'c.json')).toThrow(message);
  });
});

describe('parseManifest', () => {
  it('maps paths to versions', () => {
    expect([...parseManifest('{"actions/a":"1.2.3","./b/":"2.0.0-rc.1"}', 'm.json')]).toEqual([
      ['actions/a', '1.2.3'],
      ['b', '2.0.0-rc.1'],
    ]);
  });

  it.each(['{"a":1}', '{"a":"1.2"}', '{"a":"v1.2.3"}'])('rejects %s', (text) => {
    expect(() => parseManifest(text, 'm.json')).toThrow(/must map to a version/);
  });
});

describe('releasePleaseTag', () => {
  const base = { path: 'a', tagSeparator: '-', includeV: true, changelogPath: 'a/CHANGELOG.md' };

  it.each([
    [{ ...base, component: 'src-actions-a' }, 'src-actions-a-v1.2.3'],
    [{ ...base, component: 'src', tagSeparator: '/' }, 'src/v1.2.3'],
    [{ ...base, component: undefined }, 'v1.2.3'],
    [{ ...base, component: 'x', includeV: false }, 'x-1.2.3'],
  ])('renders %j as %s', (settings, tag) => {
    expect(releasePleaseTag(settings, '1.2.3')).toBe(tag);
  });
});
