import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DocumentationItem } from '../lib/readme/types.js';

// Setup mocks using vi.hoisted to ensure they're available in module scope
const mocks = vi.hoisted(() => ({
  actionParse: vi.fn(),
  workflowParse: vi.fn(),
  renovateParse: vi.fn(),
  generateSection: vi.fn(),
  getRepoInfo: vi.fn(),
  sysFile: vi.fn(),
  sysWrite: vi.fn(),
  sysExec: vi.fn(),
  sysGlob: vi.fn(),
}));

// Mock all dependencies
vi.mock('../lib/utils.js', () => ({
  Sys: {
    file: mocks.sysFile,
    write: mocks.sysWrite,
    exec: mocks.sysExec,
    glob: mocks.sysGlob,
  },
  ROOT_DIR: 'E:\\actions',
}));

vi.mock('../lib/readme/parsers/action-parser.js', () => ({
  ActionParser: class {
    async parse() {
      return mocks.actionParse();
    }
  },
}));

vi.mock('../lib/readme/parsers/workflow-parser.js', () => ({
  WorkflowParser: class {
    async parse() {
      return mocks.workflowParse();
    }
  },
}));

vi.mock('../lib/readme/parsers/renovate-parser.js', () => ({
  RenovateParser: class {
    async parse() {
      return mocks.renovateParse();
    }
  },
}));

vi.mock('../lib/readme/generator.js', () => ({
  generateSection: mocks.generateSection,
}));

vi.mock('../lib/readme/git-utils.js', () => ({
  getRepoInfo: mocks.getRepoInfo,
}));

describe('Generate Readme Script', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Setup default mock behaviors
    mocks.actionParse.mockResolvedValue([]);
    mocks.workflowParse.mockResolvedValue([]);
    mocks.renovateParse.mockResolvedValue([]);
    mocks.generateSection.mockResolvedValue('');
    mocks.getRepoInfo.mockResolvedValue('owner/repo');

    // Mock process.exit to prevent actual exit
    vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('should parse actions and generate sections', async () => {
    const mockActions: DocumentationItem[] = [
      {
        name: 'Test Action',
        description: 'Test Description',
        version: 'test-v1.0.0',
        usage: 'uses: owner/repo/test@test-v1.0.0',
        category: 'Test',
        path: 'actions/test',
      },
    ];

    const mockWorkflows: DocumentationItem[] = [
      {
        name: 'Test Workflow',
        description: 'Test Workflow Desc',
        version: 'workflow-v1.0.0',
        usage: 'uses: owner/repo/workflow@workflow-v1.0.0',
        category: 'Workflow',
        path: 'workflows/test',
      },
    ];

    const mockConfigs: DocumentationItem[] = [
      {
        name: 'base',
        description: 'Base Config',
        usage: '"extends": ["github>owner/repo//configs/renovate/base"]',
        category: 'Renovate',
        path: 'configs/renovate/base.json',
      },
    ];

    mocks.actionParse.mockResolvedValue(mockActions);
    mocks.workflowParse.mockResolvedValue(mockWorkflows);
    mocks.renovateParse.mockResolvedValue(mockConfigs);
    mocks.generateSection
      .mockResolvedValueOnce('### Test Action Table')
      .mockResolvedValueOnce('### Test Workflow Table')
      .mockResolvedValueOnce('### Test Config Table');

    mocks.sysFile.mockReturnValue({
      exists: async () => true,
      text: async () =>
        'Template\n{{REPO}}\n<!-- ACTIONS_TABLE -->\n<!-- WORKFLOWS_TABLE -->\n<!-- CONFIGS_TABLE -->\nEnd',
    });

    const { main } = await import('../generate-docs.js');
    await main();

    // Verify parsers were called
    expect(mocks.actionParse).toHaveBeenCalledTimes(1);
    expect(mocks.workflowParse).toHaveBeenCalledTimes(1);
    expect(mocks.renovateParse).toHaveBeenCalledTimes(1);

    // Verify generateSection was called with correct arguments
    expect(mocks.generateSection).toHaveBeenCalledTimes(5);

    // Actions (README)
    expect(mocks.generateSection).toHaveBeenNthCalledWith(
      1,
      mockActions,
      ['Action', 'Description', 'Version', 'Usage'],
      expect.any(Function),
    );

    // Workflows (README)
    expect(mocks.generateSection).toHaveBeenNthCalledWith(
      2,
      mockWorkflows,
      ['Workflow', 'Description', 'Version', 'Usage'],
      expect.any(Function),
    );

    // Configs (README)
    expect(mocks.generateSection).toHaveBeenNthCalledWith(
      3,
      mockConfigs,
      ['Config', 'Description', 'Usage'],
      expect.any(Function),
    );

    // Actions (SECURITY)
    expect(mocks.generateSection).toHaveBeenNthCalledWith(
      4,
      mockActions,
      ['Component', 'Version', 'Supported'],
      expect.any(Function),
    );

    // Workflows (SECURITY)
    expect(mocks.generateSection).toHaveBeenNthCalledWith(
      5,
      mockWorkflows,
      ['Component', 'Version', 'Supported'],
      expect.any(Function),
    );

    // Verify getRepoInfo was called
    expect(mocks.getRepoInfo).toHaveBeenCalledTimes(1);

    // Verify file operations
    expect(mocks.sysFile).toHaveBeenCalled();
    expect(mocks.sysWrite).toHaveBeenCalledTimes(2);

    // Verify the content written
    const writtenContent = mocks.sysWrite.mock.calls[0][1] as string;
    expect(writtenContent).toContain('owner/repo'); // {{REPO}} replaced
    expect(writtenContent).not.toContain('{{REPO}}');
    expect(writtenContent).toContain('Test Action Table');
    expect(writtenContent).toContain('Test Workflow Table');
    expect(writtenContent).toContain('Test Config Table');
  });

  it('should handle template not found', async () => {
    // Mock process.exit to throw so we can catch it
    const exitError = new Error('Process exit called');
    vi.spyOn(process, 'exit').mockImplementation(((code: number) => {
      throw exitError;
    }) as any);

    mocks.sysFile.mockReturnValue({
      exists: async () => false,
    });

    const { main } = await import('../generate-docs.js');

    // Expect the function to throw due to process.exit
    await expect(main()).rejects.toThrow('Process exit called');

    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Template not found'));
  });

  it('should replace {{REPO}} placeholder with actual repo name', async () => {
    mocks.getRepoInfo.mockResolvedValue('test-owner/test-repo');
    mocks.sysFile.mockReturnValue({
      exists: async () => true,
      text: async () => 'Repo: {{REPO}}\n<!-- ACTIONS_TABLE -->\n<!-- CONFIGS_TABLE -->',
    });

    const { main } = await import('../generate-docs.js');
    await main();

    const writtenContent = mocks.sysWrite.mock.calls[0][1] as string;
    expect(writtenContent).toContain('test-owner/test-repo');
    expect(writtenContent).not.toContain('{{REPO}}');
  });

  it('should handle empty actions and configs', async () => {
    mocks.actionParse.mockResolvedValue([]);
    mocks.renovateParse.mockResolvedValue([]);
    mocks.generateSection.mockResolvedValue('');

    mocks.sysFile.mockReturnValue({
      exists: async () => true,
      text: async () => '<!-- ACTIONS_TABLE -->\n<!-- WORKFLOWS_TABLE -->\n<!-- CONFIGS_TABLE -->',
    });

    const { main } = await import('../generate-docs.js');
    await main();

    expect(mocks.sysWrite).toHaveBeenCalledTimes(2);
    const writtenContent = mocks.sysWrite.mock.calls[0][1] as string;
    expect(writtenContent).not.toContain('<!-- ACTIONS_TABLE -->');
    expect(writtenContent).not.toContain('<!-- WORKFLOWS_TABLE -->');
    expect(writtenContent).not.toContain('<!-- CONFIGS_TABLE -->');
  });
});
