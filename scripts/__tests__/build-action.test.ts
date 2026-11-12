import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { bindModulePaths, buildAction, warnOnBunVersionDrift } from '../build-action';
import { Sys } from '../lib/utils';
import type * as UtilsTypes from '../lib/utils';

vi.mock('../lib/utils', async () => {
  const actual = await vi.importActual<typeof UtilsTypes>('../lib/utils');
  return { ...actual, Sys: { file: vi.fn(), write: vi.fn() } };
});

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

describe('buildAction', () => {
  const actionDir = '/repo/actions/group/name';
  const bundlePath = path.join(actionDir, 'dist/index.js');

  /** Stubs `bun build` to exit with `exitCode`, and the written bundle to read back as `bundle`. */
  function stubBuild(exitCode: number, bundle: string): ReturnType<typeof vi.fn> {
    const spawn = vi.fn().mockReturnValue({ exited: Promise.resolve(exitCode) });
    vi.stubGlobal('Bun', { spawn });
    vi.mocked(Sys.file).mockReturnValue({ text: () => Promise.resolve(bundle) } as unknown as ReturnType<
      typeof Sys.file
    >);

    return spawn;
  }

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  // The defines are what turn a dependency's `__dirname` into an identifier the bindings can resolve.
  it('builds with the module-path defines from the action directory', async () => {
    const spawn = stubBuild(0, 'x');

    await buildAction(actionDir);

    const [command, options] = spawn.mock.calls[0] as [string[], { cwd: string }];
    expect(options.cwd).toBe(actionDir);
    expect(command).toEqual(
      expect.arrayContaining(['--define', '__dirname=__bundleDirname', '__filename=__bundleFilename']),
    );
  });

  // Without the define, a dependency's `process.env.NODE_ENV` check is inlined from the environment of
  // the build job. Both release builds share that environment, so the byte comparison between them
  // cannot see it, and a bundle built with NODE_ENV=development would ship as such.
  it('fixes process.env.NODE_ENV to production, whatever the build job sets', async () => {
    const spawn = stubBuild(0, 'x');

    await buildAction(actionDir);

    const [command] = spawn.mock.calls[0] as [string[]];
    const index = command.indexOf('process.env.NODE_ENV="production"');
    expect(index).toBeGreaterThan(0);
    expect(command[index - 1]).toBe('--define');
  });

  it('rewrites the bundle with the bindings it references', async () => {
    stubBuild(0, 'f(__bundleDirname);');

    await buildAction(actionDir);

    expect(Sys.file).toHaveBeenCalledWith(bundlePath);
    expect(Sys.write).toHaveBeenCalledWith(
      bundlePath,
      'const __bundleDirname=import.meta.dirname;\nf(__bundleDirname);',
    );
  });

  // Leaving an unaffected bundle untouched keeps its bytes, and its file, exactly as `bun build` wrote them.
  it('does not rewrite a bundle that references no binding', async () => {
    stubBuild(0, 'f(x);');

    await buildAction(actionDir);

    expect(Sys.write).not.toHaveBeenCalled();
  });

  it('fails without reading the bundle when the build fails', async () => {
    stubBuild(1, '');

    await expect(buildAction(actionDir)).rejects.toThrow("'bun build' failed with exit code 1");
    expect(Sys.file).not.toHaveBeenCalled();
  });
});
