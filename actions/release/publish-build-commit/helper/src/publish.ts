import { gitBlobId, isWithin, renderChecksums } from 'action-graph';

import { planTree } from './tree.js';

import type { MakeLatest, PublishApi, Release } from './github.js';
import type { ExistingFilesPolicy, PlannedFile, TreePlan } from './tree.js';
import type { BundleFile } from 'action-graph';

/** One release to publish. */
export interface ReleaseSpec {
  /** Created on the build commit; what consumers pin. */
  readonly consumerTag: string;
  /** Created on the source commit when set. */
  readonly sourceTag: string | undefined;
  readonly releaseName: string;
  readonly notes: string;
  /** The package directory whose bundles become this release's assets; every bundle when unset. */
  readonly path: string | undefined;
}

export type AssetPolicy = 'none' | 'checksums' | 'bundles';

/** Everything a publish needs, validated. */
export interface PublishRequest {
  readonly sourceSha: string;
  readonly files: readonly BundleFile[];
  /** Reads a bundle's verified content by path. */
  readonly readFile: (path: string) => Uint8Array;
  readonly manifestSha256: string;
  readonly existingFiles: ExistingFilesPolicy;
  /** Empty for no branch. */
  readonly releasesBranch: string;
  readonly releases: readonly ReleaseSpec[];
  readonly assets: AssetPolicy;
  readonly makeLatest: MakeLatest;
  readonly pullRequest: number | undefined;
  readonly pendingLabel: string;
  readonly taggedLabel: string;
  readonly dryRun: boolean;
  readonly runUrl: string;
}

export interface PublishedRelease {
  readonly tag: string;
  readonly id: number;
  readonly url: string;
}

export interface PublishResult {
  /** `undefined` only in a dry run that found no existing build commit. */
  readonly buildSha: string | undefined;
  readonly treeSha: string;
  readonly created: readonly string[];
  readonly releases: readonly PublishedRelease[];
}

/** How often a lost race on the releases branch is retried before the publish fails. */
const BRANCH_ATTEMPTS = 3;

/** The file name of the checksum asset. */
export const CHECKSUMS_ASSET = 'bundles.sha256';

/** Marks the comment this action leaves on a release pull request, per source commit, so it is left once. */
export function commentMarker(sourceSha: string): string {
  return `<!-- publish-build-commit:${sourceSha} -->`;
}

/** The message of the build commit, with trailers naming its source, run and manifest. */
export function buildCommitMessage(request: Pick<PublishRequest, 'sourceSha' | 'runUrl' | 'manifestSha256'>): string {
  return [
    `chore(release): build bundles for ${request.sourceSha.slice(0, 12)}`,
    '',
    `Source-Commit: ${request.sourceSha}`,
    ...(request.runUrl === '' ? [] : [`Build-Run: ${request.runUrl}`]),
    `Bundles-Manifest-SHA256: ${request.manifestSha256}`,
    '',
  ].join('\n');
}

/** The assets of one release: name and content, sorted by name. */
export function releaseAssets(
  release: ReleaseSpec,
  request: Pick<PublishRequest, 'files' | 'readFile' | 'assets'>,
): Array<{ name: string; content: Uint8Array }> {
  if (request.assets === 'none') {
    return [];
  }
  const files = request.files.filter((file) => release.path === undefined || isWithin(release.path, file.path));
  if (files.length === 0) {
    return [];
  }

  const assets = [{ name: CHECKSUMS_ASSET, content: Buffer.from(renderChecksums(files)) }];
  if (request.assets === 'bundles') {
    for (const file of files) {
      const relative =
        release.path === undefined || release.path === '.' ? file.path : file.path.slice(release.path.length + 1);
      assets.push({ name: relative.replaceAll('/', '-'), content: Buffer.from(request.readFile(file.path)) });
    }
  }
  const names = assets.map((asset) => asset.name);
  const duplicate = names.find((name, index) => names.indexOf(name) !== index);
  if (duplicate !== undefined) {
    throw new Error(`Release ${release.consumerTag} would have two assets named ${duplicate}.`);
  }

  return assets.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/**
 * Publishes a build: build commit, releases branch, tags, releases, pull request labels.
 *
 * Every step is an "ensure": it reads what exists and writes only a difference, so a re-run after any
 * failure finishes the job and a re-run after success writes nothing. A ref that exists somewhere
 * other than where it must point fails the run; no ref is ever moved except the releases branch,
 * and that only by fast-forward. The pull request is relabelled last, so a partial failure leaves it
 * pending and release-please opens no new release pull request until the publish is completed.
 */
export class Publisher {
  private readonly created: string[] = [];

  constructor(
    private readonly api: PublishApi,
    private readonly request: PublishRequest,
  ) {}

  /** Runs every step in order. */
  async publish(): Promise<PublishResult> {
    const source = await this.api.getCommit(this.request.sourceSha);
    const plannedFiles: PlannedFile[] = this.request.files.map((file) => {
      const content = this.request.readFile(file.path);

      return { path: file.path, content, blobSha: gitBlobId(content) };
    });
    const plan = await planTree(this.api, source.tree, plannedFiles, this.request.existingFiles);

    const buildSha = await this.ensureBuildCommit(source.tree, plan);
    if (buildSha !== undefined) {
      await this.ensureTags(buildSha);
    } else {
      await this.checkTagsAbsent();
    }
    const releases = await this.ensureReleases();
    await this.markPullRequest(releases);

    return { buildSha, treeSha: plan.treeSha, created: [...this.created], releases };
  }

  private record(change: string): void {
    this.created.push(change);
  }

  /** Whether `sha` is a build commit of this source with this tree. */
  private async isBuildCommit(sha: string, treeSha: string): Promise<boolean> {
    const commit = await this.api.getCommit(sha);

    return commit.tree === treeSha && commit.parents.includes(this.request.sourceSha);
  }

  /** The build commit an existing consumer tag already names, when one does. */
  private async buildCommitFromTags(treeSha: string): Promise<string | undefined> {
    const found = new Set<string>();
    for (const release of this.request.releases) {
      const sha = await this.api.resolveRef(`tags/${release.consumerTag}`);
      if (sha === undefined) {
        continue;
      }
      if (!(await this.isBuildCommit(sha, treeSha))) {
        throw new Error(
          `Tag ${release.consumerTag} exists at ${sha}, which is not a build commit of this source and tree.`,
        );
      }
      found.add(sha);
    }
    if (found.size > 1) {
      throw new Error(`The consumer tags name different build commits: ${[...found].join(', ')}.`);
    }

    return [...found][0];
  }

  /** Writes the blobs and the tree, checking each id GitHub returns against the local computation. */
  private async writeTree(sourceTree: string, plan: TreePlan): Promise<void> {
    if (plan.additions.length === 0) {
      if (plan.treeSha !== sourceTree) {
        throw new Error(
          `No file to add, yet the computed tree ${plan.treeSha} differs from the source tree ${sourceTree}.`,
        );
      }
      return;
    }
    for (const file of plan.additions) {
      const sha = await this.api.createBlob(file.content);
      if (sha !== file.blobSha) {
        throw new Error(`GitHub stored ${file.path} as blob ${sha}, expected ${file.blobSha}.`);
      }
    }
    const treeSha = await this.api.createTree(
      sourceTree,
      plan.additions.map((file) => ({ path: file.path, sha: file.blobSha })),
    );
    if (treeSha !== plan.treeSha) {
      throw new Error(`GitHub created tree ${treeSha}, expected ${plan.treeSha}.`);
    }
  }

  /**
   * Finds or creates the build commit and makes the releases branch contain it.
   *
   * @returns the build commit, or `undefined` in a dry run that found none
   */
  private async ensureBuildCommit(sourceTree: string, plan: TreePlan): Promise<string | undefined> {
    const existing = await this.buildCommitFromTags(plan.treeSha);
    if (existing !== undefined) {
      if (this.request.releasesBranch !== '') {
        await this.ensureBranchContains(existing);
      }
      return existing;
    }
    if (this.request.releasesBranch === '') {
      return this.createUnchainedBuildCommit(sourceTree, plan);
    }

    return this.createChainedBuildCommit(sourceTree, plan);
  }

  /** Creates a build commit whose only parent is the source commit. */
  private async createUnchainedBuildCommit(sourceTree: string, plan: TreePlan): Promise<string | undefined> {
    if (this.request.dryRun) {
      return undefined;
    }
    await this.writeTree(sourceTree, plan);
    const buildSha = await this.createBuildCommit(plan.treeSha, [this.request.sourceSha]);
    this.record(`commit:${buildSha}`);

    return buildSha;
  }

  /**
   * Creates a build commit on the releases branch head and moves the branch to it, or reuses a head
   * that already is a build commit of this source and tree. A lost race chains on the new head.
   */
  private async createChainedBuildCommit(sourceTree: string, plan: TreePlan): Promise<string | undefined> {
    const branch = this.request.releasesBranch;
    let wroteTree = false;

    for (let attempt = 1; attempt <= BRANCH_ATTEMPTS; attempt += 1) {
      const head = await this.api.resolveRef(`heads/${branch}`);
      if (head !== undefined && (await this.isBuildCommit(head, plan.treeSha))) {
        return head;
      }
      if (this.request.dryRun) {
        return undefined;
      }
      if (!wroteTree) {
        await this.writeTree(sourceTree, plan);
        wroteTree = true;
      }

      const buildSha = await this.createBuildCommit(
        plan.treeSha,
        head === undefined ? [this.request.sourceSha] : [head, this.request.sourceSha],
      );
      if (await this.moveBranch(head, buildSha)) {
        this.record(`commit:${buildSha}`);
        this.record(`branch:${branch}@${buildSha}`);
        return buildSha;
      }
      // Lost a race: the commit just created stays unreferenced and the next attempt chains on the
      // new head.
    }

    throw new Error(`The releases branch ${branch} kept moving; gave up after ${BRANCH_ATTEMPTS} attempts.`);
  }

  /** Creates the releases branch at `target`, or fast-forwards it from `head`. False when it moved meanwhile. */
  private async moveBranch(head: string | undefined, target: string): Promise<boolean> {
    const ref = `heads/${this.request.releasesBranch}`;

    return head === undefined
      ? (await this.api.createRef(ref, target)) === 'created'
      : (await this.api.updateRef(ref, target)) === 'updated';
  }

  private createBuildCommit(treeSha: string, parents: readonly string[]): Promise<string> {
    return this.api.createCommit(buildCommitMessage(this.request), treeSha, parents);
  }

  /** Makes the releases branch contain `buildSha`: creates it there, or fast-forwards it. */
  private async ensureBranchContains(buildSha: string): Promise<void> {
    const branch = this.request.releasesBranch;
    const head = await this.api.resolveRef(`heads/${branch}`);
    if (head === buildSha) {
      return;
    }
    const status = head === undefined ? 'missing' : await this.api.compare(buildSha, head);
    if (status === 'identical' || status === 'ahead') {
      return;
    }
    if (status === 'diverged') {
      throw new Error(`The releases branch ${branch} at ${head} does not contain the build commit ${buildSha}.`);
    }
    if (this.request.dryRun) {
      return;
    }
    if (!(await this.moveBranch(head, buildSha))) {
      throw new Error(`The releases branch ${branch} moved while it was being fast-forwarded to ${buildSha}.`);
    }
    this.record(`branch:${branch}@${buildSha}`);
  }

  /** Creates `tag` at `sha`, or confirms it is there. Never moves a tag. */
  private async ensureTag(tag: string, sha: string): Promise<void> {
    const current = await this.api.resolveRef(`tags/${tag}`);
    if (current === sha) {
      return;
    }
    if (current !== undefined) {
      throw new Error(`Tag ${tag} exists at ${current}, expected ${sha}.`);
    }
    if (this.request.dryRun) {
      return;
    }
    if ((await this.api.createRef(`tags/${tag}`, sha)) === 'exists') {
      const raced = await this.api.resolveRef(`tags/${tag}`);
      if (raced !== sha) {
        throw new Error(`Tag ${tag} was created at ${String(raced)} concurrently, expected ${sha}.`);
      }
      return;
    }
    this.record(`tag:${tag}@${sha}`);
  }

  private async ensureTags(buildSha: string): Promise<void> {
    for (const release of this.sortedReleases()) {
      await this.ensureTag(release.consumerTag, buildSha);
      if (release.sourceTag !== undefined) {
        await this.ensureTag(release.sourceTag, this.request.sourceSha);
      }
    }
  }

  /** In a dry run without a build commit, a consumer tag must not exist yet; source tags must fit. */
  private async checkTagsAbsent(): Promise<void> {
    for (const release of this.sortedReleases()) {
      if (release.sourceTag !== undefined) {
        await this.ensureTag(release.sourceTag, this.request.sourceSha);
      }
    }
  }

  private sortedReleases(): ReleaseSpec[] {
    return [...this.request.releases].sort((a, b) =>
      a.consumerTag < b.consumerTag ? -1 : a.consumerTag > b.consumerTag ? 1 : 0,
    );
  }

  /** Creates, completes and publishes every release, skipping one that is already published. */
  private async ensureReleases(): Promise<PublishedRelease[]> {
    const all = await this.api.listReleases();
    const published: PublishedRelease[] = [];

    for (const spec of this.sortedReleases()) {
      const matching = all.filter((release) => release.tagName === spec.consumerTag);
      const done = matching.find((release) => !release.draft);
      if (done !== undefined) {
        published.push({ tag: spec.consumerTag, id: done.id, url: done.htmlUrl });
        continue;
      }
      const drafts = matching.filter((release) => release.draft);
      if (drafts.length > 1) {
        throw new Error(`Tag ${spec.consumerTag} has ${drafts.length} draft releases; delete all but one.`);
      }
      const assets = releaseAssets(spec, this.request);
      if (this.request.dryRun) {
        continue;
      }

      let draft = drafts[0];
      if (draft === undefined) {
        draft = await this.api.createDraftRelease(spec.consumerTag, spec.releaseName, spec.notes);
        this.record(`release:${spec.consumerTag}`);
      }
      await this.replaceAssets(draft, spec.consumerTag, assets);
      const release = await this.api.publishRelease(draft.id, spec.releaseName, spec.notes, this.request.makeLatest);
      this.record(`published:${spec.consumerTag}`);
      published.push({ tag: spec.consumerTag, id: release.id, url: release.htmlUrl });
    }

    return published;
  }

  /** Replaces every asset of a draft with `assets`. A draft is mutable until it is published. */
  private async replaceAssets(
    draft: Release,
    tag: string,
    assets: ReadonlyArray<{ name: string; content: Uint8Array }>,
  ): Promise<void> {
    for (const asset of draft.assets) {
      await this.api.deleteAsset(asset.id);
    }
    for (const asset of assets) {
      await this.api.uploadAsset(draft, asset.name, asset.content);
      this.record(`asset:${tag}/${asset.name}`);
    }
  }

  /** Comments on the release pull request, adds the tagged label, and removes the pending one last. */
  private async markPullRequest(releases: readonly PublishedRelease[]): Promise<void> {
    const number = this.request.pullRequest;
    if (number === undefined || this.request.dryRun) {
      return;
    }
    const marker = commentMarker(this.request.sourceSha);
    if (!(await this.api.issueCommentBodies(number)).some((body) => body.includes(marker))) {
      const lines = releases.map((release) => `- [${release.tag}](${release.url})`);
      await this.api.createComment(
        number,
        `${marker}\nReleased from ${this.request.sourceSha}:\n\n${lines.join('\n')}\n`,
      );
      this.record(`comment:#${number}`);
    }
    const labels = await this.api.issueLabels(number);
    if (!labels.includes(this.request.taggedLabel)) {
      await this.api.addLabel(number, this.request.taggedLabel);
      this.record(`label:#${number}+${this.request.taggedLabel}`);
    }
    if (labels.includes(this.request.pendingLabel)) {
      await this.api.removeLabel(number, this.request.pendingLabel);
      this.record(`label:#${number}-${this.request.pendingLabel}`);
    }
  }
}
