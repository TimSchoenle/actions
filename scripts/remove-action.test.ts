import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as removeAction from './remove-action';
import { Sys } from './lib/utils';
import { selectPackage, getSubActions } from './lib/action-utils';
import { confirm, search } from '@inquirer/prompts';

// Mock Dependencies
vi.mock('./lib/utils', async (importOriginal) => {
    const actual = await importOriginal<typeof import('./lib/utils')>();
    return {
        ...actual,
        Sys: {
            rm: vi.fn(),
            exists: vi.fn(),
            readdir: vi.fn(), // Needed for removePackage recursive check
        },
    };
});

vi.mock('./lib/action-utils', () => ({
    selectPackage: vi.fn(),
    getSubActions: vi.fn(),
    removeActionFromReleasePlease: vi.fn(),
    removeVerifyWorkflow: vi.fn(),
}));

vi.mock('./lib/renovate-config', () => ({
    RenovateConfigManager: {
        removePackageRule: vi.fn(),
    },
}));

vi.mock('@inquirer/prompts', () => ({
    confirm: vi.fn(),
    search: vi.fn(),
}));

describe('remove-action', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should remove sub-action and update configs', async () => {
        vi.mocked(selectPackage).mockResolvedValue('pkg');
        vi.mocked(getSubActions).mockResolvedValue(['sub1', 'sub2']);
        vi.mocked(search).mockResolvedValue('sub1');

        // Confirm remove action
        vi.mocked(confirm).mockResolvedValue(true);

        // After removal, check remaining
        vi.mocked(getSubActions).mockResolvedValueOnce(['sub1', 'sub2']) // Initial load
            .mockResolvedValueOnce(['sub2']); // Check after removal

        await removeAction.main();

        expect(Sys.rm).toHaveBeenCalledWith(
            expect.stringContaining('sub1'),
            { recursive: true, force: true }
        );
    });

    it('should remove package if last sub-action removed', async () => {
        vi.mocked(selectPackage).mockResolvedValue('pkg');
        vi.mocked(getSubActions).mockResolvedValueOnce(['sub1'])
            .mockResolvedValueOnce([]); // Remaining check -> empty

        vi.mocked(search).mockResolvedValue('sub1');
        vi.mocked(confirm).mockResolvedValue(true); // Confirm remove action
        // Mock prompt for package removal
        vi.mocked(confirm).mockResolvedValueOnce(true) // Remove action
            .mockResolvedValueOnce(true); // Remove package

        vi.mocked(Sys.exists).mockReturnValue(true);

        await removeAction.main();

        expect(Sys.rm).toHaveBeenCalledWith(
            expect.stringContaining('pkg'),
            { recursive: true, force: true }
        );
    });

    it('should handle package with no sub-actions', async () => {
        vi.mocked(selectPackage).mockResolvedValue('pkg');
        vi.mocked(getSubActions).mockResolvedValue([]);

        // Confirm remove package
        vi.mocked(confirm).mockResolvedValue(true);
        vi.mocked(Sys.exists).mockReturnValue(true);

        await removeAction.main();

        expect(Sys.rm).toHaveBeenCalledWith(
            expect.stringContaining('pkg'),
            { recursive: true, force: true }
        );
    });

    it('should cancel if user declines action removal', async () => {
        vi.mocked(selectPackage).mockResolvedValue('pkg');
        vi.mocked(getSubActions).mockResolvedValue(['sub1']);
        vi.mocked(search).mockResolvedValue('sub1');
        vi.mocked(confirm).mockResolvedValue(false); // Decline

        await removeAction.main();

        expect(Sys.rm).not.toHaveBeenCalled();
    });

    it('should not remove package root if user declines', async () => {
        vi.mocked(selectPackage).mockResolvedValue('pkg');
        vi.mocked(getSubActions).mockResolvedValueOnce(['sub1']).mockResolvedValueOnce([]); // Empty after removal
        vi.mocked(search).mockResolvedValue('sub1');
        vi.mocked(confirm).mockResolvedValueOnce(true) // Remove action
            .mockResolvedValueOnce(false); // Decline remove package

        await removeAction.main();

        expect(Sys.rm).toHaveBeenCalledTimes(1); // Only action removed
        expect(Sys.rm).not.toHaveBeenCalledWith(expect.stringMatching(/actions[/\\]pkg$/), expect.any(Object));
    });
});
