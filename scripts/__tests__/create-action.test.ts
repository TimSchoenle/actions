import { describe, it, expect, vi, beforeEach } from 'vitest';
import path from 'node:path';
import * as createAction from '../create-action';
import { ACTIONS_DIR, ROOT_DIR, Sys, createFromTemplate } from '../lib/utils';
import { selectPackage, registerActionInReleasePlease, createVerifySource } from '../lib/action-utils';
import { input } from '@inquirer/prompts';
import { main as generateDocs } from '../generate-docs';
import { writeGenerated as generateVerify } from '../lib/verify/generate';
import { main as generateCodecovComponents } from '../generate-codecov-components';

// Mock dependencies
import type * as UtilsTypes from '../lib/utils';
vi.mock('../lib/utils', async () => {
  const actual = await vi.importActual<typeof UtilsTypes>('../lib/utils');
  return {
    ...actual,
    Sys: {
      mkdir: vi.fn(),
      exists: vi.fn(),
    },
    createFromTemplate: vi.fn(),
  };
});

vi.mock('../lib/action-utils', () => ({
  selectPackage: vi.fn(),
  registerActionInReleasePlease: vi.fn(),
  createVerifySource: vi.fn(),
  verifySourcePath: (pkg: string, sub: string) => `.github/verify/${pkg}-${sub}.yaml`,
}));

vi.mock('@inquirer/prompts', () => ({
  input: vi.fn(),
}));

vi.mock('../generate-docs', () => ({
  main: vi.fn(),
}));

vi.mock('../lib/verify/generate', () => ({
  writeGenerated: vi.fn(),
}));

vi.mock('../generate-codecov-components', () => ({
  main: vi.fn(),
}));

describe('create-action', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should create new action in existing package', async () => {
    // Setup Mocks
    vi.mocked(selectPackage).mockResolvedValue('existing-pkg');
    vi.mocked(input)
      .mockResolvedValueOnce('new-sub') // Sub-action
      .mockResolvedValueOnce('A description'); // Description

    vi.mocked(Sys.exists).mockReturnValue(false); // The action directory is new

    await createAction.main();

    // Verify Directory Creation
    expect(Sys.mkdir).toHaveBeenCalledWith(expect.stringContaining('existing-pkg'), { recursive: true });

    // Verify Template Creation
    expect(createFromTemplate).toHaveBeenCalledWith(
      'action/action.yaml',
      expect.stringContaining('action.yaml'),
      expect.objectContaining({ packageName: 'existing-pkg', subAction: 'new-sub' }),
    );

    // The README generator runs at the end and reads docs.yaml, so it must exist by then.
    expect(createFromTemplate).toHaveBeenCalledWith(
      'action/docs.yaml',
      path.join(ACTIONS_DIR, 'existing-pkg', 'new-sub', 'docs.yaml'),
      expect.objectContaining({ packageName: 'existing-pkg', subAction: 'new-sub' }),
    );
    const templateMock = vi.mocked(createFromTemplate).mock;
    const docsIndex = templateMock.calls.findIndex(([template]) => template === 'action/docs.yaml');
    expect(templateMock.invocationCallOrder[docsIndex]).toBeLessThan(
      vi.mocked(generateDocs).mock.invocationCallOrder[0],
    );

    // Verify Config Updates
    expect(createVerifySource).toHaveBeenCalledWith('existing-pkg', 'new-sub');
    expect(registerActionInReleasePlease).toHaveBeenCalledWith('existing-pkg', 'new-sub');
    expect(generateDocs).toHaveBeenCalled();
    expect(generateVerify).toHaveBeenCalled();
    expect(generateCodecovComponents).toHaveBeenCalled();
  });

  it('should create new action and package files if new package', async () => {
    vi.mocked(selectPackage).mockResolvedValue('new-pkg');
    vi.mocked(input).mockResolvedValueOnce('sub').mockResolvedValueOnce('desc');

    vi.mocked(Sys.exists).mockReturnValue(false); // Changelog missing

    await createAction.main();
  });

  it('refuses to scaffold over an existing action', async () => {
    vi.mocked(selectPackage).mockResolvedValue('existing-pkg');
    vi.mocked(input).mockResolvedValueOnce('existing-sub').mockResolvedValueOnce('desc');
    vi.mocked(Sys.exists).mockImplementation(
      (target) => target === path.join(ACTIONS_DIR, 'existing-pkg', 'existing-sub'),
    );

    await expect(createAction.main()).rejects.toThrow('already exists');

    expect(createFromTemplate).not.toHaveBeenCalled();
    expect(generateDocs).not.toHaveBeenCalled();
  });

  it('refuses to scaffold over an existing verify source, before writing anything', async () => {
    vi.mocked(selectPackage).mockResolvedValue('configs');
    vi.mocked(input).mockResolvedValueOnce('checkstyle').mockResolvedValueOnce('desc');
    vi.mocked(Sys.exists).mockImplementation(
      (target) => target === path.join(ROOT_DIR, '.github/verify/configs-checkstyle.yaml'),
    );

    await expect(createAction.main()).rejects.toThrow('configs-checkstyle.yaml already exists');

    expect(Sys.mkdir).not.toHaveBeenCalled();
    expect(createFromTemplate).not.toHaveBeenCalled();
    expect(createVerifySource).not.toHaveBeenCalled();
  });
});
