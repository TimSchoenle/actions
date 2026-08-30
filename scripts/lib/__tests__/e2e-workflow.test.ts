import { describe, expect, it } from 'vitest';

import { PINNED, resolvePins } from '../e2e-workflow.js';

/**
 * The substitution that keeps an extra-jobs fragment from carrying its own copy of a pin.
 *
 * The repository-wide contract — that no fragment on disk writes a ref out in full — lives in
 * `scripts/__tests__/renovate-managers.test.ts`. What is checked here is the mechanism itself: that
 * it rewrites what it should, leaves everything else alone, and refuses a name it cannot resolve
 * rather than emitting a workflow that fails only once a runner reaches the job.
 */
describe('resolvePins', () => {
  it('substitutes a placeholder with the pin it names', () => {
    expect(resolvePins('    - name: Harden Runner\n      uses: pinned:hardenRunner\n')).toBe(
      `    - name: Harden Runner\n      uses: ${PINNED.hardenRunner}\n`,
    );
  });

  it('substitutes every placeholder in a fragment, not just the first', () => {
    const resolved = resolvePins('      uses: pinned:checkout\n      uses: pinned:hardenRunner\n');

    expect(resolved).toContain(PINNED.checkout);
    expect(resolved).toContain(PINNED.hardenRunner);
  });

  it('preserves the indentation the placeholder sat at', () => {
    // The fragment is indented again on the way into the workflow, so a substitution that
    // normalised whitespace would put the step at a depth YAML reads as a different key.
    expect(resolvePins('        uses: pinned:checkout')).toBe(`        uses: ${PINNED.checkout}`);
  });

  it('leaves a local action reference alone', () => {
    const fragment = '      uses: ./actions/helper/verify-branch-name';

    expect(resolvePins(fragment)).toBe(fragment);
  });

  it('leaves a ref written out in full alone', () => {
    // Not this function's job to reject one — `renovate-managers.test.ts` is what fails it, with an
    // explanation. Rewriting it here would hide the pin the contract exists to surface.
    const fragment = `      uses: ${PINNED.checkout}`;

    expect(resolvePins(fragment)).toBe(fragment);
  });

  it('ignores a placeholder that is not the value of a uses key', () => {
    const fragment = '      run: echo pinned:checkout';

    expect(resolvePins(fragment)).toBe(fragment);
  });

  it('returns an empty fragment unchanged', () => {
    expect(resolvePins('')).toBe('');
  });

  it('names the unknown key and the keys that exist when it cannot resolve one', () => {
    expect(() => resolvePins('      uses: pinned:notAPin')).toThrow(/pinned:notAPin/);
    expect(() => resolvePins('      uses: pinned:notAPin')).toThrow(/hardenRunner/);
  });
});
