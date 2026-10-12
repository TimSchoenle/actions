/**
 * What the two end-to-end suites of `actions/security/zizmor` share: the helper's location, a SARIF
 * log shaped as zizmor 1.30.1 writes one, the `docker` stub and a reader for annotation properties.
 */
import { fileURLToPath } from 'node:url';

import type { ActionRunResult, StubRule } from 'actions-e2e';

export const HELPER_DIRECTORY = fileURLToPath(new URL('../helper', import.meta.url));

export const IMAGE = `ghcr.io/zizmorcore/zizmor:1.30.1@sha256:${'a'.repeat(64)}`;

export const TOKEN = 'ghs_e2eTokenThatMustNeverBePrinted';

export const BOM = '\uFEFF';

export const WORKFLOW = [
  'name: CI',
  'on: push',
  'permissions: {}',
  'jobs:',
  '  build:',
  '    runs-on: ubuntu-latest',
  '    steps:',
  '      - run: echo ok',
  '',
].join('\n');

/** A SARIF log with one result per severity, as zizmor 1.30.1 writes them. */
export function sarif(...severities: Array<string | undefined>): string {
  const results = severities.map((severity, index) => ({
    ruleId: `zizmor/rule-${index}`,
    level: 'warning',
    message: { text: `finding ${index}` },
    locations: [
      {
        physicalLocation: {
          artifactLocation: { uri: '.github/workflows/ci.yml' },
          region: { startLine: index + 1, startColumn: 1 },
        },
      },
    ],
    properties: severity === undefined ? {} : { 'zizmor/severity': severity, 'zizmor/confidence': 'High' },
  }));

  return JSON.stringify({ version: '2.1.0', runs: [{ tool: { driver: { name: 'zizmor' } }, results }] });
}

/** The `docker` stub: a run answers with `stdout` and `exitCode`, as zizmor in its container would. */
export function dockerRules(rule: Omit<StubRule, 'when'> = { stdout: sarif() }): StubRule[] {
  return [{ when: ['run'], ...rule }];
}

/** Lines of stdout carrying an annotation with a `file` property, as the runner would parse them. */
export function fileAnnotations(result: ActionRunResult<string>, level: 'error' | 'warning'): string[] {
  const files: string[] = [];

  for (const line of result.stdout.split(/\r?\n/)) {
    const match = new RegExp(`^::${level} (?<properties>[^:]*)::`).exec(line);
    const file = match?.groups?.['properties']
      ?.split(',')
      .find((property) => property.startsWith('file='))
      ?.slice('file='.length);

    if (file !== undefined) {
      files.push(file);
    }
  }

  return files;
}
