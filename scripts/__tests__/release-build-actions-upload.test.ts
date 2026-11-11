import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const ACTION_FILE = fileURLToPath(new URL('../../actions/release/build-actions/action.yaml', import.meta.url));

interface Step {
  readonly uses?: string;
  readonly with?: Record<string, unknown>;
}

describe('release/build-actions upload step', () => {
  // upload-artifact skips every path with a dot-prefixed segment unless hidden files are included, so
  // the bundles of a build directory such as .github/actions/x would be dropped while the manifest
  // still lists them. The runner round trip in `.github/verify/release-build-actions.yaml` exercises this; this test keeps
  // the setting from regressing where that job does not run.
  it('uploads files under dot-prefixed directories', () => {
    const manifest = parse(fs.readFileSync(ACTION_FILE, 'utf8')) as { runs: { steps: Step[] } };
    const uploads = manifest.runs.steps.filter((step) => step.uses?.startsWith('actions/upload-artifact@'));

    expect(uploads).toHaveLength(1);
    expect(uploads[0]?.with?.['include-hidden-files']).toBe(true);
  });
});
