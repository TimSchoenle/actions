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

/**
 * Contract between container images pinned inside an action and the managers that update them.
 *
 * An image a composite runs with `docker run` sits in a `run:` script or a step's `env:`, which the
 * github-actions manager does not read: it only knows `uses: docker://...`. Such a pin is invisible
 * to Renovate unless a customManager claims it, and an image frozen at one digest keeps every CVE
 * published against it. `actions/security/zizmor` is the first; this holds for any that follow.
 */
describe('Renovate coverage of container images in actions', () => {
  /** `registry/name:tag@sha256:digest` references, wherever an action.yaml spells one. */
  const IMAGE_PIN = /[a-z0-9.-]+\.[a-z]{2,}\/[a-z0-9._/-]+:[\w.-]+@sha256:[a-f0-9]{64}/g;

  /** The customManagers whose file patterns claim the given repository path. */
  function managersFor(file: string): CustomManager[] {
    return customManagers().filter((manager) =>
      manager.managerFilePatterns.some(
        (pattern) => pattern.startsWith('/') && pattern.endsWith('/') && new RegExp(pattern.slice(1, -1)).test(file),
      ),
    );
  }

  async function imagePins(): Promise<{ file: string; pin: string }[]> {
    const pins: { file: string; pin: string }[] = [];

    for (const file of await scanSorted('actions/*/*/action.yaml')) {
      for (const pin of fs.readFileSync(path.join(ROOT_DIR, file), 'utf8').match(IMAGE_PIN) ?? []) {
        pins.push({ file, pin });
      }
    }

    return pins;
  }

  it('finds the zizmor image, so the scan below is not vacuous', async () => {
    expect((await imagePins()).map(({ file }) => file)).toContain('actions/security/zizmor/action.yaml');
  });

  it('matches every pinned image with exactly one docker manager that reads its file', async () => {
    for (const { file, pin } of await imagePins()) {
      const matches = managersFor(file).flatMap((manager) =>
        manager.matchStrings
          .map((matchString) => new RegExp(matchString).exec(pin)?.groups)
          .filter((groups) => groups !== undefined)
          .map((groups) => ({ groups, datasource: manager.datasourceTemplate })),
      );

      expect(matches, `${file} pins ${pin}, which ${matches.length} customManager(s) match`).toHaveLength(1);
      expect(matches[0]?.datasource).toBe('docker');
      expect(
        `${matches[0]?.groups['depName']}:${matches[0]?.groups['currentValue']}@${matches[0]?.groups['currentDigest']}`,
      ).toBe(pin);
    }
  });
});

/**
 * Contract between release binaries a workflow downloads and the manager that updates them.
 *
 * A workflow that installs a tool from a GitHub release pins the tag and the asset's SHA-256 as a
 * pair of step environment values. Renovate has to move both in one commit: a bumped version with the
 * old checksum fails the step's `sha256sum --check`, and a checksum nobody updates freezes the tool at
 * one release. Only a manager that captures the two together can do that, so every checksum pin in
 * `.github/workflows/` must be captured, with its version, by exactly one.
 */
describe('Renovate coverage of checksum-pinned release downloads in workflows', () => {
  const WORKFLOWS_DIR = path.join(ROOT_DIR, '.github', 'workflows');
  /**
   * A `<NAME>_SHA256: <digest>` environment value in any YAML quoting: single, double or none.
   * Discovery is deliberately looser than the manager, so a pin written in a style the manager cannot
   * read is still found and fails the capture assertion instead of being skipped.
   */
  const CHECKSUM_PIN = /^[ \t]*([A-Z0-9_]+)_SHA256:[ \t]*["']?([a-f0-9]{64})["']?[ \t]*$/gm;

  interface ChecksumPin {
    name: string;
    digest: string;
  }

  interface Capture {
    datasource?: string;
    depName?: string;
    currentValue?: string;
    currentDigest?: string;
  }

  function workflowFiles(): string[] {
    return fs.readdirSync(WORKFLOWS_DIR).filter((entry) => /\.ya?ml$/.test(entry));
  }

  function managersFor(file: string): CustomManager[] {
    return customManagers().filter((manager) =>
      manager.managerFilePatterns.some(
        (pattern) => pattern.startsWith('/') && pattern.endsWith('/') && new RegExp(pattern.slice(1, -1)).test(file),
      ),
    );
  }

  function checksumPins(content: string): ChecksumPin[] {
    return [...content.matchAll(CHECKSUM_PIN)].map((match) => ({ name: match[1], digest: match[2] }));
  }

  /** What every manager claiming `file` extracts for the pin with this digest. */
  function capturesOf(file: string, content: string, digest: string): Capture[] {
    return managersFor(file).flatMap((manager) =>
      manager.matchStrings.flatMap((matchString) =>
        [...content.matchAll(new RegExp(matchString, 'g'))]
          .map((match) => match.groups as Capture | undefined)
          .filter((groups): groups is Capture => groups?.currentDigest === digest),
      ),
    );
  }

  function expectCapturedOnce(file: string, content: string): void {
    for (const { name, digest } of checksumPins(content)) {
      const captures = capturesOf(file, content, digest);

      expect(captures, `${file} pins ${name}_SHA256, which ${captures.length} customManager(s) capture`).toHaveLength(
        1,
      );
      expect(captures[0]?.datasource).toBe('github-release-attachments');
      expect(captures[0]?.depName).toMatch(/^[\w.-]+\/[\w.-]+$/);
      expect(captures[0]?.currentValue, `${name}_VERSION must sit directly above ${name}_SHA256`).toMatch(/^[^"'\s]+$/);
    }
  }

  const DIGEST = 'a'.repeat(64);
  const fixture = (version: string, digest: string): string =>
    [
      '      - name: Download tool',
      '        env:',
      '          # renovate: datasource=github-release-attachments depName=example/tool',
      `          TOOL_VERSION: ${version}`,
      `          TOOL_SHA256: ${digest}`,
      '        run: exit 0',
      '',
    ].join('\n');
  const FIXTURE_FILE = '.github/workflows/fixture.yml';

  it('finds the actionlint pin, so the scan below is not vacuous', () => {
    const content = fs.readFileSync(path.join(WORKFLOWS_DIR, 'security.yml'), 'utf8');

    expect(checksumPins(content).map(({ name }) => name)).toContain('ACTIONLINT');
  });

  it('captures every checksum pin, with its version, by exactly one manager that reads its file', () => {
    for (const entry of workflowFiles()) {
      expectCapturedOnce(`.github/workflows/${entry}`, fs.readFileSync(path.join(WORKFLOWS_DIR, entry), 'utf8'));
    }
  });

  it.each([
    ['single-quoted', `'v1.2.3'`, `'${DIGEST}'`],
    ['double-quoted', `"v1.2.3"`, `"${DIGEST}"`],
    ['plain', 'v1.2.3', DIGEST],
  ])('discovers and captures a %s pin with its version', (_style, version, digest) => {
    const content = fixture(version, digest);

    expect(checksumPins(content)).toEqual([{ name: 'TOOL', digest: DIGEST }]);
    expectCapturedOnce(FIXTURE_FILE, content);
    expect(capturesOf(FIXTURE_FILE, content, DIGEST)[0]?.currentValue).toBe('v1.2.3');
  });

  // The failure mode the loose discovery exists for: a pin the manager does not read must fail here.
  it('discovers a pin without a version line, which no manager captures', () => {
    const content = fixture('v1.2.3', `"${DIGEST}"`).replace(/^.*TOOL_VERSION.*\n/m, '');

    expect(checksumPins(content)).toHaveLength(1);
    expect(capturesOf(FIXTURE_FILE, content, DIGEST)).toEqual([]);
  });

  /**
   * Whether a workflow fetches a script and runs it unverified. Backslash continuations are joined
   * first, because `curl … \` on one line and `| bash` on the next is the same pipeline to the shell.
   */
  function pipesDownloadIntoShell(content: string): boolean {
    const joined = content.replaceAll(/\\\r?\n[ \t]*/g, ' ');
    return /(?:curl|wget)[^\n|]*\|\s*(?:ba|z)?sh\b|(?:ba|z)?sh\s+<\(\s*(?:curl|wget)/.test(joined);
  }

  // A checksum pin is only worth something if nothing else in the workflows fetches code and runs it
  // unverified. Piping a downloaded script into a shell is the shape the actionlint pin replaced.
  it('lets no workflow pipe a downloaded script into a shell', () => {
    for (const entry of workflowFiles()) {
      const content = fs.readFileSync(path.join(WORKFLOWS_DIR, entry), 'utf8');

      expect(pipesDownloadIntoShell(content), `.github/workflows/${entry} pipes a download into a shell`).toBe(false);
    }
  });

  it.each([
    ['a single-line pipe', 'curl -fsSL https://example.invalid/install.sh | bash'],
    ['process substitution', 'bash <(curl https://example.invalid/install.sh)'],
    ['a pipe after a line continuation', 'curl -fsSL \\\n  https://example.invalid/install.sh \\\n  | bash'],
    ['wget into sh', 'wget -qO- https://example.invalid/install.sh | sh'],
  ])('flags %s', (_shape, run) => {
    expect(pipesDownloadIntoShell(run)).toBe(true);
  });

  it('accepts a download that is checked before it is used', () => {
    const run = [
      'curl -fsSL --retry 3 -o "${dir}/${archive}" \\',
      '  "https://example.invalid/${archive}"',
      'echo "${SHA256}  ${dir}/${archive}" | sha256sum --check --strict -',
    ].join('\n');

    expect(pipesDownloadIntoShell(run)).toBe(false);
  });
});
