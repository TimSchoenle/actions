import { describe, expect, it } from 'vitest';

import { errorMessage, toError } from './errors.js';

describe('errorMessage', () => {
  it('reads the message of an Error', () => {
    expect(errorMessage(new Error('boom'))).toBe('boom');
  });

  it('renders a thrown non-Error rather than dropping it', () => {
    expect(errorMessage('boom')).toBe('boom');
    expect(errorMessage(42)).toBe('42');
    expect(errorMessage(undefined)).toBe('undefined');
  });
});

describe('toError', () => {
  it('passes an Error through unchanged, preserving its type', () => {
    const error = new TypeError('boom');

    expect(toError(error)).toBe(error);
  });

  it('wraps a thrown non-Error', () => {
    const error = toError('boom');

    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe('boom');
  });
});
