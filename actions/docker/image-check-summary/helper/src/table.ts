/**
 * The summary comment: one table row per image, rendered from validated fragments.
 */
import type { ImageFragment } from './fragment.js';

/** Bytes in one MiB, matching `docker/image-check`. */
const BYTES_PER_MIB = 1_048_576;

function sizeCell(fragment: ImageFragment): string {
  const mib = fragment.sizeBytes / BYTES_PER_MIB;
  const size = mib.toFixed(1);

  return fragment.warningMib > 0 && mib > fragment.warningMib ? `${size} (above ${fragment.warningMib})` : size;
}

/**
 * Renders the table, sorted as given.
 *
 * When every leg scanned at the same severities they are named once, under the table. When they
 * differ, each count carries its own, since "3" means something different at `CRITICAL` than at
 * `CRITICAL,HIGH,MEDIUM`.
 */
export function renderTable(fragments: readonly ImageFragment[]): string {
  const severities = new Set(fragments.map((fragment) => fragment.severity));
  const uniform = severities.size === 1;

  const rows = fragments.map((fragment) => {
    const findings = uniform ? String(fragment.findings) : `${fragment.findings} at ${fragment.severity}`;

    return `| \`${fragment.platform}\` | ${sizeCell(fragment)} | ${findings} |`;
  });

  const lines = [
    '**Docker images**',
    '',
    '| Platform | Size (MiB, uncompressed) | Trivy findings |',
    '| --- | --- | --- |',
    ...rows,
  ];

  if (uniform) {
    lines.push('', `Trivy findings at ${[...severities][0]}.`);
  }

  return lines.join('\n');
}
