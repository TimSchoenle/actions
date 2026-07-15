import { afterEach, describe, expect, it, vi } from 'vitest';

import { warnOnBunVersionDrift } from '../build-action';

describe('warnOnBunVersionDrift', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // The bundle is only guaranteed to reproduce the committed bytes when built with the pinned Bun,
  // so a mismatch is surfaced — naming both versions — rather than silently trusted.
  it('warns when the running Bun differs from the pinned one', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    expect(warnOnBunVersionDrift('1.3.11', '1.3.14')).toBe(true);
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0][0]).toContain('1.3.11');
    expect(warn.mock.calls[0][0]).toContain('1.3.14');
  });

  it('stays silent when the running Bun matches the pinned one', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    expect(warnOnBunVersionDrift('1.3.14', '1.3.14')).toBe(false);
    expect(warn).not.toHaveBeenCalled();
  });

  // A repository that pins no version cannot have a mismatch, so nothing is reported.
  it('stays silent when no version is pinned', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    expect(warnOnBunVersionDrift('1.3.14', undefined)).toBe(false);
    expect(warn).not.toHaveBeenCalled();
  });
});
