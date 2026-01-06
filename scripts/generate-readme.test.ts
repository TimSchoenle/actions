import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as generateReadme from './generate-readme';
import { Sys } from './lib/utils';
import path from 'node:path';

// Mock utils
vi.mock('./lib/utils', async (importOriginal) => {
    const actual = await importOriginal<typeof import('./lib/utils')>();
    return {
        ...actual,
        Sys: {
            exec: vi.fn(),
            glob: vi.fn(),
            file: vi.fn(),
            exists: vi.fn(),
            write: vi.fn(),
        },
    };
});

describe('generate-readme', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should generate README with found actions', async () => {
        // Mock Git Repo Info
        vi.mocked(Sys.exec).mockImplementation(async (cmd) => {
            if (cmd.includes('remote.origin.url')) return 'git@github.com:user/repo.git';
            if (cmd.includes('git log')) return 'abcdef1';
            return '';
        });

        // Mock Manifest
        vi.mocked(Sys.exists).mockResolvedValue(true);
        vi.mocked(Sys.file).mockImplementation((p) => {
            if (p.endsWith('.release-please-manifest.json')) {
                return {
                    json: async () => ({ "actions/pkg/sub": "1.2.3" }),
                    exists: async () => true
                } as any;
            }
            if (p.endsWith('release-please-config.json')) {
                return {
                    json: async () => ({
                        packages: { 'actions/pkg/sub': { component: 'actions-pkg-sub' } }
                    }),
                    exists: async () => true
                } as any;
            }
            if (p.endsWith('README.md')) { // Template
                return { text: async () => 'Header\n<!-- ACTIONS_TABLE -->\nFooter', exists: async () => true } as any;
            }
            // Action file
            if (p.endsWith('action.yml')) {
                return {
                    text: async () => 'name: My Action\ndescription: A test action',
                    exists: async () => true
                } as any;
            }
            return { text: async () => '', exists: async () => false } as any;
        });

        // Mock Glob
        const mockScan = {
            scan: async function* () {
                yield 'actions/pkg/sub/action.yml';
            }
        };
        vi.mocked(Sys.glob).mockReturnValue(mockScan as any);

        await generateReadme.main();

        expect(Sys.write).toHaveBeenCalledWith(
            expect.stringMatching(/README\.md$/),
            expect.stringContaining('| [My Action](./actions/pkg/sub) | A test action | actions-pkg-sub-v1.2.3 | `uses: user/repo/actions/pkg/sub@actions-pkg-sub-v1.2.3` |')
        );
    });

    it('should skip actions with no version', async () => {
        // Mock Git Repo Info
        vi.mocked(Sys.exec).mockResolvedValue('url');

        // Mock Manifest (Empty)
        vi.mocked(Sys.exists).mockResolvedValue(true);
        vi.mocked(Sys.file).mockImplementation((p) => {
            if (p.endsWith('README.md')) return { text: async () => '<!-- ACTIONS_TABLE -->', exists: async () => true } as any;
            if (p.endsWith('action.yml')) return { text: async () => 'name: No Version Action', exists: async () => true } as any;
            return { text: async () => '{}', exists: async () => false } as any;
        });

        const mockScan = {
            scan: async function* () {
                yield 'actions/pkg/no-version/action.yml';
            }
        };
        vi.mocked(Sys.glob).mockReturnValue(mockScan as any);

        await generateReadme.main();

        expect(Sys.write).toHaveBeenCalled();
        const call = vi.mocked(Sys.write).mock.calls[0];
        // Should not contain the action row
        expect(call[1]).not.toContain('No Version Action');
    });
});
