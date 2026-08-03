import { randomBytes } from 'node:crypto';

import { errorMessage, hasStatus, parseRepository, resolveOptional } from 'actions-util';
import { createOctokit } from 'actions-util/client';
import { readAfterWrite } from 'actions-util/read-after-write';

import { Workspace } from './workspace.js';

import type { WorkspaceFiles } from './workspace.js';

/** Token used for every API call the harness makes; a fine-grained PAT is enough locally. */
const TOKEN_ENV = 'E2E_GITHUB_TOKEN';

/**
 * Token for a *second* identity, needed only where GitHub refuses to let one account act on itself.
 *
 * Approving a pull request is the case: GitHub rejects a review by its own author, so
 * `auto-approve-pr` cannot be exercised with the token that opened the fixture.
 */
const SECONDARY_TOKEN_ENV = 'E2E_GITHUB_TOKEN_SECONDARY';

/**
 * Slug of the GitHub App behind each token, when one minted it.
 *
 * Set by the generated workflows from `create-github-app-token`'s `app-slug` output. Absent locally,
 * where a personal token identifies itself through `GET /user` instead.
 */
const APP_SLUG_ENV = 'E2E_APP_SLUG';
const SECONDARY_APP_SLUG_ENV = 'E2E_APP_SLUG_SECONDARY';

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

/** GitHub's ceiling on `per_page`; the scratch repository never approaches it. */
const MAX_PAGE_SIZE = 100;

/** The lifecycle states a check run can be created in. */
export type CheckStatus = 'queued' | 'in_progress' | 'completed';

/** The outcomes a completed check run can report. */
export type CheckConclusion = 'success' | 'failure' | 'neutral' | 'cancelled' | 'skipped' | 'timed_out';

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

  /**
   * The token of the second identity, for a case that cannot use the first.
   *
   * @throws {E2eConfigurationError} when it is not configured, rather than falling back to the
   * primary token — a silent fallback would turn "GitHub refused a self-review" into a confusing
   * assertion failure about a missing approval.
   */
  get secondaryToken(): string {
    const token = process.env[SECONDARY_TOKEN_ENV] ?? '';

    if (token === '') {
      throw new E2eConfigurationError(
        `${SECONDARY_TOKEN_ENV} is not set. This case needs a second identity because GitHub refuses ` +
          'to let an account review its own pull request.',
      );
    }

    return token;
  }

  /**
   * The numeric id of the account behind a token, which several actions match authors against.
   *
   * `GET /user` only answers for a user token. In CI the token is a GitHub App *installation* token,
   * which that endpoint rejects with 403 "Resource not accessible by integration" — so when the
   * workflow tells us which app minted it, the bot user is resolved by name instead. Both paths
   * return the id of the account whose commits the fixtures will carry.
   */
  async accountId(token: string = this.token): Promise<number> {
    const slug = token === this.token ? process.env[APP_SLUG_ENV] : process.env[SECONDARY_APP_SLUG_ENV];
    const octokit = createOctokit(token);

    if (slug !== undefined && slug !== '') {
      const { data } = await octokit.rest.users.getByUsername({ username: `${slug}[bot]` });

      return data.id;
    }

    const { data } = await octokit.rest.users.getAuthenticated();

    return data.id;
  }

  /** Reserves a branch name for a case and schedules it for teardown. */
  branch(caseName: string): string {
    const name = `${REF_PREFIX}/${this.scope}/${this.runId}/${caseName}`;

    this.branches.add(name);

    return name;
  }

  /**
   * Registers a ref name **verbatim**, outside this suite's namespace, for teardown.
   *
   * {@link branch} prefixes what it is given, which is right for a fixture and wrong for the one case
   * that needs it not to be: an adversarial case asking what an action does with `--force`, or with
   * `heads/<something>`, has to hand over exactly that string, and if the action turns out to create
   * a ref then nothing namespaced will ever clean it up. Reserving it means teardown deletes it
   * whether or not the case expected it to exist — which is the point, since the case is asking a
   * question it does not know the answer to.
   *
   * The janitor sweeps `test/**` only, so a name outside that prefix has no other backstop.
   */
  reserve(name: string): string {
    // An empty name is not a ref anything could have created, and registering it would only send
    // teardown at `refs/heads/`, which addresses the namespace rather than a branch.
    if (name !== '') {
      this.branches.add(name);
    }

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

  /**
   * Clones a branch into a working tree, for an action that shells out to git.
   *
   * `commit-changes` reads `git status --porcelain` to decide what to commit, so its cases need a
   * real repository rather than a directory of files. The fetch is shallow and single-branch: the
   * scratch repository's history is of no interest, and the cases only ever touch one ref.
   */
  async checkout(branch: string, files: WorkspaceFiles = {}): Promise<Workspace> {
    const workspace = await Workspace.create();

    try {
      await workspace.initGit(branch);
      await workspace.git(['fetch', '--depth=1', '--no-tags', `https://github.com/${this.repository}.git`, branch], {
        authToken: this.token,
      });
      await workspace.git(['checkout', '--quiet', '-B', branch, 'FETCH_HEAD']);
      await workspace.write(files);

      return workspace;
    } catch (error) {
      await workspace.dispose();
      throw error;
    }
  }

  /** Opens a pull request and schedules it for teardown. */
  async createPullRequest(head: string, base: string, title: string, body = ''): Promise<number> {
    const { data } = await this.octokit.rest.pulls.create({
      owner: this.owner,
      repo: this.repo,
      head,
      base,
      title,
      body,
    });

    this.pullRequests.add(data.number);

    return data.number;
  }

  /** Reads a pull request, for asserting on what an action did to it. */
  async pullRequest(number: number): Promise<{
    state: string;
    merged: boolean;
    title: string;
    body: string | null;
    labels: string[];
    head: string;
    base: string;
  }> {
    const { data } = await this.octokit.rest.pulls.get({ owner: this.owner, repo: this.repo, pull_number: number });

    return {
      state: data.state,
      merged: data.merged,
      title: data.title,
      body: data.body,
      labels: data.labels.map((label) => label.name),
      head: data.head.ref,
      base: data.base.ref,
    };
  }

  /** The review states left on a pull request, in the order they were submitted. */
  async reviewStates(number: number): Promise<string[]> {
    const { data } = await this.octokit.rest.pulls.listReviews({
      owner: this.owner,
      repo: this.repo,
      pull_number: number,
      per_page: MAX_PAGE_SIZE,
    });

    return data.map((review) => review.state);
  }

  /** The review bodies on a pull request, for asserting on the message an approval carried. */
  async reviewBodies(number: number): Promise<string[]> {
    const { data } = await this.octokit.rest.pulls.listReviews({
      owner: this.owner,
      repo: this.repo,
      pull_number: number,
      per_page: MAX_PAGE_SIZE,
    });

    return data.map((review) => review.body);
  }

  /** The comment bodies on a pull request, which is how several actions report what they did. */
  async issueComments(number: number): Promise<string[]> {
    const { data } = await this.octokit.rest.issues.listComments({
      owner: this.owner,
      repo: this.repo,
      issue_number: number,
      per_page: MAX_PAGE_SIZE,
    });

    return data.map((comment) => comment.body ?? '');
  }

  /**
   * Publishes a check run against a commit, as a fixture for the actions that read them.
   *
   * `ensure-actions-are-executed` decides whether a required check ran and succeeded, so its cases
   * need check runs in every state — including a queued one that never completes.
   */
  async createCheckRun(sha: string, name: string, status: CheckStatus, conclusion?: CheckConclusion): Promise<number> {
    const { data } = await this.octokit.rest.checks.create({
      owner: this.owner,
      repo: this.repo,
      head_sha: sha,
      name,
      status,
      ...(conclusion === undefined ? {} : { conclusion }),
    });

    return data.id;
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
  /**
   * Deletes one branch, and confirms it is gone rather than trusting the response.
   *
   * "Already deleted" cannot be taken at face value here. A ref written moments earlier is not yet
   * visible to every replica, so a delete issued straight after a case finishes can be answered
   * "Reference does not exist" for a branch that then materialises seconds later — and a teardown
   * that reported success is the reason the scratch repository collects orphans. The delete is
   * therefore re-attempted for as long as a *read* can still see the ref.
   */
  private async deleteBranch(branch: string): Promise<string | undefined> {
    let lastError: unknown;

    for (const delayMs of [0, ...CONVERGENCE_DELAYS_MS]) {
      if (delayMs > 0) {
        await sleep(delayMs);
      }

      try {
        await resolveOptional(
          this.octokit.rest.git.deleteRef({ owner: this.owner, repo: this.repo, ref: `heads/${branch}` }),
        );
        lastError = undefined;
      } catch (error) {
        lastError = error;

        if (!isAlreadyDeleted(error)) {
          return `branch ${branch}: ${errorMessage(error)}`;
        }
      }

      // The single-ref read, not the listing: the listing keeps reporting a ref for minutes after it
      // is gone, and polling that would turn every successful teardown into a timeout.
      if ((await this.refSha(branch)) === undefined) {
        return undefined;
      }
    }

    return `branch ${branch}: still present after teardown${lastError === undefined ? '' : ` (${errorMessage(lastError)})`}`;
  }

  private async deleteBranches(): Promise<string[]> {
    const failures: string[] = [];

    for (const branch of this.branches) {
      const failure = await this.deleteBranch(branch);

      if (failure !== undefined) {
        failures.push(failure);
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
