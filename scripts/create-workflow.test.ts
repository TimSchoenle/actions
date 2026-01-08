import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as createWorkflow from './create-workflow';
import { Sys, createFromTemplate } from './lib/utils';
import { selectPackage, registerResourceInReleasePlease, createVerifyWorkflow } from './lib/resource-utils';
import { RenovateConfigManager } from './lib/renovate-config';
import { getRepoInfo } from './lib/readme/git-utils';
import { input } from '@inquirer/prompts';
import { main as generateReadme } from './generate-readme';

// Mock dependencies
import type * as UtilsTypes from './lib/utils';
vi.mock('./lib/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof UtilsTypes>();
  return {
    ...actual,
    Sys: {
      mkdir: vi.fn(),
      exists: vi.fn(),
    },
    createFromTemplate: vi.fn(),
  };
});

vi.mock('./lib/resource-utils', () => ({
  selectPackage: vi.fn(),
  registerResourceInReleasePlease: vi.fn(),
  createVerifyWorkflow: vi.fn(),
}));

vi.mock('./lib/readme/git-utils', () => ({
  getRepoInfo: vi.fn(),
}));

vi.mock('@inquirer/prompts', () => ({
  input: vi.fn(),
}));

vi.mock('./generate-readme', () => ({
  main: vi.fn(),
}));

describe('create-workflow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getRepoInfo).mockResolvedValue('owner/repo');
  });

  it('should create new workflow in existing package', async () => {
    // Setup Mocks
    vi.mocked(selectPackage).mockResolvedValue('existing-pkg');
    vi.mocked(input).mockResolvedValueOnce('new-sub').mockResolvedValueOnce('A description');

    vi.mocked(Sys.exists).mockReturnValue(true); // Changelog and README exist? say true first

    await createWorkflow.main();

    // Verify Directory Creation
    expect(Sys.mkdir).toHaveBeenCalledWith(expect.stringContaining('existing-pkg'), { recursive: true });

    // Verify Template Creation
    expect(createFromTemplate).toHaveBeenCalledWith(
      'workflow/workflow.yaml',
      expect.stringContaining('workflow.yaml'),
      expect.objectContaining({ packageName: 'existing-pkg', subAction: 'new-sub' }),
    );

    // Verify Config Updates
    expect(createVerifyWorkflow).toHaveBeenCalledWith('workflow', 'existing-pkg', 'new-sub');
    expect(registerResourceInReleasePlease).toHaveBeenCalledWith('workflow', 'existing-pkg', 'new-sub');
    expect(generateReadme).toHaveBeenCalled();
  });

  it('should create new workflow and README if missing', async () => {
    vi.mocked(selectPackage).mockResolvedValue('new-pkg');
    vi.mocked(input).mockResolvedValueOnce('sub').mockResolvedValueOnce('desc');

    vi.mocked(Sys.exists).mockReturnValue(false); // Changelog/README missing

    await createWorkflow.main();

    // Verify Changelog creation
    expect(createFromTemplate).toHaveBeenCalledWith(
      'common/CHANGELOG.md',
      expect.stringContaining('CHANGELOG.md'),
      expect.any(Object),
    );

    // Verify README creation (WORKFLOW SPECIFIC)
    expect(createFromTemplate).toHaveBeenCalledWith(
      'workflow/README.md',
      expect.stringContaining('README.md'),
      expect.objectContaining({ repo: 'owner/repo' }),
    );
  });
});
