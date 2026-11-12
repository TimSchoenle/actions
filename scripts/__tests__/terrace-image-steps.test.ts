import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import { ROOT_DIR } from '../lib/utils.js';

/**
 * The step order of `actions/terrace/image`, which is its contract with the registry: nothing is
 * published for an image whose signer the caller did not accept. Lives here rather than beside the
 * action, so a change to it does not release the action.
 */

interface Step {
  readonly name: string;
  readonly if?: string;
  readonly run?: string;
}

const steps = (
  parse(fs.readFileSync(path.join(ROOT_DIR, 'actions/terrace/image/action.yaml'), 'utf8')) as {
    runs: { steps: Step[] };
  }
).runs.steps;

function indexOf(name: string): number {
  const index = steps.findIndex((step) => step.name === name);
  if (index === -1) {
    throw new Error(`terrace/image has no step named ${name}`);
  }

  return index;
}

describe('terrace/image step order', () => {
  // S16e: the referrer was attached and signed before the final verification checked the signer.
  it('verifies the signer before it attaches, signs or reads anything', () => {
    const signature = indexOf('Verify the image signature');

    expect(steps[signature]?.if).toBe("${{ inputs.signer != '' }}");
    expect(steps[signature]?.run).toContain('--certificate-identity-regexp "$SIGNER"');
    for (const later of ['Check the document', 'Attach the document', 'Sign the referrer', 'Verify the image']) {
      expect(indexOf(later), later).toBeGreaterThan(signature);
    }
  });
});
