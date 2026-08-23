import { describe, expect, it } from 'vitest';

import { RepositoryFormatError } from './errors.js';
import { buildPayload, parseRepository, serializePayload } from './payload.js';

import type { ManifestFacts } from './manifest.js';
import type { PayloadRequest } from './payload.js';

const CARGO: ManifestFacts = {
  kind: 'cargo',
  name: 'portfolio-platform',
  version: '2.7.1',
  description: 'Dioxus fullstack portfolio served by Axum.',
  license: 'LicenseRef-Proprietary',
  toolchain: { msrv: '1.97', edition: '2024' },
};

function request(overrides: Partial<PayloadRequest> = {}): PayloadRequest {
  return {
    repository: { owner: 'TimSchoenle', name: 'Portfolio' },
    branch: 'main',
    manifestPath: 'Cargo.toml',
    manifest: CARGO,
    docs: [{ path: 'docs/DEPLOYMENT.md', title: 'Deployment', summary: 'Container and Helm.' }],
    tagPrefix: 'v',
    extra: {},
    ...overrides,
  };
}

describe('parseRepository', () => {
  it('splits owner and name', () => {
    expect(parseRepository('TimSchoenle/Portfolio')).toEqual({ owner: 'TimSchoenle', name: 'Portfolio' });
  });

  it('tolerates surrounding whitespace', () => {
    expect(parseRepository('  a/b  ')).toEqual({ owner: 'a', name: 'b' });
  });

  it.each([
    ['an empty value', ''],
    ['no slash', 'Portfolio'],
    ['an empty owner', '/Portfolio'],
    ['an empty name', 'TimSchoenle/'],
    ['a third segment', 'a/b/c'],
    ['embedded whitespace', 'a /b'],
  ])('refuses %s', (_label, value) => {
    expect(() => parseRepository(value)).toThrow(RepositoryFormatError);
  });
});

describe('buildPayload', () => {
  it('assembles the derived payload', () => {
    expect(buildPayload(request())).toEqual({
      repo: {
        owner: 'TimSchoenle',
        name: 'Portfolio',
        slug: 'TimSchoenle/Portfolio',
        branch: 'main',
        url: 'https://github.com/TimSchoenle/Portfolio',
        ecosystem: 'cargo',
        manifest: 'Cargo.toml',
        package: 'portfolio-platform',
        description: 'Dioxus fullstack portfolio served by Axum.',
        license: 'LicenseRef-Proprietary',
      },
      release: { version: '2.7.1', tag: 'v2.7.1' },
      toolchain: { msrv: '1.97', edition: '2024' },
      docs: [{ path: 'docs/DEPLOYMENT.md', title: 'Deployment', summary: 'Container and Helm.' }],
    });
  });

  // Strict mode fails on an undefined reference, which is the signal wanted here.
  it('omits a fact the manifest does not carry rather than emitting it empty', () => {
    const payload = buildPayload(request({ manifest: { kind: 'npm', version: '1.0.0', toolchain: {} } }));

    expect(payload['repo']).not.toHaveProperty('description');
    expect(payload['repo']).not.toHaveProperty('license');
    expect(payload['repo']).not.toHaveProperty('package');
  });

  it('omits a field the manifest carries as an empty string', () => {
    const payload = buildPayload(request({ manifest: { ...CARGO, description: '' } }));

    expect(payload['repo']).not.toHaveProperty('description');
  });

  it('applies the tag prefix', () => {
    expect(buildPayload(request({ tagPrefix: 'release-' }))['release']).toEqual({
      version: '2.7.1',
      tag: 'release-2.7.1',
    });
  });

  it('makes the tag the bare version when the prefix is empty', () => {
    expect(buildPayload(request({ tagPrefix: '' }))['release']).toMatchObject({ tag: '2.7.1' });
  });

  it('merges extra over the derived half', () => {
    const payload = buildPayload(
      request({
        extra: { publish: { image: 'timschoenle/portfolio' }, repo: { homepage: 'https://tim-schoenle.de' } },
      }),
    );

    expect(payload['publish']).toEqual({ image: 'timschoenle/portfolio' });
    expect(payload['repo']).toMatchObject({ homepage: 'https://tim-schoenle.de', name: 'Portfolio' });
  });

  // The escape hatch that lets a repository correct a fact without a release of this action.
  it('lets extra override a derived fact', () => {
    const payload = buildPayload(request({ extra: { release: { tag: 'v2.7.1-hotfix' } } }));

    expect(payload['release']).toEqual({ version: '2.7.1', tag: 'v2.7.1-hotfix' });
  });

  it('copies the docs entries rather than sharing them', () => {
    const docs = [{ path: 'docs/A.md', title: 'A', summary: '' }];
    const payload = buildPayload(request({ docs }));

    expect((payload['docs'] as unknown[])[0]).not.toBe(docs[0]);
  });

  it('reports the manifest it read, so a template can name it', () => {
    expect(buildPayload(request({ manifestPath: 'charts/portfolio/Chart.yaml' }))['repo']).toMatchObject({
      manifest: 'charts/portfolio/Chart.yaml',
    });
  });
});

describe('serializePayload', () => {
  it('emits one line, because a workflow output is a line', () => {
    const serialized = serializePayload(buildPayload(request()));

    expect(serialized).not.toContain('\n');
    expect(JSON.parse(serialized)).toEqual(buildPayload(request()));
  });

  // A pre-rendered Markdown table arrives through `extra` carrying newlines.
  it('escapes a newline inside a value rather than emitting it', () => {
    const serialized = serializePayload(buildPayload(request({ extra: { table: '| a |\n| --- |\n' } })));

    expect(serialized).not.toContain('\n');
    expect(JSON.parse(serialized).table).toBe('| a |\n| --- |\n');
  });
});
