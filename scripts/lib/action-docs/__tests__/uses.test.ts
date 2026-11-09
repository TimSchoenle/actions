import { describe, expect, it } from 'vitest';

import { pinUses, referencedAction, referencedActions } from '../uses.js';

const REPO = 'Owner/actions';

describe('referencedAction', () => {
  it.each([
    ['./actions/common/x', 'actions/common/x'],
    ['./actions/common/x/', 'actions/common/x'],
    ['Owner/actions/actions/common/x@0123abc', 'actions/common/x'],
    // GitHub resolves the owner case-insensitively.
    ['owner/ACTIONS/actions/common/x@v1', 'actions/common/x'],
    ['./actions/common/x/helper', 'actions/common/x/helper'],
  ])('resolves %s', (reference, expected) => {
    expect(referencedAction(reference, REPO)).toBe(expected);
  });

  it.each([
    'actions/checkout@v4',
    'Other/actions/actions/common/x@v1',
    './scripts/thing',
    'docker://alpine:3',
    'Owner/actions-extra/actions/common/x@v1',
  ])('ignores %s', (reference) => {
    expect(referencedAction(reference, REPO)).toBeUndefined();
  });
});

describe('uses-line parsing', () => {
  it('needs whitespace after the colon, as YAML does', () => {
    expect([...referencedActions('- uses:./actions/common/a\n', REPO)]).toEqual([]);
    expect([...referencedActions('- uses:\t./actions/common/a\n', REPO)]).toEqual(['actions/common/a']);
  });
});

describe('referencedActions', () => {
  it('finds step and key forms, quoted or not, with trailing comments', () => {
    const content = [
      'steps:',
      '  - uses: ./actions/common/a',
      "  - uses: 'Owner/actions/actions/common/b@abc' # tag=v1",
      '  - name: c',
      '    uses: "./actions/common/c"',
      '  - uses: actions/checkout@v4',
      '  # uses: ./actions/common/commented-out',
    ].join('\n');
    expect([...referencedActions(content, REPO)].sort()).toEqual([
      'actions/common/a',
      'actions/common/b',
      'actions/common/c',
    ]);
  });
});

describe('pinUses', () => {
  it('rewrites only lines calling the action and keeps their indentation', () => {
    const content = [
      '      - uses: actions/checkout@v4',
      '      - uses: Owner/actions/actions/security/zizmor@main',
      '        with:',
      '          upload: false',
      '      - uses: Owner/actions/actions/security/zizmor-other@main',
    ].join('\n');

    expect(
      pinUses(content, REPO, 'actions/security/zizmor', 'Owner/actions/actions/security/zizmor@abc # tag=t'),
    ).toEqual({
      content: [
        '      - uses: actions/checkout@v4',
        '      - uses: Owner/actions/actions/security/zizmor@abc # tag=t',
        '        with:',
        '          upload: false',
        '      - uses: Owner/actions/actions/security/zizmor-other@main',
      ].join('\n'),
      replaced: 1,
    });
  });

  it('reports zero when the example never calls the action', () => {
    expect(pinUses('- uses: actions/checkout@v4', REPO, 'actions/x/y', 'pinned').replaced).toBe(0);
  });
});
