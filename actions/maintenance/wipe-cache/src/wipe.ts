import * as core from '@actions/core';
import { errorMessage, quoteForLog } from 'actions-util';

import type { BranchTarget } from './branch.js';
import type { CacheApi, CacheEntry } from './github-api.js';
import type { RepositoryCoordinates } from 'actions-util';

/**
 * The most listing rounds one run performs.
 *
 * A round only starts after the previous one deleted something, so this bounds the one case that
 * could otherwise run forever: a job still saving caches for the branch while it is being wiped.
 */
export const MAX_ROUNDS = 10;

export interface WipeOptions {
  repository: RepositoryCoordinates;
  target: BranchTarget;
  /** Wipe the default branch as well; refused otherwise. */
  allowDefaultBranch: boolean;
  /** List what would be deleted and stop. */
  dryRun: boolean;
}

/** An entry that is still there after its last delete attempt, and why. */
export interface CacheFailure {
  entry: CacheEntry;
  message: string;
}

/**
 * Why the run stopped listing.
 *
 * - `empty`: the last listing found nothing, or every entry it found answered 404 to its delete.
 * - `dry-run`: one listing was made and nothing was deleted, as asked.
 * - `no-progress`: a round deleted nothing and some deletes failed; another round would repeat them.
 * - `round-limit`: {@link MAX_ROUNDS} rounds each deleted something and entries were still listed.
 */
export type StopReason = 'dry-run' | 'empty' | 'no-progress' | 'round-limit';

export interface WipeResult {
  /** Every distinct entry seen for the branch, in the order it was first listed. */
  matched: CacheEntry[];
  /** Entries this run deleted. */
  deleted: CacheEntry[];
  /** Entries that answered 404 to their delete: removed by someone else in the meantime. */
  alreadyGone: CacheEntry[];
  /** Entries whose last delete attempt failed. */
  failures: CacheFailure[];
  /** Listing rounds performed. */
  rounds: number;
  stopReason: StopReason;
}

/**
 * Refuses a wipe of the repository default branch unless the caller opted in.
 *
 * The default branch's caches are the ones every other branch falls back to restoring, so wiping
 * them slows every job in the repository until they are rebuilt. A `delete` event cannot name the
 * default branch, so reaching it means the `branch` input was wired to the wrong context, and that
 * is worth a failed step.
 */
export async function assertWipeAllowed(api: CacheApi, options: WipeOptions): Promise<void> {
  if (options.allowDefaultBranch) {
    return;
  }

  const defaultBranch = await api.getDefaultBranch(options.repository);

  if (defaultBranch === options.target.name) {
    throw new Error(
      `Refusing to wipe the caches of ${quoteForLog(defaultBranch)}, the default branch of ` +
        `${options.repository.owner}/${options.repository.repo}. Set allow_default_branch: true to allow it.`,
    );
  }
}

/**
 * Lists the branch's entries, dropping any recorded against another ref.
 *
 * The API filters by `ref` already. The check is repeated because a filter GitHub silently ignored
 * would otherwise turn this run into a wipe of every cache in the repository.
 */
async function listOwnEntries(api: CacheApi, options: WipeOptions): Promise<CacheEntry[]> {
  const listed = await api.listCaches(options.repository, options.target.ref);
  const own = listed.filter((entry) => entry.ref === options.target.ref);

  if (own.length !== listed.length) {
    core.warning(
      `Ignored ${listed.length - own.length} cache entr(ies) the API returned for a ref other than ` +
        `${quoteForLog(options.target.ref)}.`,
    );
  }

  return own;
}

/** Everything one run has seen and done, accumulated across its rounds. */
class WipeLedger {
  private readonly matched = new Map<number, CacheEntry>();
  private readonly deleted: CacheEntry[] = [];
  private readonly alreadyGone = new Map<number, CacheEntry>();
  private readonly failures = new Map<number, CacheFailure>();

  get failureCount(): number {
    return this.failures.size;
  }

  /** Records a listing: new entries are matched, and an earlier failure no longer listed is gone. */
  observe(entries: readonly CacheEntry[]): void {
    const listedIds = new Set(entries.map((entry) => entry.id));

    for (const entry of entries) {
      if (!this.matched.has(entry.id)) {
        this.matched.set(entry.id, entry);
      }
    }

    for (const id of [...this.failures.keys()]) {
      if (!listedIds.has(id)) {
        this.failures.delete(id);
      }
    }
  }

  /** Deletes each entry, recording the outcome, and returns how many this call deleted. */
  async deleteAll(api: CacheApi, repository: RepositoryCoordinates, entries: readonly CacheEntry[]): Promise<number> {
    let deletedNow = 0;

    for (const entry of entries) {
      const label = `${quoteForLog(entry.key)} (id ${entry.id})`;

      try {
        const outcome = await api.deleteCache(repository, entry.id);

        this.failures.delete(entry.id);

        if (outcome === 'deleted') {
          deletedNow += 1;
          this.deleted.push(entry);
          core.info(`  Deleted ${label}.`);
        } else {
          this.alreadyGone.set(entry.id, entry);
          core.info(`  ${label} was already gone.`);
        }
      } catch (error) {
        const message = errorMessage(error);

        this.failures.set(entry.id, { entry, message });
        core.warning(`Failed to delete cache ${label}: ${message}`);
      }
    }

    return deletedNow;
  }

  result(stopReason: StopReason, rounds: number): WipeResult {
    return {
      alreadyGone: [...this.alreadyGone.values()],
      deleted: [...this.deleted],
      failures: [...this.failures.values()],
      matched: [...this.matched.values()],
      rounds,
      stopReason,
    };
  }
}

/**
 * Deletes every cache entry recorded against one branch.
 *
 * Works in rounds: list every page, then delete what was listed, then list again. Deleting while
 * paging would shift later pages under the cursor and skip entries, and the second listing picks up
 * entries a still-running job saved after the first. The loop stops when a listing comes back
 * empty, when a round deletes nothing, or after {@link MAX_ROUNDS}. A round that deletes nothing
 * either found only entries that answered 404, so the branch is clean, or failed on every entry it
 * did not find gone, and another round would fail on them the same way.
 *
 * A failed delete is recorded and retried in the next round rather than thrown, so one stuck entry
 * cannot stop the rest of the branch from being wiped.
 */
export async function wipeBranchCaches(api: CacheApi, options: WipeOptions): Promise<WipeResult> {
  await assertWipeAllowed(api, options);

  const ledger = new WipeLedger();

  for (let round = 1; round <= MAX_ROUNDS; round += 1) {
    const entries = await listOwnEntries(api, options);

    ledger.observe(entries);
    core.info(`Round ${round}: ${entries.length} cache entr(ies) listed for ${quoteForLog(options.target.ref)}.`);

    if (entries.length === 0) {
      return ledger.result('empty', round);
    }

    if (options.dryRun) {
      for (const entry of entries) {
        core.info(`  Would delete ${quoteForLog(entry.key)} (id ${entry.id}).`);
      }

      return ledger.result('dry-run', round);
    }

    if ((await ledger.deleteAll(api, options.repository, entries)) > 0) {
      continue;
    }

    if (ledger.failureCount === 0) {
      return ledger.result('empty', round);
    }

    core.warning(
      `Round ${round} deleted none of the ${entries.length} listed cache entr(ies); stopping instead of ` +
        'retrying the same failures.',
    );

    return ledger.result('no-progress', round);
  }

  core.warning(
    `Cache entries were still being listed for ${quoteForLog(options.target.ref)} after ${MAX_ROUNDS} rounds; ` +
      'a job may still be saving caches for this branch.',
  );

  return ledger.result('round-limit', MAX_ROUNDS);
}
