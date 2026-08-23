import { fileURLToPath } from 'node:url';

import { runAction, Workspace } from 'actions-e2e';
import { afterEach, describe, expect, it } from 'vitest';

import type { ActionInput, ActionOutput } from '../src/generated/action-io.js';
import type { ActionRunResult, ExpectedOutcome, ProvidedInputs, WorkspaceFiles } from 'actions-e2e';

/**
 * End-to-end cases for `actions/common/readme-variables`, driving the bundled action the way the
 * runner does.
 *
 * The action reads files and nothing else — no token, no scratch repository, no network — which is
 * the property that lets render-template's `check` mode gate a merge. Several cases below assert
 * that property directly rather than trusting it.
 */

const ACTION_DIRECTORY = fileURLToPath(new URL('..', import.meta.url));

const REPOSITORY = 'TimSchoenle/Portfolio';
const BRANCH = 'main';

const CARGO = `[package]
name = "portfolio-platform"
version = "2.7.1"
description = "Dioxus fullstack (SSR + hydration) portfolio served by Axum."
license = "LicenseRef-Proprietary"
rust-version = "1.97"
edition = "2024"

[dependencies]
figment = { version = "0.10", features = ["toml"] }
`;

interface Payload {
  docs: Array<{ path: string; summary: string; title: string }>;
  release: { tag: string; version: string };
  repo: Record<string, string>;
  toolchain: Record<string, string>;
  [key: string]: unknown;
}

describe('readme-variables', () => {
  let workspace: Workspace;

  afterEach(async () => {
    await workspace.dispose();
  });

  function collect(
    inputs: ProvidedInputs<ActionInput> = {},
    expected: ExpectedOutcome = 'success',
  ): Promise<ActionRunResult<ActionOutput>> {
    return runAction<ActionInput, ActionOutput>({
      actionDirectory: ACTION_DIRECTORY,
      inputs: { repository: REPOSITORY, branch: BRANCH, 'docs-dir': 'docs', 'tag-prefix': 'v', ...inputs },
      workspace,
      expect: expected,
    });
  }

  async function withFiles(files: WorkspaceFiles): Promise<void> {
    workspace = await Workspace.create(files);
  }

  function payloadOf(result: ActionRunResult<ActionOutput>): Payload {
    return JSON.parse(result.outputs['variables'] as string) as Payload;
  }

  it('collects the whole payload from a Cargo workspace with docs', async () => {
    await withFiles({
      'Cargo.toml': CARGO,
      'docs/ARCHITECTURE.md': '# Architecture\n\nFive crates and what each one owns.\n',
      'docs/DEPLOYMENT.md': '# Deployment\n\nContainer, Helm and reproducible builds.\n',
      'docs/config.contract.json': '{"terrace_contract":1}',
    });

    const result = await collect();
    const payload = payloadOf(result);

    expect(payload.repo).toEqual({
      owner: 'TimSchoenle',
      name: 'Portfolio',
      slug: REPOSITORY,
      branch: BRANCH,
      url: 'https://github.com/TimSchoenle/Portfolio',
      ecosystem: 'cargo',
      manifest: 'Cargo.toml',
      package: 'portfolio-platform',
      description: 'Dioxus fullstack (SSR + hydration) portfolio served by Axum.',
      license: 'LicenseRef-Proprietary',
    });
    expect(payload.release).toEqual({ version: '2.7.1', tag: 'v2.7.1' });
    expect(payload.toolchain).toEqual({ msrv: '1.97', edition: '2024' });
    expect(payload.docs).toEqual([
      { path: 'docs/ARCHITECTURE.md', title: 'Architecture', summary: 'Five crates and what each one owns.' },
      { path: 'docs/DEPLOYMENT.md', title: 'Deployment', summary: 'Container, Helm and reproducible builds.' },
      { path: 'docs/config.contract.json', title: 'docs/config.contract.json', summary: '' },
    ]);

    expect(result.outputs['version']).toBe('2.7.1');
    expect(result.outputs['tag']).toBe('v2.7.1');
    expect(result.outputs['manifest-path']).toBe('Cargo.toml');
  });

  // A workflow output is a line. A payload carrying a raw newline would truncate at the first one.
  it('emits the payload as one line, with newlines inside values escaped', async () => {
    await withFiles({ 'Cargo.toml': CARGO });

    const result = await collect({ extra: JSON.stringify({ configTable: '| a |\n| --- |\n| b |\n' }) });

    expect(result.outputs['variables']).not.toContain('\n');
    expect(payloadOf(result)['configTable']).toBe('| a |\n| --- |\n| b |\n');
  });

  it.each([
    ['package.json', 'package.json', JSON.stringify({ name: 'x', version: '1.4.0', engines: { node: '>=20' } }), 'npm'],
    ['Chart.yaml', 'Chart.yaml', 'name: portfolio\nversion: 5.1.4\nappVersion: v2.7.1\n', 'chart'],
    ['gradle.properties', 'gradle.properties', 'version=1.4.0\njavaVersion=21\n', 'gradle'],
  ])('auto-detects %s', async (_label, file, contents, ecosystem) => {
    await withFiles({ [file]: contents });

    const payload = payloadOf(await collect());

    expect(payload.repo['ecosystem']).toBe(ecosystem);
    expect(payload.repo['manifest']).toBe(file);
  });

  it('prefers an explicit manifest over detection, including one in a subdirectory', async () => {
    await withFiles({
      'Cargo.toml': CARGO,
      'charts/portfolio/Chart.yaml': 'name: portfolio\nversion: 5.1.4\nappVersion: v2.7.1\n',
    });

    const result = await collect({ manifest: 'charts/portfolio/Chart.yaml' });

    expect(result.outputs['version']).toBe('5.1.4');
    expect(payloadOf(result).toolchain).toEqual({ appVersion: 'v2.7.1' });
  });

  it('merges extra over the derived payload without losing the derived half', async () => {
    await withFiles({ 'Cargo.toml': CARGO });

    const payload = payloadOf(
      await collect({
        extra: JSON.stringify({
          repo: { homepage: 'https://tim-schoenle.de' },
          publish: { image: 'timschoenle/portfolio', platforms: ['linux/amd64', 'linux/arm64'] },
        }),
      }),
    );

    expect(payload.repo['homepage']).toBe('https://tim-schoenle.de');
    expect(payload.repo['package']).toBe('portfolio-platform');
    expect(payload['publish']).toEqual({
      image: 'timschoenle/portfolio',
      platforms: ['linux/amd64', 'linux/arm64'],
    });
  });

  it('lets extra correct a derived fact, so a repository need not wait for a release', async () => {
    await withFiles({ 'Cargo.toml': CARGO });

    const payload = payloadOf(await collect({ extra: JSON.stringify({ release: { tag: 'v2.7.1-hotfix' } }) }));

    expect(payload.release).toEqual({ version: '2.7.1', tag: 'v2.7.1-hotfix' });
  });

  // The property render-template's check mode depends on: same commit, same payload, every time.
  it('produces a byte-identical payload on a second run', async () => {
    await withFiles({
      'Cargo.toml': CARGO,
      'docs/A.md': '# A\n\nFirst.\n',
      'docs/B.md': '# B\n\nSecond.\n',
    });

    const first = await collect();
    const second = await collect();

    expect(second.outputs['variables']).toBe(first.outputs['variables']);
  });

  it('yields an empty docs index when the directory does not exist, rather than failing', async () => {
    await withFiles({ 'Cargo.toml': CARGO });

    expect(payloadOf(await collect()).docs).toEqual([]);
  });

  it('applies a tag prefix, and an empty prefix leaves the bare version', async () => {
    await withFiles({ 'Cargo.toml': CARGO });

    expect((await collect({ 'tag-prefix': 'release-' })).outputs['tag']).toBe('release-2.7.1');
    expect((await collect({ 'tag-prefix': '' })).outputs['tag']).toBe('2.7.1');
  });

  it.each([
    ['no manifest in the workspace', {}, {}],
    ['a manifest form it cannot read', { 'pyproject.toml': '[project]\n' }, { manifest: 'pyproject.toml' }],
    ['a manifest that does not exist', { 'Cargo.toml': CARGO }, { manifest: 'apps/web/Cargo.toml' }],
    ['a virtual workspace manifest', { 'Cargo.toml': '[workspace]\nmembers = ["crates/*"]\n' }, {}],
    ['a manifest with no version', { 'Cargo.toml': '[package]\nname = "x"\n' }, {}],
    ['extra that is not JSON', { 'Cargo.toml': CARGO }, { extra: '{not json}' }],
    ['extra that is not an object', { 'Cargo.toml': CARGO }, { extra: '["a"]' }],
    ['a prototype-reaching key in extra', { 'Cargo.toml': CARGO }, { extra: '{"__proto__":{"polluted":true}}' }],
    ['a repository that is not owner/name', { 'Cargo.toml': CARGO }, { repository: 'Portfolio' }],
  ])('fails on %s', async (_label, files, inputs) => {
    await withFiles(files as WorkspaceFiles);

    await collect(inputs as ProvidedInputs<ActionInput>, 'failure');
  });

  it.each([
    ['manifest', { manifest: '../outside/Cargo.toml' }],
    ['an absolute manifest', { manifest: '/etc/passwd' }],
    ['docs-dir', { 'docs-dir': '../../etc' }],
  ])('refuses a path that reaches outside the checkout via %s', async (_label, inputs) => {
    await withFiles({ 'Cargo.toml': CARGO });

    await collect(inputs as ProvidedInputs<ActionInput>, 'failure');
  });
});
