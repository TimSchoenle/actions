import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describePatch, serializeMetadata } from 'actions-util/patch';
import { ArtifactContentError } from 'actions-util/patch-reader';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ARCHIVE_OVERHEAD_BYTES, assertArchiveSize, findArtifacts, inspectArtifact, RunNotFoundError } from './find.js';

import type { ArtifactApi, ArtifactSummary } from './find.js';

const repository = { owner: 'owner', repo: 'repo' };
const BASE = 'a'.repeat(40);
const OTHER = 'b'.repeat(40);
const PATCH = Buffer.from('diff --git a/x b/x\n');
const MAX = 1024;

/** An artifact listing that answers with `artifacts`. */
function api(artifacts: ArtifactSummary[]): ArtifactApi & { listArtifacts: ReturnType<typeof vi.fn> } {
  return { listArtifacts: vi.fn().mockResolvedValue(artifacts) };
}

describe('findArtifacts', () => {
  const live = (id: number, name = 'patch'): ArtifactSummary => ({ expired: false, id, name, sizeInBytes: 100 });

  it('asks for the named artifacts of the given run', async () => {
    const listing = api([]);

    await findArtifacts(listing, repository, 42, 'patch');

    expect(listing.listArtifacts).toHaveBeenCalledWith(repository, 42, 'patch');
  });

  it('finds a single unexpired artifact of exactly that name', async () => {
    expect(await findArtifacts(api([live(1)]), repository, 42, 'patch')).toEqual([live(1)]);
  });

  it('reports none when the run holds no artifact of that name', async () => {
    expect(await findArtifacts(api([]), repository, 42, 'patch')).toEqual([]);
  });

  it('treats an expired artifact as missing, since it can no longer be downloaded', async () => {
    expect(
      await findArtifacts(api([{ expired: true, id: 1, name: 'patch', sizeInBytes: 100 }]), repository, 42, 'patch'),
    ).toEqual([]);
  });

  it('ignores an artifact whose name only resembles the one asked for', async () => {
    expect(await findArtifacts(api([live(1, 'patch-2'), live(2, 'Patch')]), repository, 42, 'patch')).toEqual([]);
  });

  it('keeps the live artifact beside an expired one of the same name', async () => {
    const listing = api([{ expired: true, id: 1, name: 'patch', sizeInBytes: 100 }, live(2)]);

    expect(await findArtifacts(listing, repository, 42, 'patch')).toEqual([live(2)]);
  });

  it('puts the newest first when re-run attempts uploaded the name again, as download-artifact picks it', async () => {
    expect(await findArtifacts(api([live(5), live(9), live(7)]), repository, 42, 'patch')).toEqual([
      live(9),
      live(7),
      live(5),
    ]);
  });

  it('lets a missing run fail the lookup instead of reading as nothing to commit', async () => {
    const error = new RunNotFoundError(repository, 42);
    const listing: ArtifactApi = { listArtifacts: vi.fn().mockRejectedValue(error) };

    await expect(findArtifacts(listing, repository, 42, 'patch')).rejects.toBe(error);
  });
});

describe('assertArchiveSize', () => {
  const archive = (sizeInBytes: number): ArtifactSummary => ({ expired: false, id: 3, name: 'patch', sizeInBytes });

  it('accepts an archive up to max_patch_bytes plus the overhead allowance', () => {
    expect(() => assertArchiveSize(archive(MAX + ARCHIVE_OVERHEAD_BYTES), MAX)).not.toThrow();
  });

  it('refuses a larger archive, naming its size and the bound', () => {
    expect(() => assertArchiveSize(archive(MAX + ARCHIVE_OVERHEAD_BYTES + 1), MAX)).toThrow(
      `Artifact 3 (patch) is ${MAX + ARCHIVE_OVERHEAD_BYTES + 1} bytes, more than any create-patch artifact within ` +
        `max_patch_bytes (${MAX}) can be (${MAX + ARCHIVE_OVERHEAD_BYTES}); it was not downloaded.`,
    );
  });
});

describe('RunNotFoundError', () => {
  it('names the run and the permission the token needs, and keeps the cause', () => {
    const cause = new Error('Not Found');
    const error = new RunNotFoundError(repository, 42, { cause });

    expect(error.name).toBe('RunNotFoundError');
    expect(error.message).toBe(
      'Workflow run 42 of owner/repo was not found. Check run_id, and that the token has actions: read.',
    );
    expect(error.cause).toBe(cause);
  });
});

describe('inspectArtifact', () => {
  let root: string;
  let directory: string;

  /** Writes an artifact holding `patch`, made from `baseSha`, into the download directory. */
  async function lay(patch: Buffer, baseSha = BASE): Promise<void> {
    await writeFile(path.join(directory, 'changes.patch'), patch);
    await writeFile(path.join(directory, 'metadata.json'), serializeMetadata(describePatch(baseSha, patch)));
  }

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'find-patch-inspect-'));
    directory = path.join(root, 'download');
    await mkdir(directory);
  });

  afterEach(async () => {
    await rm(root, { force: true, recursive: true });
  });

  it('reports changes for a non-empty patch made from the expected head', async () => {
    await lay(PATCH);

    expect(await inspectArtifact(directory, MAX, BASE)).toEqual({ baseSha: BASE, outcome: 'changes' });
  });

  it('reports changes for a non-empty patch when no head is expected', async () => {
    await lay(PATCH, OTHER);

    expect(await inspectArtifact(directory, MAX, '')).toEqual({ baseSha: OTHER, outcome: 'changes' });
  });

  it('reports no_changes for an empty patch', async () => {
    await lay(Buffer.alloc(0));

    expect(await inspectArtifact(directory, MAX, BASE)).toEqual({ baseSha: BASE, outcome: 'no_changes' });
  });

  it('reports branch_moved for an empty patch made from another commit, as commit-patch does', async () => {
    await lay(Buffer.alloc(0), OTHER);

    expect(await inspectArtifact(directory, MAX, BASE)).toEqual({ baseSha: OTHER, outcome: 'branch_moved' });
  });

  it('reports no_changes for an empty patch from another commit when no head is expected', async () => {
    await lay(Buffer.alloc(0), OTHER);

    expect(await inspectArtifact(directory, MAX, '')).toEqual({ baseSha: OTHER, outcome: 'no_changes' });
  });

  it('reports branch_moved for a non-empty patch made from another commit', async () => {
    await lay(PATCH, OTHER);

    expect(await inspectArtifact(directory, MAX, BASE)).toEqual({ baseSha: OTHER, outcome: 'branch_moved' });
  });

  it('fails on an artifact without its patch file rather than reading it as empty', async () => {
    await writeFile(path.join(directory, 'metadata.json'), serializeMetadata(describePatch(BASE, PATCH)));

    await expect(inspectArtifact(directory, MAX, BASE)).rejects.toBeInstanceOf(ArtifactContentError);
  });

  it('fails on a patch whose bytes do not match its metadata', async () => {
    await writeFile(path.join(directory, 'changes.patch'), PATCH);
    await writeFile(path.join(directory, 'metadata.json'), serializeMetadata(describePatch(BASE, Buffer.alloc(0))));

    await expect(inspectArtifact(directory, MAX, BASE)).rejects.toThrow(
      'the patch is 19 bytes but the metadata records 0',
    );
  });

  it('fails on a patch above max_patch_bytes', async () => {
    await lay(PATCH);

    await expect(inspectArtifact(directory, 4, BASE)).rejects.toThrow('above max_patch_bytes (4)');
  });

  it('fails when nothing was downloaded', async () => {
    await expect(inspectArtifact(path.join(root, 'absent'), MAX, BASE)).rejects.toThrow('nothing was downloaded');
  });
});
