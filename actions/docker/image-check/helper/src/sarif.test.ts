import { describe, expect, it } from 'vitest';

import { SarifError } from './errors.js';
import { countSarifResults, countSarifText } from './sarif.js';

describe('countSarifResults', () => {
  it('counts nothing in a run with an empty results array', () => {
    expect(countSarifResults({ runs: [{ results: [] }] })).toBe(0);
  });

  it('counts nothing in a run that omits results, as Trivy does for a clean image', () => {
    expect(countSarifResults({ runs: [{ tool: {} }] })).toBe(0);
  });

  it('counts nothing in a log with no runs', () => {
    expect(countSarifResults({ runs: [] })).toBe(0);
  });

  it('sums the results of several runs', () => {
    expect(countSarifResults({ runs: [{ results: [{}, {}] }, { results: [] }, { results: [{}] }] })).toBe(3);
  });

  // A broken scan read as zero findings would pass the very gate meant to stop the image.
  it.each([
    ['a file with no runs key', { version: '2.1.0' }],
    ['a runs value that is not an array', { runs: {} }],
    ['a run that is not an object', { runs: [null] }],
    ['results that are not an array', { runs: [{ results: 3 }] }],
    ['an array at the top level', []],
  ])('refuses %s', (_case, log) => {
    expect(() => countSarifResults(log)).toThrow(SarifError);
  });
});

describe('countSarifText', () => {
  it('parses and counts', () => {
    expect(countSarifText('{"runs":[{"results":[{"ruleId":"CVE-1"}]}]}')).toBe(1);
  });

  it('refuses text that is not JSON', () => {
    expect(() => countSarifText('')).toThrow('not valid JSON');
  });
});
