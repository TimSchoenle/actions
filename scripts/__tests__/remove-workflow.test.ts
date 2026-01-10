import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as removeWorkflow from '../remove-workflow';
import { Sys } from '../lib/utils';
import {
  selectPackage,
  getSubResources,
  removeResourceFromReleasePlease,
  removeVerifyWorkflow,
} from '../lib/resource-utils';
import { RenovateConfigManager } from '../lib/renovate-config';
import { confirm, search } from '@inquirer/prompts';
import { main as generateReadme } from '../generate-readme';

// Mock Dependencies
import type * as UtilsTypes from '../lib/utils';
vi.mock('../lib/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof UtilsTypes>();
  return {
    ...actual,
    Sys: {
      rm: vi.fn(),
      exists: vi.fn(),
      readdir: vi.fn(),
    },
    ACTIONS_DIR: 'E:\\actions\\actions',
    ROOT_DIR: 'E:\\actions',
  };
});

vi.mock('../lib/resource-utils', () => ({
  selectPackage: vi.fn(),
  getSubResources: vi.fn(),
  removeResourceFromReleasePlease: vi.fn(),
  removeVerifyWorkflow: vi.fn(),
}));

vi.mock('@inquirer/prompts', () => ({
  confirm: vi.fn(),
  search: vi.fn(),
}));

vi.mock('../generate-readme', () => ({
  main: vi.fn(),
}));

describe('remove-workflow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should remove workflow and update configs', async () => {
    vi.mocked(selectPackage).mockResolvedValue('pkg');
    vi.mocked(getSubResources).mockResolvedValue(['sub1', 'sub2']);
    vi.mocked(search).mockResolvedValue('sub1');
    vi.mocked(confirm).mockResolvedValue(true); // Confirm remove

    // Check availability after removal
    vi.mocked(getSubResources).mockResolvedValueOnce(['sub1', 'sub2']).mockResolvedValueOnce(['sub2']);

    await removeWorkflow.main();

    expect(Sys.rm).toHaveBeenCalledWith(expect.stringContaining('sub1'), { recursive: true, force: true });
    expect(removeResourceFromReleasePlease).toHaveBeenCalledWith('workflow', 'pkg', 'sub1');
    expect(removeVerifyWorkflow).toHaveBeenCalledWith('workflow', 'pkg', 'sub1');
    expect(generateReadme).toHaveBeenCalled();
  });

  it('should remove package if last workflow removed', async () => {
    vi.mocked(selectPackage).mockResolvedValue('pkg');
    vi.mocked(getSubResources).mockResolvedValueOnce(['sub1']).mockResolvedValueOnce([]); // Empty after

    vi.mocked(search).mockResolvedValue('sub1');
    vi.mocked(confirm)
      .mockResolvedValueOnce(true) // Remove workflow
      .mockResolvedValueOnce(true); // Remove package

    vi.mocked(Sys.exists).mockReturnValue(true);

    await removeWorkflow.main();

    expect(Sys.rm).toHaveBeenCalledWith(expect.stringContaining('pkg'), { recursive: true, force: true });
  });

  it('should handle package with no workflows', async () => {
    vi.mocked(selectPackage).mockResolvedValue('pkg');
    vi.mocked(getSubResources).mockResolvedValue([]);
    vi.mocked(confirm).mockResolvedValue(true);
    vi.mocked(Sys.exists).mockReturnValue(true);

    await removeWorkflow.main();

    expect(Sys.rm).toHaveBeenCalledWith(expect.stringContaining('pkg'), { recursive: true, force: true });
  });

  it('should cancel if user declines removals', async () => {
    vi.mocked(selectPackage).mockResolvedValue('pkg');
    vi.mocked(getSubResources).mockResolvedValue(['sub1']);
    vi.mocked(search).mockResolvedValue('sub1');
    vi.mocked(confirm).mockResolvedValue(false); // Decline

    await removeWorkflow.main();

    expect(Sys.rm).not.toHaveBeenCalled();
  });
});
