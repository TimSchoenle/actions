import { describe, expect, it } from 'vitest';

import { BYTES_PER_MIB, evaluateGates, formatMib, isAbove } from './gates.js';

const MIB_150 = 150 * BYTES_PER_MIB;

function gates(sizeBytes: number, overrides: Partial<Parameters<typeof evaluateGates>[0]> = {}) {
  return evaluateGates({ sizeBytes, warningMib: 150, limitMib: 0, findings: 0, failOnFindings: false, ...overrides });
}

describe('evaluateGates', () => {
  describe('the warning threshold', () => {
    it('passes an image below it', () => {
      expect(gates(MIB_150 - 1).overWarning).toBe(false);
    });

    it('passes an image exactly at it', () => {
      expect(gates(MIB_150).overWarning).toBe(false);
    });

    // One byte past renders as 150.0, which is why the comparison never uses the rounded figure.
    it('warns on an image one byte above it', () => {
      expect(formatMib(MIB_150 + 1)).toBe('150.0');
      expect(gates(MIB_150 + 1).overWarning).toBe(true);
    });

    it('is disabled at 0', () => {
      expect(gates(Number.MAX_SAFE_INTEGER, { warningMib: 0 }).overWarning).toBe(false);
    });
  });

  describe('the size limit', () => {
    it('is disabled at 0, the default', () => {
      expect(gates(Number.MAX_SAFE_INTEGER).overLimit).toBe(false);
    });

    it('passes below and at the limit', () => {
      expect(gates(MIB_150 - 1, { limitMib: 150 }).overLimit).toBe(false);
      expect(gates(MIB_150, { limitMib: 150 }).overLimit).toBe(false);
    });

    it('fails above the limit', () => {
      expect(gates(MIB_150 + 1, { limitMib: 150 }).overLimit).toBe(true);
    });

    it('accepts a fractional limit', () => {
      expect(gates(150.5 * BYTES_PER_MIB, { limitMib: 150.5 }).overLimit).toBe(false);
      expect(gates(150.5 * BYTES_PER_MIB + 1, { limitMib: 150.5 }).overLimit).toBe(true);
    });
  });

  describe('the findings gate', () => {
    it('never fails while advisory, however many findings', () => {
      expect(gates(0, { findings: 99 }).failsOnFindings).toBe(false);
    });

    it('passes zero findings when enforced', () => {
      expect(gates(0, { findings: 0, failOnFindings: true }).failsOnFindings).toBe(false);
    });

    it('fails a single finding when enforced', () => {
      expect(gates(0, { findings: 1, failOnFindings: true }).failsOnFindings).toBe(true);
    });
  });
});

describe('isAbove', () => {
  it('treats a zero threshold as disabled, not as "anything above zero"', () => {
    expect(isAbove(1, 0)).toBe(false);
  });
});

describe('formatMib', () => {
  it.each([
    [0, '0.0'],
    [BYTES_PER_MIB, '1.0'],
    [91_645_132, '87.4'],
  ])('formats %d bytes as %s', (bytes, expected) => {
    expect(formatMib(bytes)).toBe(expected);
  });
});
