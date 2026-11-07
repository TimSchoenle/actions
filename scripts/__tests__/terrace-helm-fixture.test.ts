import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import { ROOT_DIR } from '../lib/utils.js';

/**
 * Contract between the terrace/helm-* fixture's image pins and the contracts vendored beside them.
 *
 * The sync-pull job in verify-action-terrace-helm-sync.yaml pulls each contract from the image its
 * chart pins and fails when that changes a vendored file. A pin moved without its contract (as a
 * Renovate bump of values.yaml does) is only caught there, over the network, after the merge. This
 * suite catches it offline, from the files alone: every pin must be by digest, and every vendored
 * contract must have been fetched from that exact image and digest.
 */

const FIXTURE_DIR = path.join(ROOT_DIR, '.github', 'testdata', 'terrace-helm');
const CHARTS_DIR = path.join(FIXTURE_DIR, 'charts');
const FIXTURE_GLOB = '.github/testdata/terrace-helm/**';
const DEFAULT_REGISTRY = 'docker.io';

interface ImageValues {
  registry?: string;
  repository?: string;
  tag?: string;
}

interface Declaration {
  documents?: { name: string; image?: unknown }[];
}

interface VendoredContract {
  source?: { image?: string; digest?: string };
}

function readFixtureFile(...segments: string[]): string {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- paths under a fixed fixture directory
  return fs.readFileSync(path.join(...segments), 'utf8');
}

// Sorted so failures are reported in the same order on every platform.
const charts = fs
  .readdirSync(CHARTS_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

describe('terrace/helm-* fixture', () => {
  it('finds the charts this suite is meant to cover', () => {
    expect(charts.length).toBeGreaterThan(0);
  });

  describe.each(charts)('%s', (chart) => {
    const chartDir = path.join(CHARTS_DIR, chart);
    const values = parse(readFixtureFile(chartDir, 'values.yaml')) as { image?: ImageValues };
    const declaration = (parse(readFixtureFile(chartDir, 'config-contract.yaml')) ?? {}) as Declaration;
    const documents = declaration.documents ?? [];

    it('declares at least one document', () => {
      expect(documents.length).toBeGreaterThan(0);
    });

    it('pins its image by digest, so the image cannot move without a commit', () => {
      expect(values.image?.tag, 'image.tag').toMatch(/^[^@\s]+@sha256:[a-f0-9]{64}$/);
    });

    it.each(documents.map((document) => [document.name, document] as const))(
      'vendors the contract of document %s from the pinned image and digest',
      (name, document) => {
        // Only the default image at `image` is read below; a document naming its own image needs this
        // suite extended rather than silently checked against the wrong pin.
        expect(document.image, `document '${name}' names its own image`).toBeUndefined();

        const image = values.image ?? {};
        const registry = image.registry === undefined || image.registry === '' ? DEFAULT_REGISTRY : image.registry;
        const digest = image.tag?.split('@')[1];
        const contract = JSON.parse(readFixtureFile(chartDir, 'contracts', `${name}.json`)) as VendoredContract;

        expect(contract.source?.image, `contracts/${name}.json source.image`).toBe(`${registry}/${image.repository}`);
        expect(
          contract.source?.digest,
          `contracts/${name}.json was fetched from another digest than values.yaml pins; move both together`,
        ).toBe(digest);
      },
    );
  });

  it('is excluded from Renovate, which would move a pin without its contract', () => {
    const config = JSON.parse(readFixtureFile(ROOT_DIR, 'renovate.json')) as {
      packageRules?: { matchFileNames?: string[]; enabled?: boolean }[];
    };

    const rule = config.packageRules?.find((candidate) => candidate.matchFileNames?.includes(FIXTURE_GLOB));
    expect(rule?.enabled, `a packageRule disabling ${FIXTURE_GLOB}`).toBe(false);
  });
});
