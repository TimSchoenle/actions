import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { CHECK_IDS, runChecks } from './checks.js';
import { LabelRenderingError } from './errors.js';
import { parseLabelLines } from './labels.js';
import { REGION_BEGIN, REGION_END } from './dockerfile-region.js';
import { resolveOptions } from './options.js';

import type { CheckContext, CheckId, Finding } from './checks.js';
import type { ImageInspector } from './docker.js';
import type { RawInputs } from './options.js';
import type { Renderings } from './generator.js';

const WORKSPACE = path.resolve('/workspace');
const IMAGE = 'myservice:test';
const EMBEDDED_PATH = '/config/contract.json';

const LABEL_BLOCK = [
  REGION_BEGIN,
  'LABEL dev.terrace.config.contract.version="1"',
  'LABEL dev.terrace.config.contract.path="/config/contract.json"',
  REGION_END,
  '',
].join('\n');

const CONTRACT = '{\n  "terrace_contract": 1,\n  "keys": []\n}\n';

const LABELS = 'dev.terrace.config.contract.version=1\ndev.terrace.config.contract.path=/config/contract.json\n';

const RENDERINGS: Renderings = { contract: CONTRACT, labels: LABELS, dockerfile: LABEL_BLOCK };

const IMAGE_LABELS: Record<string, string> = {
  'dev.terrace.config.contract.version': '1',
  'dev.terrace.config.contract.path': '/config/contract.json',
  'org.opencontainers.image.title': 'myservice',
};

const DEFAULTS: RawInputs = {
  source_directory: '.',
  example: 'config-schema',
  package: '',
  features: '',
  dockerfile: 'Dockerfile',
  contract: 'docs/config.contract.json',
  image: IMAGE,
  contract_path: EMBEDDED_PATH,
};

interface Scenario {
  /** Files present, keyed by their path relative to the workspace. */
  files?: Record<string, string>;
  /** What `docker inspect` answers with. */
  imageLabels?: unknown;
  /** Content the embedded contract is copied out as, or `undefined` when nothing is at the path. */
  embedded?: string;
  renderings?: Partial<Renderings>;
  inputs?: Partial<RawInputs>;
}

const DEFAULT_FILES: Record<string, string> = {
  Dockerfile: `FROM scratch\n${LABEL_BLOCK}`,
  'docs/config.contract.json': CONTRACT,
};

/** A temporary directory the embedded copy is written into; nothing real is created for it. */
const TEMP = path.resolve('/runner-temp');

function contextFor(scenario: Scenario): CheckContext {
  const files = new Map(
    Object.entries(scenario.files ?? DEFAULT_FILES).map(([relative, content]) => [
      path.resolve(WORKSPACE, relative),
      content,
    ]),
  );
  const renderings = { ...RENDERINGS, ...scenario.renderings };

  const inspector: ImageInspector = {
    inspectLabels: () => Promise.resolve('imageLabels' in scenario ? scenario.imageLabels : IMAGE_LABELS),
    copyOut: (_reference, _pathInImage, destination) => {
      if (scenario.embedded === undefined) {
        return Promise.resolve(false);
      }

      files.set(path.resolve(destination), scenario.embedded);

      return Promise.resolve(true);
    },
  };

  return {
    options: resolveOptions({ ...DEFAULTS, ...scenario.inputs }, WORKSPACE),
    renderings,
    labels: parseLabelLines(renderings.labels),
    readFile: (absolutePath) => Promise.resolve(files.get(path.resolve(absolutePath))),
    inspector,
    tempDirectory: TEMP,
  };
}

function run(scenario: Scenario = {}) {
  return runChecks(contextFor({ embedded: CONTRACT, ...scenario }));
}

function checksOf(findings: readonly Finding[]): CheckId[] {
  return findings.map((finding) => finding.check);
}

describe('runChecks', () => {
  it('finds nothing wrong with a repository and image that agree', async () => {
    const report = await run();

    expect(report.findings).toEqual([]);
    expect(report.ran).toEqual([...CHECK_IDS]);
    expect(report.skipped).toEqual([]);
  });

  // A check is skipped by emptying its input, and by nothing else. This is what lets a repository
  // with no image, or no committed contract, take only the half that applies to it.
  it.each([
    { name: 'no dockerfile', inputs: { dockerfile: '' }, skipped: ['dockerfile-block'] },
    { name: 'no committed contract', inputs: { contract: '' }, skipped: ['committed-contract'] },
    { name: 'no image', inputs: { image: '' }, skipped: ['image-labels', 'embedded-contract'] },
    {
      name: 'nothing but the generator',
      inputs: { dockerfile: '', contract: '', image: '' },
      skipped: [...CHECK_IDS],
    },
  ])('skips the checks whose input is empty: $name', async ({ inputs, skipped }) => {
    const report = await run({ inputs });

    expect(report.skipped).toEqual(skipped);
    expect(report.ran).toEqual(CHECK_IDS.filter((id) => !skipped.includes(id)));
    expect(report.findings).toEqual([]);
  });

  describe('the Dockerfile block', () => {
    it('catches a label dropped from the committed block', async () => {
      const files = {
        ...DEFAULT_FILES,
        Dockerfile: `FROM scratch\n${LABEL_BLOCK.replace('LABEL dev.terrace.config.contract.path="/config/contract.json"\n', '')}`,
      };

      const report = await run({ files });

      expect(checksOf(report.findings)).toEqual(['dockerfile-block']);
      expect(report.findings[0].message).toContain('- LABEL dev.terrace.config.contract.path');
    });

    it('catches a renamed prefix', async () => {
      const files = {
        ...DEFAULT_FILES,
        Dockerfile: `FROM scratch\n${LABEL_BLOCK.replaceAll('dev.terrace', 'dev.other')}`,
      };

      expect(checksOf((await run({ files })).findings)).toEqual(['dockerfile-block']);
    });

    // An unrun check is not a passing image. A Dockerfile with no region is a finding, not a skip.
    it.each([
      { name: 'an absent Dockerfile', dockerfile: undefined, expected: /does not exist/ },
      { name: 'a Dockerfile with no marked region', dockerfile: 'FROM scratch\nLABEL a=1\n', expected: /carries no/ },
      {
        name: 'a marked region with nothing in it',
        dockerfile: `FROM scratch\n${REGION_BEGIN}\n${REGION_END}\n`,
        expected: /nothing in it/,
      },
    ])('refuses $name rather than skipping it', async ({ dockerfile, expected }) => {
      const files = { ...DEFAULT_FILES };

      if (dockerfile === undefined) {
        delete files['Dockerfile'];
      } else {
        files['Dockerfile'] = dockerfile;
      }

      const report = await run({ files });

      expect(checksOf(report.findings)).toEqual(['dockerfile-block']);
      expect(report.findings[0].message).toMatch(expected);
      expect(report.ran).toContain('dockerfile-block');
    });

    it('anchors its annotation to the file, relative to the workspace', async () => {
      const report = await run({
        inputs: { source_directory: 'services/api', dockerfile: 'Dockerfile', contract: '' },
        files: { 'services/api/Dockerfile': 'FROM scratch\n' },
      });

      expect(report.findings[0].file).toBe('services/api/Dockerfile');
    });
  });

  describe('the committed contract', () => {
    it('catches drift against what the types produce', async () => {
      const files = {
        ...DEFAULT_FILES,
        'docs/config.contract.json': '{\n  "terrace_contract": 1,\n  "keys": ["a"]\n}\n',
      };
      const report = await run({ files });

      expect(checksOf(report.findings)).toEqual(['committed-contract']);
      expect(report.findings[0].message).toContain('--format contract');
    });

    it('refuses an absent contract, telling the caller how to create it', async () => {
      const files = { ...DEFAULT_FILES };
      delete files['docs/config.contract.json'];

      const report = await run({ files });

      expect(report.findings[0].message).toMatch(/does not exist.*commit the result/s);
    });

    it('is unmoved by a CRLF checkout', async () => {
      const files = { ...DEFAULT_FILES, 'docs/config.contract.json': CONTRACT.replaceAll('\n', '\r\n') };

      expect((await run({ files })).findings).toEqual([]);
    });
  });

  describe('the image labels', () => {
    it('ignores labels the contract does not publish', async () => {
      expect((await run({ imageLabels: { ...IMAGE_LABELS, 'com.example.other': 'x' } })).findings).toEqual([]);
    });

    it('reports every fault rather than the first', async () => {
      const report = await run({ imageLabels: {} });

      expect(checksOf(report.findings)).toEqual(['image-labels', 'image-labels']);
    });

    it('catches a build argument that failed to interpolate', async () => {
      const report = await run({
        imageLabels: { ...IMAGE_LABELS, 'dev.terrace.config.contract.version': '${VERSION}' },
      });

      expect(report.findings[0].message).toContain('${VERSION}');
    });

    it('reads an image with no labels at all as three missing ones, not as nothing to compare', async () => {
      const report = await run({ imageLabels: null });

      expect(checksOf(report.findings)).toEqual(['image-labels', 'image-labels']);
    });

    it('refuses an answer that is not a label set', async () => {
      await expect(run({ imageLabels: ['a'] })).rejects.toThrow(LabelRenderingError);
    });

    it('names the image in every annotation, since a job may check several', async () => {
      const report = await run({ imageLabels: {} });

      for (const finding of report.findings) {
        expect(finding.message.startsWith(`${IMAGE}: `)).toBe(true);
      }
    });
  });

  describe('the embedded contract', () => {
    it('accepts a copy carrying build metadata the committed one does not', async () => {
      const embedded = JSON.stringify({ terrace_contract: 1, version: '1.4.0', revision: 'abc' });

      expect((await run({ embedded })).findings).toEqual([]);
    });

    it('reports nothing being at the path the label advertises', async () => {
      const report = await run({ embedded: undefined });

      expect(checksOf(report.findings)).toEqual(['embedded-contract']);
      expect(report.findings[0].message).toContain('dev.terrace.config.contract.path');
    });

    it('reports a file at the path that is not a contract', async () => {
      const report = await run({ embedded: '<html>404</html>' });

      expect(report.findings[0].message).toContain('is not a terrace-config contract');
    });
  });

  // A run that fails on the Dockerfile and never looks at the image is a second round trip through
  // a pipeline that already took minutes.
  it('runs every enabled check even after one has already failed', async () => {
    const report = await run({
      files: { ...DEFAULT_FILES, Dockerfile: 'FROM scratch\n' },
      imageLabels: {},
      embedded: 'not a contract',
    });

    expect(report.ran).toEqual([...CHECK_IDS]);
    expect(checksOf(report.findings)).toEqual([
      'dockerfile-block',
      'image-labels',
      'image-labels',
      'embedded-contract',
    ]);
  });
});
