import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import { ROOT_DIR } from '../lib/utils.js';

/**
 * Which Rust actions save a Rust cache, and from where. setup-rust-toolchain caches by default and
 * saves from every run. A cache a pull request saves is scoped to that pull request's ref, so no later
 * run on the default branch can restore it, yet it counts against the repository's 10 GB quota and
 * evicts the default branch's entries. Lives here rather than beside the actions, so a change to it does
 * not release them.
 */

interface Step {
  readonly uses?: string;
  readonly with?: Record<string, string>;
}

/** The setup-rust-toolchain step of an action. */
function toolchainStep(action: string): Step {
  const { runs } = parse(fs.readFileSync(path.join(ROOT_DIR, 'actions/rust', action, 'action.yaml'), 'utf8')) as {
    runs: { steps: Step[] };
  };
  const step = runs.steps.find((candidate) => candidate.uses?.startsWith('actions-rust-lang/setup-rust-toolchain@'));
  if (step === undefined) {
    throw new Error(`rust/${action} has no setup-rust-toolchain step`);
  }

  return step;
}

/** Saves on the default branch, and on a schedule, which always runs there. */
const DEFAULT_BRANCH_ONLY =
  "${{ github.ref == format('refs/heads/{0}', github.event.repository.default_branch) || github.event_name == 'schedule' }}";

describe('Rust cache policy', () => {
  // P14c: every pull request saved 0.3 to 2 GB per job that no later run could read.
  it.each(['cargo-check', 'clippy', 'test'])('rust/%s saves its cache from the default branch only', (action) => {
    expect(toolchainStep(action).with?.['cache-save-if']).toBe(DEFAULT_BRANCH_ONLY);
  });

  // P14c: cargo fmt compiles nothing, so the cache only cost a restore and a save.
  it('rust/auto-format does not cache', () => {
    expect(toolchainStep('auto-format').with?.['cache']).toBe('false');
  });
});
