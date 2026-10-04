import { describe, expect, it } from 'vitest';

import { BYTES_PER_MIB } from './gates.js';
import { renderComment, renderStepSummary, sizeCell, toFragment } from './render.js';

import type { ImageResult } from './render.js';

const LINK = 'https://github.com/acme/app/security/code-scanning?query=pr%3A7';

const AMD64: ImageResult = {
  image: 'app:test',
  platform: 'linux/amd64',
  sizeBytes: 91_645_132,
  warningMib: 150,
  limitMib: 0,
  severity: 'CRITICAL,HIGH',
  findings: 3,
};

describe('renderComment', () => {
  it('renders an image under its warning threshold', () => {
    expect(renderComment(AMD64, LINK)).toMatchInlineSnapshot(`
      "**Docker image** \`linux/amd64\`: 87.4 MiB (uncompressed), warning above 150 MiB.
      Trivy: 3 findings at CRITICAL,HIGH. [Code scanning](https://github.com/acme/app/security/code-scanning?query=pr%3A7)"
    `);
  });

  it('renders an image above its warning threshold', () => {
    expect(renderComment({ ...AMD64, sizeBytes: 162 * BYTES_PER_MIB }, LINK)).toMatchInlineSnapshot(`
      "**Docker image** \`linux/amd64\`: 162.0 MiB (uncompressed), above the 150 MiB warning.
      Trivy: 3 findings at CRITICAL,HIGH. [Code scanning](https://github.com/acme/app/security/code-scanning?query=pr%3A7)"
    `);
  });

  it('names the image when there is no platform, and links nothing when no SARIF was uploaded', () => {
    expect(renderComment({ ...AMD64, platform: '', findings: 1 }, undefined)).toMatchInlineSnapshot(`
      "**Docker image** \`app:test\`: 87.4 MiB (uncompressed), warning above 150 MiB.
      Trivy: 1 finding at CRITICAL,HIGH."
    `);
  });

  it('states both thresholds, and drops a disabled warning', () => {
    expect(renderComment({ ...AMD64, warningMib: 0, limitMib: 80, findings: 0 }, undefined)).toMatchInlineSnapshot(`
      "**Docker image** \`linux/amd64\`: 87.4 MiB (uncompressed), above the 80 MiB limit.
      Trivy: no findings at CRITICAL,HIGH."
    `);
  });

  it('says nothing about thresholds when both are disabled', () => {
    expect(renderComment({ ...AMD64, warningMib: 0 }, undefined).split('\n')[0]).toBe(
      '**Docker image** `linux/amd64`: 87.4 MiB (uncompressed).',
    );
  });
});

describe('renderStepSummary', () => {
  it('renders one table row', () => {
    expect(renderStepSummary(AMD64)).toMatchInlineSnapshot(`
      "**Docker image check**

      | Image | Platform | Size (MiB, uncompressed) | Trivy findings |
      | --- | --- | --- | --- |
      | \`app:test\` | \`linux/amd64\` | 87.4 | 3 at CRITICAL,HIGH |
      "
    `);
  });

  it('marks a missing platform with a dash', () => {
    expect(renderStepSummary({ ...AMD64, platform: '' })).toContain('| `app:test` | — | 87.4 |');
  });
});

describe('sizeCell', () => {
  it('names the warning crossed', () => {
    expect(sizeCell(162 * BYTES_PER_MIB, 150)).toBe('162.0 (above 150)');
  });

  it('names the limit over the warning when both are crossed', () => {
    expect(sizeCell(400 * BYTES_PER_MIB, 150, 300)).toBe('400.0 (above the 300 limit)');
  });

  it('is the bare size under both', () => {
    expect(sizeCell(BYTES_PER_MIB, 150, 300)).toBe('1.0');
  });
});

describe('toFragment', () => {
  it('carries exactly the fields image-check-summary reads', () => {
    expect(toFragment(AMD64)).toEqual({
      version: 1,
      platform: 'linux/amd64',
      image: 'app:test',
      size_bytes: 91_645_132,
      warning_mib: 150,
      findings: 3,
      severity: 'CRITICAL,HIGH',
    });
  });
});
