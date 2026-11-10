import fs from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { uploadEndpoint } from './github.js';
import { matchesGlob, parseGlobs } from './glob.js';
import { isSafeRefName, parseReleases } from './releases-input.js';

import type { Release } from './github.js';

describe('matchesGlob', () => {
  it.each([
    ['actions/**/dist/**', 'actions/common/x/dist/index.js', true],
    ['actions/**/dist/**', 'actions/common/x/helper/dist/index.js', true],
    ['actions/**/dist/**', 'actions/dist/index.js', true],
    ['actions/**/dist/**', 'actions/common/x/src/index.js', false],
    ['actions/**/dist/**', 'scripts/dist/index.js', false],
    ['dist/**', 'dist/index.js', true],
    ['dist/*.js', 'dist/index.js', true],
    ['dist/*.js', 'dist/sub/index.js', false],
    ['dist/*.js', 'dist/index.ts', false],
    ['**', 'anything/at/all', true],
    ['a/*-*/b', 'a/x-y/b', true],
    ['a/*-*/b', 'a/xy/b', false],
  ])('%s against %s is %s', (pattern, file, expected) => {
    expect(matchesGlob(pattern, file)).toBe(expected);
  });

  it('stays linear on a pathological pattern', () => {
    const pattern = Array.from({ length: 30 }, () => '**').join('/') + '/x';
    const file = Array.from({ length: 40 }, () => 'a').join('/');

    expect(matchesGlob(pattern, file)).toBe(false);
  });
});

describe('parseGlobs', () => {
  it('splits on whitespace', () => {
    expect(parseGlobs(' actions/**/dist/**\n dist/** ')).toEqual(['actions/**/dist/**', 'dist/**']);
  });

  it.each(['/abs/**', '../x/**', 'a/./b', 'a//b'])('rejects %s', (glob) => {
    expect(() => parseGlobs(glob)).toThrow(/must be a relative glob/);
  });
});

describe('isSafeRefName', () => {
  it.each(['actions-a-v1.0.0', 'v1.2.3', 'test/scope/123/case', 'src-x+build'])('accepts %s', (name) => {
    expect(isSafeRefName(name)).toBe(true);
  });

  it.each(['', '-x', 'a..b', 'a/', '/a', 'a.lock', 'a.', 'a b', 'a~1', 'a^', 'a:b', 'a\\b', 'a/.hidden'])(
    'rejects %j',
    (name) => {
      expect(isSafeRefName(name)).toBe(false);
    },
  );
});

describe('parseReleases', () => {
  // Created when the suite is collected, because the it.each tables below are built then.
  const directory = fs.mkdtempSync(path.join(tmpdir(), 'releases-input-'));
  const notes = path.join(directory, 'notes.md');
  fs.writeFileSync(notes, '* note\n');

  afterAll(() => {
    fs.rmSync(directory, { recursive: true, force: true });
  });

  function entry(change: Record<string, unknown> = {}) {
    return {
      consumerTag: 'actions-a-v1.0.0',
      sourceTag: 'src-actions-a-v1.0.0',
      releaseName: 'a: v1.0.0',
      notesFile: notes,
      ...change,
    };
  }

  it('reads the plan-release-please output, notes included', () => {
    const releases = parseReleases(
      JSON.stringify([entry({ path: 'actions/a', component: 'src-actions-a', version: '1.0.0' })]),
    );

    expect(releases).toEqual([
      {
        consumerTag: 'actions-a-v1.0.0',
        sourceTag: 'src-actions-a-v1.0.0',
        releaseName: 'a: v1.0.0',
        notes: '* note\n',
        path: 'actions/a',
      },
    ]);
  });

  it('accepts a release without a source tag or path', () => {
    expect(parseReleases(JSON.stringify([entry({ sourceTag: null })]))[0]).toMatchObject({
      sourceTag: undefined,
      path: undefined,
    });
  });

  it.each([
    ['not JSON', '[', /not valid JSON/],
    ['an empty list', '[]', /non-empty JSON array/],
    ['an object', '{}', /non-empty JSON array/],
    ['an unknown key', JSON.stringify([{ ...entry(), extra: 1 }]), /unknown keys: extra/],
    [
      'a bad consumer tag',
      JSON.stringify([entry({ consumerTag: 'a..b' })]),
      /'consumerTag' "a\.\.b" is not a valid tag name/,
    ],
    [
      'a source tag equal to the consumer tag',
      JSON.stringify([entry({ sourceTag: 'actions-a-v1.0.0' })]),
      /'sourceTag'/,
    ],
    ['a multi-line name', JSON.stringify([entry({ releaseName: 'a\nb' })]), /'releaseName' must be one line/],
    [
      'a relative notes file',
      JSON.stringify([entry({ notesFile: 'notes.md' })]),
      /'notesFile' must be an absolute path/,
    ],
    ['a missing notes file', JSON.stringify([entry({ notesFile: '/nonexistent/notes.md' })]), /does not exist/],
    ['a path with ..', JSON.stringify([entry({ path: '../x' })]), /'\.\.' segment/],
    [
      'a duplicate tag',
      JSON.stringify([entry(), entry({ consumerTag: 'actions-b-v1.0.0', sourceTag: 'src-actions-a-v1.0.0' })]),
      /names the tag src-actions-a-v1\.0\.0 twice/,
    ],
  ])('rejects %s', (_name, text, message) => {
    expect(() => parseReleases(text)).toThrow(message);
  });

  it('rejects a notes file that is a directory', () => {
    expect(() => parseReleases(JSON.stringify([entry({ notesFile: directory })]))).toThrow(/is not a regular file/);
  });
});

describe('uploadEndpoint', () => {
  const release = (uploadUrl: string): Release => ({
    id: 5,
    tagName: 't',
    draft: true,
    htmlUrl: '',
    uploadUrl,
    assets: [],
  });

  it('strips the URI template from a well-formed upload URL', () => {
    expect(
      uploadEndpoint(release('https://uploads.github.com/repos/o/r/releases/5/assets{?name,label}'), {
        owner: 'o',
        repo: 'r',
      }).toString(),
    ).toBe('https://uploads.github.com/repos/o/r/releases/5/assets');
  });

  it.each([
    'http://uploads.github.com/repos/o/r/releases/5/assets{?name,label}',
    'https://uploads.github.com/repos/o/other/releases/5/assets{?name,label}',
    'https://uploads.github.com/repos/o/r/releases/6/assets{?name,label}',
    'https://uploads.github.com/repos/o/r/releases/5/assets?x=1',
  ])('refuses %s', (url) => {
    expect(() => uploadEndpoint(release(url), { owner: 'o', repo: 'r' })).toThrow(/unexpected upload URL/);
  });
});
