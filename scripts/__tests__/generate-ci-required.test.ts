import fs from 'node:fs';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { collectVerifyWorkflowNames, collectWatchedWorkflowNames, main } from '../generate-ci-required.js';
import { ANCHOR_WORKFLOW_FILES, extractGeneratedList, sortWorkflowNames } from '../lib/ci-required.js';
import { ROOT_DIR } from '../lib/utils.js';

// The generator against the real workflow files. Writes are stubbed throughout, so a run can never
// touch the checkout, whatever state it is in.

const WORKFLOWS_DIR = path.join(ROOT_DIR, '.github', 'workflows');
const CI_REQUIRED_PATH = path.join(WORKFLOWS_DIR, 'ci-required.yaml');

afterEach(() => {
  vi.restoreAllMocks();
});

describe('collectWatchedWorkflowNames', () => {
  it('watches every verify workflow plus each anchor', () => {
    const verify = collectVerifyWorkflowNames();
    const watched = collectWatchedWorkflowNames();

    expect(watched.slice(0, verify.length)).toEqual(verify);
    expect(watched.slice(verify.length)).toHaveLength(ANCHOR_WORKFLOW_FILES.length);
    expect(watched).toContain('Scripts CI');
  });

  it('matches the list committed in ci-required.yaml', () => {
    const committed = extractGeneratedList(fs.readFileSync(CI_REQUIRED_PATH, 'utf8'));

    expect(sortWorkflowNames(collectWatchedWorkflowNames())).toEqual(sortWorkflowNames(committed));
  });

  // A nameless anchor would be watched under no name at all, which GitHub never matches.
  it('refuses an anchor without a top-level name', () => {
    const readFileSync = fs.readFileSync.bind(fs);
    vi.spyOn(fs, 'readFileSync').mockImplementation(((file: fs.PathOrFileDescriptor, options?: unknown) =>
      String(file).endsWith(`${path.sep}${ANCHOR_WORKFLOW_FILES[0]}`)
        ? 'on: pull_request\njobs: {}\n'
        : readFileSync(file, options as BufferEncoding)) as typeof fs.readFileSync);

    expect(() => collectWatchedWorkflowNames()).toThrow(`Workflow ${ANCHOR_WORKFLOW_FILES[0]} is missing`);
  });
});

describe('main', () => {
  function stubWrites(): ReturnType<typeof vi.spyOn> {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    return vi.spyOn(fs, 'writeFileSync').mockImplementation(() => undefined);
  }

  it('writes nothing when ci-required.yaml is already up to date', () => {
    const writes = stubWrites();

    main();

    expect(writes).not.toHaveBeenCalled();
  });

  it('rewrites the watch list when an anchor is missing from it', () => {
    const readFileSync = fs.readFileSync.bind(fs);
    vi.spyOn(fs, 'readFileSync').mockImplementation(((file: fs.PathOrFileDescriptor, options?: unknown) => {
      const content = readFileSync(file, options as BufferEncoding);
      return String(file) === CI_REQUIRED_PATH ? String(content).replace('      - Scripts CI\n', '') : content;
    }) as typeof fs.readFileSync);
    const writes = stubWrites();

    main();

    expect(writes).toHaveBeenCalledTimes(1);
    expect(writes.mock.calls[0]?.[0]).toBe(CI_REQUIRED_PATH);
    expect(String(writes.mock.calls[0]?.[1])).toContain('      - Scripts CI\n');
  });
});
