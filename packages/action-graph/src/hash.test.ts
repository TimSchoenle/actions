import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { gitBlobId, gitTreeId, isGitObjectId, isSha256Hex, sha256Hex } from './hash.js';

/** Runs git in `cwd` and returns trimmed stdout. */
function git(cwd: string, args: string[], input?: string): string {
  return execFileSync('git', args, { cwd, input, encoding: 'utf8' }).trim();
}

describe('sha256Hex', () => {
  it('matches the known digest of the empty string', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('validates digests and object ids', () => {
    expect(isSha256Hex('a'.repeat(64))).toBe(true);
    expect(isSha256Hex('A'.repeat(64))).toBe(false);
    expect(isGitObjectId('0'.repeat(40))).toBe(true);
    expect(isGitObjectId('0'.repeat(39))).toBe(false);
  });
});

describe('git object ids', () => {
  it('agree with git for a blob and for a tree with a subtree that sorts after a same-prefix file', () => {
    const repo = fs.mkdtempSync(path.join(tmpdir(), 'action-graph-hash-'));
    try {
      git(repo, ['init', '--quiet']);
      const content = Buffer.from('console.log(1);\n');
      const blob = git(repo, ['hash-object', '-w', '--stdin'], content.toString());
      expect(gitBlobId(content)).toBe(blob);

      const inner = git(repo, ['mktree'], `100644 blob ${blob}\tindex.js\n`);
      const outer = git(
        repo,
        ['mktree'],
        `100644 blob ${blob}\tdist.js\n040000 tree ${inner}\tdist\n100755 blob ${blob}\tz\n`,
      );

      expect(gitTreeId([{ name: 'index.js', mode: '100644', sha: blob }])).toBe(inner);
      expect(
        gitTreeId([
          { name: 'z', mode: '100755', sha: blob },
          { name: 'dist', mode: '040000', sha: inner },
          { name: 'dist.js', mode: '100644', sha: blob },
        ]),
      ).toBe(outer);
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });
});
