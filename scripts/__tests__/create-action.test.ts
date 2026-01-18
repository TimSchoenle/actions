import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as createAction from '../create-action';
import { Sys, createFromTemplate } from '../lib/utils';
import { selectPackage, registerActionInReleasePlease, createVerifyWorkflow } from '../lib/action-utils';
import { input } from '@inquirer/prompts';
import { main as generateDocs } from '../generate-docs';

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
  createVerifyWorkflow: vi.fn(),
}));

vi.mock('@inquirer/prompts', () => ({
  input: vi.fn(),
}));

vi.mock('../generate-docs', () => ({
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

    vi.mocked(Sys.exists).mockReturnValue(true); // Changelog exists

    await createAction.main();

    // Verify Directory Creation
    expect(Sys.mkdir).toHaveBeenCalledWith(expect.stringContaining('existing-pkg'), { recursive: true });

    // Verify Template Creation
    expect(createFromTemplate).toHaveBeenCalledWith(
      'action/action.yaml',
      expect.stringContaining('action.yaml'),
      expect.objectContaining({ packageName: 'existing-pkg', subAction: 'new-sub' }),
    );

    // Verify Config Updates
    expect(createVerifyWorkflow).toHaveBeenCalledWith('existing-pkg', 'new-sub');
    expect(registerActionInReleasePlease).toHaveBeenCalledWith('existing-pkg', 'new-sub');
    expect(generateDocs).toHaveBeenCalled();
  });

  it('should create new action and package files if new package', async () => {
    vi.mocked(selectPackage).mockResolvedValue('new-pkg');
    vi.mocked(input).mockResolvedValueOnce('sub').mockResolvedValueOnce('desc');

    vi.mocked(Sys.exists).mockReturnValue(false); // Changelog missing

    await createAction.main();
  });
});
