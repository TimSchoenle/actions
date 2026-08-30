import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { EXTRA_JOBS_FILE, PINNED, resolvePins } from '../lib/e2e-workflow.js';
import { ROOT_DIR, scanSorted } from '../lib/utils.js';

/**
 * Contract between the pinned refs in the workflow generator and the Renovate managers that update
 * them.
 *
 * A dependency Renovate cannot see does not fail anything. It simply stops moving, and an action
 * pinned to a digest stays on that digest through every advisory published against it — the exact
 * failure mode that pinning by digest is supposed to trade *against* automation, not instead of it.
 * Nothing else in this repository would notice, so it is checked here.
 *
 * The managers are read from `renovate.json` rather than restated, so this asserts the configuration
 * that ships and not a copy of it.
 */

interface CustomManager {
  description?: string;
  managerFilePatterns: string[];
  matchStrings: string[];
  packageNameTemplate?: string;
  datasourceTemplate?: string;
}

const GENERATOR_FILE = 'scripts/lib/e2e-workflow.ts';

function customManagers(): CustomManager[] {
  const config = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'renovate.json'), 'utf8')) as {
    customManagers?: CustomManager[];
  };

  return config.customManagers ?? [];
}

/** The managers that claim the generator file, by their `managerFilePatterns`. */
function managersForGenerator(): CustomManager[] {
  return customManagers().filter((manager) =>
    manager.managerFilePatterns.some((pattern) => {
      // Renovate wraps a regex pattern in slashes; anything else is a glob, which these are not.
      const expression = pattern.startsWith('/') && pattern.endsWith('/') ? pattern.slice(1, -1) : undefined;

      return expression !== undefined && new RegExp(expression).test(GENERATOR_FILE);
    }),
  );
}

/** How many of the generator's managers match a given pin. */
function matchCount(pin: string): number {
  let matches = 0;

  for (const manager of managersForGenerator()) {
    for (const matchString of manager.matchStrings) {
      // Quoted as the file writes it: the patterns are anchored on the string literal's own quotes,
      // which is what separates the three forms without a lookahead.
      if (new RegExp(matchString).test(`'${pin}'`)) {
        matches++;
      }
    }
  }

  return matches;
}

/** The named groups one manager extracts from a pin, for asserting on what Renovate would look up. */
function captured(pin: string): Record<string, string> | undefined {
  for (const manager of managersForGenerator()) {
    for (const matchString of manager.matchStrings) {
      const match = new RegExp(matchString).exec(`'${pin}'`);

      if (match?.groups) {
        return { ...match.groups, packageName: manager.packageNameTemplate ?? match.groups['depName'] ?? '' };
      }
    }
  }

  return undefined;
}

describe('Renovate coverage of the workflow generator', () => {
  const pins = Object.entries(PINNED);

  it('has managers claiming the generator file at all', () => {
    expect(
      managersForGenerator().length,
      `no customManager in renovate.json matches ${GENERATOR_FILE}`,
    ).toBeGreaterThan(0);
  });

  it.each(pins)('matches the %s pin with exactly one manager', (name, pin) => {
    const matches = matchCount(pin);

    expect(
      matches,
      matches === 0
        ? `Renovate would never update '${name}'. Write it as 'owner/repo@<40-char digest> # vX.Y.Z', or add a ` +
            'customManager to renovate.json for the form it does use.'
        : `'${name}' is matched by ${matches} managers; two managers means two competing pull requests.`,
    ).toBe(1);
  });

  it.each(pins)('extracts a digest and a version from the %s pin', (name, pin) => {
    const groups = captured(pin);

    expect(groups, `no manager captured '${name}'`).toBeDefined();
    expect(groups?.['currentDigest'], `'${name}' must be pinned by digest`).toMatch(/^[a-f0-9]{40}$/);
    expect(groups?.['currentValue'], `'${name}' must carry the version it is pinned to`).not.toBe('');
  });

  // `actions/cache/restore` has no tags of its own; they are on `actions/cache`. A manager that let
  // depName reach the datasource unchanged would look up a repository that does not exist and report
  // nothing, which is indistinguishable from "no update available".
  it.each(pins)('looks the %s pin up against a real repository', (name, pin) => {
    const packageName = captured(pin)?.['packageName'] ?? '';

    expect(packageName.split('/'), `'${name}' resolves to '${packageName}', which is not an owner/repo`).toHaveLength(
      2,
    );
  });

  it('keeps every pin present in the generated workflows, so one branch updates both', () => {
    const workflows = fs
      .readdirSync(path.join(ROOT_DIR, '.github', 'workflows'))
      .filter((file) => file.startsWith('verify-action-'))
      .map((file) => fs.readFileSync(path.join(ROOT_DIR, '.github', 'workflows', file), 'utf8'))
      .join('\n');

    for (const [name, pin] of pins) {
      expect(workflows, `'${name}' appears in no generated workflow; is it still used?`).toContain(pin);
    }
  });
});

/**
 * Contract between an extra-jobs fragment and the same managers.
 *
 * A fragment is copied into its generated workflow verbatim, and lives under `actions/`, which no
 * manager in `renovate.json` reads. A ref written out in full there is therefore a pin Renovate
 * updates in the generated copy and nowhere else — and the drift check then fails on every pull
 * request until someone reverts the bump by hand, because the regenerate job's answer to drift is to
 * rewrite the workflow from the fragment. That is how `harden-runner` sat two minor versions behind
 * in `verify-action-helper-verify-branch-name.yaml` while every other job in it moved.
 *
 * So fragments name a `PINNED` key instead, and that is what is enforced here.
 */
describe('Renovate coverage of the extra-jobs fragments', () => {
  /** `uses:` values a fragment states, with the line they are on for the failure message. */
  function usesIn(fragment: string): { line: number; value: string }[] {
    const uses: { line: number; value: string }[] = [];

    fragment.split(/\r?\n/).forEach((line, index) => {
      const match = /^\s*(?:-\s*)?uses:\s*(\S+)/.exec(line);

      if (match) {
        uses.push({ line: index + 1, value: match[1] });
      }
    });

    return uses;
  }

  it('finds the fragments this suite is meant to cover', async () => {
    // A glob that silently matched nothing would make every assertion below vacuously true.
    expect(await scanSorted(`actions/*/*/e2e/${EXTRA_JOBS_FILE}`)).not.toEqual([]);
  });

  it('lets no fragment pin an action itself', async () => {
    for (const fragmentPath of await scanSorted(`actions/*/*/e2e/${EXTRA_JOBS_FILE}`)) {
      const fragment = fs.readFileSync(path.join(ROOT_DIR, fragmentPath), 'utf8');

      for (const { line, value } of usesIn(fragment)) {
        // A local action carries no version, so there is nothing for Renovate to update.
        if (value.startsWith('./')) {
          continue;
        }

        expect(
          value,
          `${fragmentPath}:${line} pins an action Renovate cannot see here. Write 'uses: pinned:<key>' ` +
            'and add the ref to PINNED in scripts/lib/e2e-workflow.ts, where the customManagers read it.',
        ).toMatch(/^pinned:\w+$/);
      }
    }
  });

  it('resolves every placeholder a fragment names', async () => {
    for (const fragmentPath of await scanSorted(`actions/*/*/e2e/${EXTRA_JOBS_FILE}`)) {
      const fragment = fs.readFileSync(path.join(ROOT_DIR, fragmentPath), 'utf8');

      expect(() => resolvePins(fragment), `${fragmentPath} names a pin that PINNED does not hold`).not.toThrow();

      // Only the `uses:` values: the fragment's own header explains the convention, and matching on
      // the whole text would fail on the explanation rather than on an unsubstituted step.
      const unresolved = usesIn(resolvePins(fragment)).filter(({ value }) => value.startsWith('pinned:'));

      expect(unresolved, `${fragmentPath} left a placeholder unsubstituted`).toEqual([]);
    }
  });
});
