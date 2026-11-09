import path from 'node:path';

import chalk from 'chalk';

import { expectedReleaseTags, parseReleasedPaths, type TagRepository, waitForTags } from './lib/release-tags.js';
import { ROOT_DIR, Sys } from './lib/utils.js';

// Waits until every tag the current release-please run created is visible to git, so the docs
// generator that runs next pins READMEs to commits rather than to tag names. Run by the Generate Docs
// job in .github/workflows/release-please.yml with RELEASED_PATHS set to release-please's
// `paths_released` output. The rules live in ./lib/release-tags.ts, where the unit suite covers them.

async function git(args: string[]): Promise<number> {
  const { exitCode, stderr } = await Sys.run(['git', ...args], ROOT_DIR);

  if (exitCode !== 0 && stderr.trim() !== '') {
    console.log(chalk.gray(stderr.trim()));
  }

  return exitCode;
}

const repository: TagRepository = {
  async fetchTags() {
    const exitCode = await git(['fetch', '--force', '--tags', '--quiet', 'origin']);

    if (exitCode !== 0) {
      throw new Error(`git fetch --tags failed with exit code ${exitCode}.`);
    }
  },
  async hasTag(tag) {
    return (await git(['rev-parse', '--verify', '--quiet', `refs/tags/${tag}`])) === 0;
  },
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

export async function main(): Promise<void> {
  const raw = process.env.RELEASED_PATHS;

  if (!raw) {
    throw new Error('RELEASED_PATHS is required.');
  }

  const tags = expectedReleaseTags(
    {
      config: await Sys.file(path.join(ROOT_DIR, 'release-please-config.json')).json(),
      manifest: await Sys.file(path.join(ROOT_DIR, '.release-please-manifest.json')).json(),
    },
    parseReleasedPaths(raw),
  );

  console.log(chalk.blue(`Waiting for ${tags.length} release tag(s): ${tags.join(', ')}`));
  await waitForTags(repository, tags);
  console.log(chalk.green('Every release tag is present.'));
}

if (import.meta.main) {
  await main();
}
