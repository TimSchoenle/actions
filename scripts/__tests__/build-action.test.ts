import { afterEach, describe, expect, it, vi } from 'vitest';

import { bindModulePaths, warnOnBunVersionDrift } from '../build-action';

describe('warnOnBunVersionDrift', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // The bundle is only guaranteed to reproduce the committed bytes when built with the pinned Bun,
  // so a mismatch is surfaced — naming both versions — rather than silently trusted.
  it('warns when the running Bun differs from the pinned one', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    expect(warnOnBunVersionDrift('1.3.11', '1.3.14')).toBe(true);
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0][0]).toContain('1.3.11');
    expect(warn.mock.calls[0][0]).toContain('1.3.14');
  });

  it('stays silent when the running Bun matches the pinned one', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    expect(warnOnBunVersionDrift('1.3.14', '1.3.14')).toBe(false);
    expect(warn).not.toHaveBeenCalled();
  });

  // A repository that pins no version cannot have a mismatch, so nothing is reported.
  it('stays silent when no version is pinned', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    expect(warnOnBunVersionDrift('1.3.14', undefined)).toBe(false);
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('bindModulePaths', () => {
  // A bundle that never reads `__dirname` / `__filename` must keep its exact bytes, so actions whose
  // dependencies do not use them are not rebuilt (and released) for no change.
  it('leaves a bundle that references no binding unchanged', () => {
    const bundle = 'import{x}from"y";console.log(x);';

    expect(bindModulePaths(bundle)).toBe(bundle);
  });

  it('binds only the referenced identifier, resolved from import.meta at runtime', () => {
    expect(bindModulePaths('f(__bundleDirname);')).toBe(
      'const __bundleDirname=import.meta.dirname;\nf(__bundleDirname);',
    );
    expect(bindModulePaths('f(__bundleFilename);')).toBe(
      'const __bundleFilename=import.meta.filename;\nf(__bundleFilename);',
    );
  });

  it('binds both identifiers in one declaration when both are referenced', () => {
    expect(bindModulePaths('f(__bundleDirname,__bundleFilename);')).toBe(
      'const __bundleDirname=import.meta.dirname,__bundleFilename=import.meta.filename;\n' +
        'f(__bundleDirname,__bundleFilename);',
    );
  });

  // Matching is on whole identifiers, so a longer name sharing the prefix does not trigger a binding.
  it('ignores identifiers that merely contain a binding name', () => {
    const bundle = 'f(__bundleDirnameX,x__bundleFilename);';

    expect(bindModulePaths(bundle)).toBe(bundle);
  });
});
