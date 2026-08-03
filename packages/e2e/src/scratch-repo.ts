import { randomBytes } from 'node:crypto';

import { errorMessage, hasStatus, parseRepository, resolveOptional } from 'actions-util';
import { createOctokit } from 'actions-util/client';
import { readAfterWrite } from 'actions-util/read-after-write';

/** Token used for every API call the harness makes; a fine-grained PAT is enough locally. */
const TOKEN_ENV = 'E2E_GITHUB_TOKEN';

/** Repository the cases mutate. Nothing in it is expected to survive a run. */
const REPOSITORY_ENV = 'E2E_TEST_REPOSITORY';

const DEFAULT_REPOSITORY = 'TimSchoenle/actions-testing';

/** Every ref the harness creates lives under this prefix, so a janitor can sweep by name alone. */
const REF_PREFIX = 'test';

/** What GitHub answers when asked to delete a ref that is not there. */
const UNPROCESSABLE = 422;

/**
 * Waits between re-reads of a ref that exists but has not yet converged on its new commit.
 *
 * Mirrors the schedule `actions-util/read-after-write` uses for a ref that is not yet visible at
 * all; the two lags come from the same replication.
 */
const CONVERGENCE_DELAYS_MS = [500, 1_000, 2_000, 4_000];

const sleep = (milliseconds: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, milliseconds));

/**
 * Whether a failed `deleteRef` means the ref was already gone.
 *
 * GitHub answers 422 rather than 404 for this, so the usual 404-is-absence handling does not cover
 * it, and a case that reserved a branch name its action never created would otherwise report a
 * teardown failure. The message is checked too, so an unrelated 422 still fails loudly.
 */
function isAlreadyDeleted(error: unknown): boolean {
  if (hasStatus(error, UNPROCESSABLE)) {
    return error instanceof Error && error.message.includes('Reference does not exist');
  }

  return false;
}

/** Raised when the harness is asked to talk to GitHub without being configured to. */
export class E2eConfigurationError extends Error {
  constructor(message: string) {
    super(`${message} See packages/e2e/README.md.`);
    this.name = 'E2eConfigurationError';
  }
}

/**
 * Fails unless the environment can reach the scratch repository.
 *
 * Called from the suite's global setup rather than guarded per test: a missing token must stop the
 * run, never skip it. A skipped e2e suite reports green, which is the failure mode this whole
 * exercise is meant to remove.
 */
export function assertE2eConfigured(): void {
  if ((process.env[TOKEN_ENV] ?? '') === '') {
    throw new E2eConfigurationError(`${TOKEN_ENV} is not set, so no end-to-end case can run.`);
  }
}

/**
 * Identifies one run, so concurrent runs cannot collide on a ref name.
 *
 * `run_id` rather than `run_number`: it is unique across every workflow in the repository, whereas
 * two workflows share the run_number sequence and would generate the same branch on the same day.
 */
function runIdentifier(): string {
  const runId = process.env['GITHUB_RUN_ID'];
  const attempt = process.env['GITHUB_RUN_ATTEMPT'] ?? '1';

  return runId === undefined ? `local-${randomBytes(4).toString('hex')}` : `${runId}-${attempt}`;
}

/**
 * A namespace inside the shared scratch repository, plus the teardown for everything it named.
 *
 * Resources are registered when they are *named*, not when they are created: a case that fails
 * midway through the action under test still leaves the branch behind, and a teardown that only knew
 * about successful creations is exactly how the repository accumulated its orphans.
 */
export class ScratchRepo {
  readonly repository: string;
  readonly owner: string;
  readonly repo: string;
  readonly token: string;

  private readonly octokit: ReturnType<typeof createOctokit>;
  private readonly branches = new Set<string>();
  private readonly pullRequests = new Set<number>();

  private constructor(
    private readonly scope: string,
    private readonly runId: string,
    repository: string,
    token: string,
  ) {
    const { owner, repo } = parseRepository(repository);

    this.repository = repository;
    this.owner = owner;
    this.repo = repo;
    this.token = token;
    this.octokit = createOctokit(token);
  }

  /**
   * Binds a scratch namespace for one suite.
   *
   * @param scope short slug naming the action under test; it becomes the second ref segment.
   */
  static fromEnvironment(scope: string): ScratchRepo {
    assertE2eConfigured();

    return new ScratchRepo(
      scope,
      runIdentifier(),
      process.env[REPOSITORY_ENV] ?? DEFAULT_REPOSITORY,
      process.env[TOKEN_ENV] ?? '',
    );
  }

  /** Reserves a branch name for a case and schedules it for teardown. */
  branch(caseName: string): string {
    const name = `${REF_PREFIX}/${this.scope}/${this.runId}/${caseName}`;

    this.branches.add(name);

    return name;
  }

  /** Schedules a pull request the action under test opened, so teardown closes it. */
  trackPullRequest(number: number): void {
    this.pullRequests.add(number);
  }

  /** The repository's default branch, which is what most actions resolve a base against. */
  async defaultBranch(): Promise<string> {
    const { data } = await this.octokit.rest.repos.get({ owner: this.owner, repo: this.repo });

    return data.default_branch;
  }

  /**
   * The commit a branch points at, or `undefined` when the branch does not exist.
   *
   * Takes a 404 at face value, so it is the right read for asserting that something was *not*
   * created. After a write, use {@link headOf} instead.
   */
  async refSha(branch: string): Promise<string | undefined> {
    const response = await resolveOptional(
      this.octokit.rest.git.getRef({ owner: this.owner, repo: this.repo, ref: `heads/${branch}` }),
    );

    return response?.data.object.sha;
  }

  /**
   * The commit a branch points at, waiting out GitHub's ref-replication lag.
   *
   * A `getRef` issued moments after the ref was written regularly 404s even though the write
   * succeeded — observed here as a branch the action reported creating that the very next read could
   * not see. Every assertion that follows a write has to go through this, or it is a coin flip.
   *
   * Absence is only half of it: a ref that was *moved* — a force-reset, a new commit — can also read
   * back at its previous commit for a moment, and no 404 announces that. Passing the commit the
   * caller is waiting for makes the read poll until the replicas agree.
   *
   * Deliberately still returns whatever it last saw once the budget is spent, rather than throwing:
   * the case's own assertion then reports the actual mismatch, which is more useful than a timeout.
   *
   * @param expected commit this branch is expected to converge on, when the caller knows it.
   */
  async headOf(branch: string, expected?: string): Promise<string> {
    const response = await readAfterWrite(
      () => this.octokit.rest.git.getRef({ owner: this.owner, repo: this.repo, ref: `heads/${branch}` }),
      `Branch '${branch}'`,
    );

    let sha = response.data.object.sha;

    for (const delayMs of CONVERGENCE_DELAYS_MS) {
      if (expected === undefined || sha === expected) {
        return sha;
      }

      await sleep(delayMs);
      sha = (await this.refSha(branch)) ?? sha;
    }

    return sha;
  }

  /**
   * Creates a branch through the raw API.
   *
   * Setup deliberately does not go through the action under test: a case whose fixture is built by
   * the very code it is asserting on cannot distinguish a correct result from two matching bugs.
   */
  async createBranch(branch: string, sha?: string): Promise<string> {
    const head = sha ?? (await this.refSha(await this.defaultBranch()));

    if (head === undefined) {
      throw new E2eConfigurationError(`${this.repository} has no default branch to branch from.`);
    }

    this.branches.add(branch);
    await this.octokit.rest.git.createRef({
      owner: this.owner,
      repo: this.repo,
      ref: `refs/heads/${branch}`,
      sha: head,
    });

    // The fixture is not ready until the action under test could read it, so the wait belongs here
    // rather than in every case that builds on the branch.
    await this.headOf(branch, head);

    return head;
  }

  /** Writes a file on a branch, producing a commit, and returns its SHA. */
  async commitFile(branch: string, filePath: string, contents: string, message: string): Promise<string> {
    const { data } = await this.octokit.rest.repos.createOrUpdateFileContents({
      owner: this.owner,
      repo: this.repo,
      path: filePath,
      branch,
      message,
      content: Buffer.from(contents, 'utf8').toString('base64'),
    });

    const sha = data.commit.sha;

    if (sha === undefined) {
      throw new E2eConfigurationError(`GitHub returned no commit SHA for ${filePath} on ${branch}.`);
    }

    await this.headOf(branch, sha);

    return sha;
  }

  /** Closes every tracked pull request, describing the ones that would not close. */
  private async closePullRequests(): Promise<string[]> {
    const failures: string[] = [];

    for (const number of this.pullRequests) {
      try {
        await this.octokit.rest.pulls.update({
          owner: this.owner,
          repo: this.repo,
          pull_number: number,
          state: 'closed',
        });
      } catch (error) {
        failures.push(`pull request #${number}: ${errorMessage(error)}`);
      }
    }

    return failures;
  }

  /** Deletes every reserved branch, tolerating the ones that were never created. */
  private async deleteBranches(): Promise<string[]> {
    const failures: string[] = [];

    for (const branch of this.branches) {
      try {
        await resolveOptional(
          this.octokit.rest.git.deleteRef({ owner: this.owner, repo: this.repo, ref: `heads/${branch}` }),
        );
      } catch (error) {
        if (!isAlreadyDeleted(error)) {
          failures.push(`branch ${branch}: ${errorMessage(error)}`);
        }
      }
    }

    return failures;
  }

  /**
   * Removes everything this namespace reserved.
   *
   * Throws when a resource survives, rather than warning: teardown that fails quietly is
   * indistinguishable from teardown that worked, and the difference only shows up weeks later as a
   * repository full of stale refs.
   */
  async teardown(): Promise<void> {
    const failures = [...(await this.closePullRequests()), ...(await this.deleteBranches())];

    this.pullRequests.clear();
    this.branches.clear();

    if (failures.length > 0) {
      throw new E2eConfigurationError(
        `Teardown left resources behind in ${this.repository}:\n- ${failures.join('\n- ')}`,
      );
    }
  }
}
