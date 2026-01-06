import { describe, it, expect, vi } from 'vitest';
import * as utils from './utils';
import { Sys } from './sys';

// Mock Sys module
vi.mock('./sys', () => ({
    Sys: {
        exec: vi.fn(),
        file: vi.fn(),
        write: vi.fn(),
    },
}));

describe('utils', () => {
    describe('capitalize', () => {
        it('should capitalize the first letter', () => {
            expect(utils.capitalize('hello')).toBe('Hello');
            expect(utils.capitalize('world')).toBe('World');
        });

        it('should handle empty strings', () => {
            expect(utils.capitalize('')).toBe('');
        });
    });

    describe('getRepoName', () => {
        it('should parse repo name from git/ssh url', async () => {
            vi.mocked(Sys.exec).mockResolvedValue('git@github.com:User/repo.git\n');
            expect(await utils.getRepoName()).toBe('User/repo');
        });

        it('should parse repo name from https url', async () => {
            vi.mocked(Sys.exec).mockResolvedValue('https://github.com/User/repo.git\n');
            expect(await utils.getRepoName()).toBe('User/repo');
        });

        it('should throw error if origin cannot be parsed', async () => {
            vi.mocked(Sys.exec).mockResolvedValue('invalid-url');
            await expect(utils.getRepoName()).rejects.toThrow('Could not parse repo name from origin');
        });
    });

    describe('createFromTemplate', () => {
        it('should read template and write with replacements', async () => {
            const mockFile = {
                text: vi.fn().mockResolvedValue('Hello {{name}}!'),
            };
            vi.mocked(Sys.file).mockReturnValue(mockFile as unknown as ReturnType<typeof Sys.file>);

            await utils.createFromTemplate('test-template', 'dest/path', { name: 'World' });

            expect(Sys.file).toHaveBeenCalled();
            expect(mockFile.text).toHaveBeenCalled();
            expect(Sys.write).toHaveBeenCalledWith('dest/path', 'Hello World!');
        });
    });
});
