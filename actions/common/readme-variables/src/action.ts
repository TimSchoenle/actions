import path from 'node:path';

import * as core from '@actions/core';
import { quoteForLog, resolveWithinWorkspace, runAction, workspaceRoot } from 'actions-util';

import { buildDocsIndex } from './docs.js';
import { getInput, setOutput } from './generated/action-io.js';
import { detectManifest, readManifest } from './manifest.js';
import { parseExtra } from './merge.js';
import { buildPayload, parseRepository, serializePayload } from './payload.js';

/**
 * Resolves the manifest to read, and refuses one that would reach outside the checkout.
 *
 * The reported path is the one the caller wrote, so an error names `Cargo.toml` rather than
 * `/home/runner/work/repo/repo/Cargo.toml`. The absolute path is what the reader opens.
 */
async function resolveManifest(workspace: string, given: string): Promise<{ absolute: string; reported: string }> {
  const reported = given.trim() === '' ? await detectManifest(workspace) : given.trim();

  return { absolute: resolveWithinWorkspace(reported, workspace, 'manifest'), reported };
}

/**
 * Reads the inputs, assembles the payload and publishes it.
 *
 * `variables` is the output that matters and the only one a render needs; `version`, `tag` and
 * `manifest-path` are published beside it so a caller can tag an image or name a file without
 * parsing JSON in a shell step.
 */
export function run(): Promise<void> {
  return runAction(async () => {
    const workspace = workspaceRoot();
    const docsDir = getInput('docs-dir');

    if (docsDir.trim() !== '') {
      resolveWithinWorkspace(docsDir, workspace, 'docs-dir');
    }

    const repository = parseRepository(getInput('repository', { required: true }));
    const extra = parseExtra(getInput('extra'));
    const { absolute, reported } = await resolveManifest(workspace, getInput('manifest'));

    core.info(`Reading ${quoteForLog(reported)}...`);

    const manifest = await readManifest(absolute, reported);
    const docs = await buildDocsIndex(workspace, docsDir);

    const payload = buildPayload({
      repository,
      branch: getInput('branch', { required: true }),
      manifestPath: reported,
      manifest,
      docs,
      tagPrefix: getInput('tag-prefix'),
      extra,
    });

    const release = payload['release'] as { tag: string; version: string };

    setOutput('variables', serializePayload(payload));
    setOutput('version', release.version);
    setOutput('tag', release.tag);
    setOutput('manifest-path', reported);

    core.info(
      `✅ ${manifest.kind} ${quoteForLog(release.version)} from ${quoteForLog(reported)}, ` +
        `${docs.length} document(s) under ${quoteForLog(path.posix.normalize(docsDir))}.`,
    );
  });
}
