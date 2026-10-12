import { describe, expect, it } from 'vitest';

import { SarifFormatError } from './errors.js';
import { compareFindings, describeFinding, escapeHtml, isFailing, parseSarif, severityRank } from './gate.js';

import type { Finding } from './gate.js';

function result(severity: string | undefined, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ruleId: 'zizmor/unpinned-uses',
    message: { text: 'action is not pinned to a hash' },
    locations: [
      {
        physicalLocation: {
          artifactLocation: { uri: '.github/workflows/ci.yml' },
          region: { startLine: 7, startColumn: 15 },
        },
      },
    ],
    properties: severity === undefined ? {} : { 'zizmor/severity': severity, 'zizmor/confidence': 'High' },
    ...overrides,
  };
}

function sarif(results: unknown[]): string {
  return JSON.stringify({ version: '2.1.0', runs: [{ tool: { driver: { name: 'zizmor' } }, results }] });
}

function finding(severity: string | undefined, overrides: Partial<Finding> = {}): Finding {
  return { rule: 'r', file: 'f', line: 1, severity, message: 'm', ...overrides };
}

describe('parseSarif', () => {
  it('reduces each result to its rule, file, line, severity and message', () => {
    expect(parseSarif(sarif([result('High')]))).toEqual([
      {
        rule: 'zizmor/unpinned-uses',
        file: '.github/workflows/ci.yml',
        line: 7,
        severity: 'high',
        message: 'action is not pinned to a hash',
      },
    ]);
  });

  it('reads an empty results array as no findings', () => {
    expect(parseSarif(sarif([]))).toEqual([]);
  });

  it('keeps a result whose location, rule or severity is missing, without inventing values', () => {
    expect(parseSarif(sarif([{ properties: { 'zizmor/severity': 7 }, locations: 'nowhere' }]))).toEqual([
      { rule: '(unknown)', file: '(unknown)', line: undefined, severity: undefined, message: '(unknown)' },
    ]);
  });

  it.each([0, -1, 1.5, '7'])('drops a start line of %j, which is not a line number', (startLine) => {
    const [parsed] = parseSarif(
      sarif([
        result('Low', { locations: [{ physicalLocation: { artifactLocation: { uri: 'a' }, region: { startLine } } }] }),
      ]),
    );

    expect(parsed?.line).toBeUndefined();
  });

  it('counts the results of every run', () => {
    const text = JSON.stringify({
      version: '2.1.0',
      runs: [{ results: [result('Low')] }, { results: [result('High')] }],
    });

    expect(parseSarif(text)).toHaveLength(2);
  });

  it.each([
    ['empty', ''],
    ['not JSON', '{"version":'],
    ['an array', '[]'],
    ['another SARIF version', JSON.stringify({ version: '2.0.0', runs: [{ results: [] }] })],
    ['no run', JSON.stringify({ version: '2.1.0', runs: [] })],
    ['a run without results', JSON.stringify({ version: '2.1.0', runs: [{ tool: {} }] })],
    ['a result that is not an object', sarif(['x'])],
  ])('refuses a log that is %s', (_, text) => {
    expect(() => parseSarif(text)).toThrow(SarifFormatError);
  });

  it('is not tricked by __proto__ keys', () => {
    const text = `{"version":"2.1.0","runs":[{"results":[{"__proto__":{"ruleId":"forged"},"properties":{"zizmor/severity":"Low"}}]}]}`;

    expect(parseSarif(text)[0]?.rule).toBe('(unknown)');
  });
});

describe('isFailing', () => {
  it.each([
    ['informational', 'informational', true],
    ['low', 'medium', false],
    ['medium', 'medium', true],
    ['high', 'medium', true],
    ['high', 'none', false],
  ] as const)('%s against %s: %s', (severity, threshold, expected) => {
    expect(isFailing(finding(severity), threshold)).toBe(expected);
  });

  it.each([undefined, 'critical', ''])('fails a severity of %j at every threshold but none', (severity) => {
    expect(isFailing(finding(severity), 'high')).toBe(true);
    expect(isFailing(finding(severity), 'none')).toBe(false);
  });
});

describe('severityRank', () => {
  it('ranks the four severities in order and nothing else', () => {
    expect(['informational', 'low', 'medium', 'high', 'urgent'].map(severityRank)).toEqual([0, 1, 2, 3, undefined]);
  });
});

describe('compareFindings', () => {
  it('lists failing findings first, then by severity, file and line', () => {
    const findings = [
      finding('low', { file: 'b' }),
      finding('high', { file: 'z', line: 9 }),
      finding('high', { file: 'z', line: 2 }),
      finding(undefined, { file: 'a' }),
      finding('medium', { file: 'a' }),
    ];

    expect(findings.sort(compareFindings('medium')).map((f) => `${f.severity ?? '?'}:${f.file}:${f.line}`)).toEqual([
      '?:a:1',
      'high:z:2',
      'high:z:9',
      'medium:a:1',
      'low:b:1',
    ]);
  });
});

describe('escapeHtml', () => {
  it('escapes every character that could open markup or an attribute', () => {
    expect(escapeHtml(`<img src=x onerror="a('b')">&`)).toBe(
      '&lt;img src=x onerror=&quot;a(&#39;b&#39;)&quot;&gt;&amp;',
    );
  });
});

describe('describeFinding', () => {
  it('quotes every part a repository controls, so none can start a line', () => {
    const line = describeFinding(finding('high', { file: 'x\n::error::forged', rule: 'r\r::warning::y', line: 3 }));

    expect(line).not.toMatch(/[\r\n]/);
    expect(line).toBe('high: "r\\r::warning::y" in "x\\n::error::forged" line 3: "m"');
  });

  it('names a finding with no line and no severity', () => {
    expect(describeFinding(finding(undefined, { line: undefined }))).toBe('no severity: "r" in "f": "m"');
  });
});
