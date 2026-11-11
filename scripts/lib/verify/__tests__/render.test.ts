import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import { ROOT_DIR } from '../../utils.js';
import { PINNED } from '../pins.js';
import {
  assignShards,
  jobsBlock,
  renderShard,
  renderTarget,
  renderVerifyWorkflow,
  shardPermissions,
  shardSecrets,
  SUMMARY_JOB_NAME,
  targetGate,
  validateSources,
} from '../render.js';
import { parseSource } from '../source.js';

import type { RenderedTarget } from '../render.js';

function sourceOf(target: string, lines: string[]) {
  return parseSource(`.github/verify/${target.replace('/', '-')}.yaml`, `${[`target: ${target}`, ...lines].join('\n')}\n`);
}

const PERMISSIONS = ['    permissions:', '      contents: read'];

describe('renderTarget', () => {
  it('gates every job on its target and prefixes its display name, changing nothing else', () => {
    const source = sourceOf('common/x', [
      'jobs:',
      '  # A comment that travels with the job.',
      '  first:',
      '    name: First Job',
      '    runs-on: ubuntu-latest',
      ...PERMISSIONS,
      '    steps:',
      '      - name: Hosts',
      '        with:',
      '          allowed-endpoints: >',
      '            github.com:443',
      '            api.github.com:443',
      '  second:',
      '    needs: first',
      '    if: ${{ always() }}',
      ...PERMISSIONS,
    ]);

    const rendered = renderTarget(source, false, ['node_modules']);
    const jobs = (parse(`jobs:\n${rendered.text}`) as { jobs: Record<string, Record<string, unknown>> }).jobs;

    expect(rendered.jobIds).toEqual(['first', 'second']);
    expect(jobs['first']['name']).toBe('Common X: First Job');
    expect(jobs['first']['if']).toBe(`\${{ ${targetGate('common/x')} }}`);
    expect(jobs['second']['name']).toBe('Common X: second');
    expect(jobs['second']['if']).toBe(`\${{ ${targetGate('common/x')} && (always()) }}`);
    // Comments and block scalars are copied as written.
    expect(rendered.text).toContain('  # A comment that travels with the job.\n');
    expect(rendered.text).toContain('          allowed-endpoints: >\n            github.com:443\n            api.github.com:443\n');
  });

  it('puts the generated end-to-end job first', () => {
    const source = sourceOf('common/x', ['e2e:', '  token-permissions:', '    metadata: read', 'jobs:', '  extra:', ...PERMISSIONS]);

    expect(renderTarget(source, true, ['node_modules']).jobIds).toEqual(['e2e-common-x', 'extra']);
  });

  it('quotes a display name that holds a quote', () => {
    const source = sourceOf('common/x', ['jobs:', '  a:', "    name: \"It's\"", ...PERMISSIONS]);
    const jobs = (parse(`jobs:\n${renderTarget(source, false, []).text}`) as { jobs: Record<string, { name: string }> })
      .jobs;

    expect(jobs['a'].name).toBe("Common X: It's");
  });

  it('refuses a condition written as a block scalar or as several expressions', () => {
    const block = sourceOf('common/x', ['jobs:', '  a:', '    if: >-', '      always()', ...PERMISSIONS]);
    const split = sourceOf('common/x', ['jobs:', '  a:', "    if: ${{ a }} && ${{ b }}", ...PERMISSIONS]);

    expect(() => renderTarget(block, false, [])).toThrow(/on one line/);
    expect(() => renderTarget(split, false, [])).toThrow(/one expression/);
  });
});

describe('jobsBlock', () => {
  it('stops at the next top-level key and drops trailing blank lines', () => {
    expect(jobsBlock('target: a/b\njobs:\n  x:\n    permissions: {}\n\nrules: {}\n')).toEqual(['  x:', '    permissions: {}']);
  });
});

function rendered(target: string, size: number): RenderedTarget {
  return { source: sourceOf(target, ['jobs:', '  a:', '    permissions: {}']), text: '', jobs: [], jobIds: [], size };
}

describe('assignShards', () => {
  it('groups targets by category and splits a category over the budget', () => {
    const shards = assignShards([rendered('common/a', 60), rendered('common/b', 60), rendered('helm/c', 10)], 100);

    expect(shards.map((shard) => [shard.id, shard.title, shard.targets.map((t) => t.source.target)])).toEqual([
      ['verify-common', 'Common', ['common/a']],
      ['verify-common-2', 'Common 2', ['common/b']],
      ['verify-helm', 'Helm', ['helm/c']],
    ]);
  });

  it('refuses a target larger than the budget on its own', () => {
    expect(() => assignShards([rendered('common/a', 101)], 100)).toThrow(/over the 100-byte shard budget/);
  });
});

describe('shardPermissions and shardSecrets', () => {
  it('grants the caller the widest access any job of the shard asks for', () => {
    const a = renderTarget(
      sourceOf('docker/a', ['jobs:', '  a:', '    permissions:', '      contents: read', '      security-events: write']),
      false,
      [],
    );
    const b = renderTarget(sourceOf('docker/b', ['jobs:', '  b:', '    permissions:', '      contents: write']), false, []);

    expect(shardPermissions({ id: 'verify-docker', title: 'Docker', targets: [a, b] })).toEqual({
      contents: 'write',
      'security-events': 'write',
    });
  });

  it('refuses a job without a permissions mapping', () => {
    const a = renderTarget(sourceOf('docker/a', ['jobs:', '  a:', '    permissions: read-all']), false, []);

    expect(() => shardPermissions({ id: 'verify-docker', title: 'Docker', targets: [a] })).toThrow(/as a mapping/);
  });

  it('passes on every secret a shard reads, but never GITHUB_TOKEN', () => {
    expect(shardSecrets('${{ secrets.B }} ${{ secrets.A }} ${{ secrets.GITHUB_TOKEN }} ${{ secrets.A }}')).toEqual([
      'A',
      'B',
    ]);
  });
});

describe('renderShard and renderVerifyWorkflow', () => {
  const target = renderTarget(
    sourceOf('common/x', [
      'e2e:',
      '  token-permissions:',
      '    metadata: read',
      'jobs:',
      '  x-job:',
      ...PERMISSIONS,
      '    steps:',
      '      - uses: pinned:checkout',
    ]),
    false,
    ['node_modules'],
  );
  const shard = { id: 'verify-common', title: 'Common', targets: [target] };

  it('renders a reusable workflow with resolved pins and the secrets it reads', () => {
    const workflow = parse(renderShard(shard)) as {
      on: { workflow_call: { inputs: Record<string, unknown>; secrets: Record<string, unknown> } };
      jobs: Record<string, { steps: { uses?: string }[] }>;
    };

    expect(Object.keys(workflow.on.workflow_call.inputs)).toEqual(['targets', 'cache-key', 'artifact-id', 'manifest-sha256']);
    expect(Object.keys(workflow.on.workflow_call.secrets)).toEqual(['ACTIONS_TEST_BOT_APP_ID', 'ACTIONS_TEST_BOT_PRIVATE_KEY']);
    expect(workflow.jobs['x-job'].steps[0].uses).toBe(PINNED.checkout.split(' ')[0]);
  });

  it('calls each shard and ends with the summary job that needs every job', () => {
    const workflow = parse(renderVerifyWorkflow([shard], ['node_modules'], new Map([['verify-common', ['S']]]))) as {
      jobs: Record<string, { name?: string; needs?: string[]; uses?: string; secrets?: Record<string, string> }>;
    };

    expect(Object.keys(workflow.jobs)).toEqual(['plan', 'install', 'build', 'verify-common', 'verify']);
    expect(workflow.jobs['verify-common'].uses).toBe('./.github/workflows/verify-common.yaml');
    expect(workflow.jobs['verify-common'].secrets).toEqual({ S: '${{ secrets.S }}' });
    expect(workflow.jobs['verify'].name).toBe(SUMMARY_JOB_NAME);
    expect(workflow.jobs['verify'].needs).toEqual(['plan', 'install', 'build', 'verify-common']);
  });
});

describe('validateSources', () => {
  const job = (id: string, extra: string[] = []) => [`  ${id}:`, ...PERMISSIONS, ...extra];

  it('accepts sources that keep the contract', () => {
    expect(() => validateSources(ROOT_DIR, [sourceOf('common/a', ['jobs:', ...job('a-one')])])).not.toThrow();
  });

  it('refuses a job id another target uses, and one verify.yaml reserves', () => {
    expect(() =>
      validateSources(ROOT_DIR, [
        sourceOf('common/a', ['jobs:', ...job('same')]),
        sourceOf('common/b', ['jobs:', ...job('same'), ...job('install')]),
      ]),
    ).toThrow(/job id same is also used by .*\n.*job id install is reserved/s);
  });

  it('refuses a need outside the target, a missing permissions block and a read of the shared jobs', () => {
    const message = (() => {
      try {
        validateSources(ROOT_DIR, [
          sourceOf('common/a', [
            'jobs:',
            '  a:',
            '    needs: elsewhere',
            '    steps:',
            '      - run: echo ${{ needs.build.outputs.artifact-id }}',
          ]),
        ]);
      } catch (error) {
        return (error as Error).message;
      }
      return '';
    })();

    expect(message).toMatch(/needs elsewhere, which is not a job of common\/a/);
    expect(message).toMatch(/declare permissions as a mapping/);
    expect(message).toMatch(/through inputs\.artifact-id/);
  });

  it('refuses a job that runs a bundled local action before installing the build', () => {
    expect(() =>
      validateSources(ROOT_DIR, [
        sourceOf('common/a', ['jobs:', ...job('a', ['    steps:', '      - uses: ./actions/common/create-patch'])]),
      ]),
    ).toThrow(/runs \.\/actions\/common\/create-patch without installing the built actions first/);
  });

  it('refuses an install whose allowlist would block the artifact download', () => {
    expect(() =>
      validateSources(ROOT_DIR, [
        sourceOf('common/a', [
          'jobs:',
          ...job('a', [
            '    steps:',
            '      - uses: pinned:hardenRunner',
            '        with:',
            '          allowed-endpoints: github.com:443',
            '      - uses: pinned:installBuiltActions',
            '      - uses: ./actions/common/create-patch',
          ]),
        ]),
      ]),
    ).toThrow(/allowlist lacks \*\.actions\.githubusercontent\.com:443/);
  });
});
