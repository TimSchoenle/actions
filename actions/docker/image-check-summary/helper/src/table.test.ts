import { describe, expect, it } from 'vitest';

import { renderTable } from './table.js';

import type { ImageFragment } from './fragment.js';

const MIB = 1_048_576;

const AMD64: ImageFragment = {
  platform: 'linux/amd64',
  image: 'app:test',
  sizeBytes: 91_645_132,
  warningMib: 150,
  findings: 3,
  severity: 'CRITICAL,HIGH',
};

const ARM64: ImageFragment = { ...AMD64, platform: 'linux/arm64', sizeBytes: 162 * MIB };

describe('renderTable', () => {
  it('names a shared severity once, under the table', () => {
    expect(renderTable([AMD64, ARM64])).toMatchInlineSnapshot(`
      "**Docker images**

      | Platform | Size (MiB, uncompressed) | Trivy findings |
      | --- | --- | --- |
      | \`linux/amd64\` | 87.4 | 3 |
      | \`linux/arm64\` | 162.0 (above 150) | 3 |

      Trivy findings at CRITICAL,HIGH."
    `);
  });

  it('names the severity in each cell when the legs scanned at different ones', () => {
    expect(renderTable([AMD64, { ...ARM64, severity: 'CRITICAL', findings: 1 }])).toMatchInlineSnapshot(`
      "**Docker images**

      | Platform | Size (MiB, uncompressed) | Trivy findings |
      | --- | --- | --- |
      | \`linux/amd64\` | 87.4 | 3 at CRITICAL,HIGH |
      | \`linux/arm64\` | 162.0 (above 150) | 1 at CRITICAL |"
    `);
  });

  it('marks nothing when a leg had the warning disabled', () => {
    expect(renderTable([{ ...ARM64, warningMib: 0 }])).toContain('| `linux/arm64` | 162.0 | 3 |');
  });
});
