import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';
import { parse } from 'yaml';

// The generator's default I/O resolves tags with git; these tests give it in-memory I/O instead.
vi.mock('../lib/readme/utils.js', () => ({ getTagCommitSha: vi.fn() }));

import { DOCS_FILE_NAME, validateDocsFile } from '../lib/action-docs/docs-file.js';
import { generateActionReadmes } from '../lib/action-docs/generate.js';
import { parseActionManifest } from '../lib/action-docs/manifest.js';
import { findRegions, REGION_NAMES } from '../lib/action-docs/markers.js';
import { ROOT_DIR, replaceTemplateVariables } from '../lib/utils.js';

import type { DocsIo } from '../lib/action-docs/generate.js';

/**
 * Contract for the action files `bun run create-action` writes.
 *
 * The scaffolding ends by running the README generator, so the rendered templates must pass it with
 * no error and no warning: a new action starts with a complete, marked README instead of a gap
 * someone has to remember to fill.
 */

const ACTION_PATH = 'actions/example-pkg/example-sub';

const REPLACEMENTS = {
  packageName: 'example-pkg',
  subAction: 'example-sub',
  capitalizedPackageName: 'Example-pkg',
  capitalizedSubAction: 'Example-sub',
  description: 'A reusable action.',
};

function render(template: string): string {
  const content = fs.readFileSync(path.join(ROOT_DIR, 'scripts', 'templates', 'action', template), 'utf8');
  return replaceTemplateVariables(content, REPLACEMENTS);
}

/** A repository holding only the scaffolded action, registered the way release-please registers it. */
function scaffoldedRepository(): { io: DocsIo; files: Map<string, string> } {
  const files = new Map<string, string>([
    ['.release-please-manifest.json', JSON.stringify({ [ACTION_PATH]: '0.0.0' })],
    [
      'release-please-config.json',
      JSON.stringify({ packages: { [ACTION_PATH]: { component: 'actions-example-pkg-example-sub' } } }),
    ],
    [`${ACTION_PATH}/action.yaml`, render('action.yaml')],
    [`${ACTION_PATH}/${DOCS_FILE_NAME}`, render(DOCS_FILE_NAME)],
  ]);
  const io: DocsIo = {
    list: async (pattern) => {
      const parts = pattern.split('/');
      return [...files.keys()]
        .filter((file) => {
          const fileParts = file.split('/');
          return fileParts.length === parts.length && parts.every((part, i) => part === '*' || part === fileParts[i]);
        })
        .sort();
    },
    read: async (file) => files.get(file),
    write: async (file, content) => {
      files.set(file, content);
    },
    tagSha: async () => undefined,
  };
  return { io, files };
}

describe('action templates', () => {
  it('scaffold a docs.yaml the validator accepts', () => {
    const manifest = parseActionManifest(render('action.yaml'), `${ACTION_PATH}/action.yaml`);
    const result = validateDocsFile(parse(render(DOCS_FILE_NAME)), {
      file: `${ACTION_PATH}/${DOCS_FILE_NAME}`,
      inputNames: new Set(manifest.inputs.map((input) => input.name)),
    });

    expect(result).toEqual({ ok: true, docs: { permissions: [], egress: [], requires: [], examples: [] } });
  });

  it('generate a README with every region and no warnings', async () => {
    const { io, files } = scaffoldedRepository();

    const report = await generateActionReadmes('Owner/actions', io);

    expect(report).toEqual({ written: [`${ACTION_PATH}/README.md`], errors: [], warnings: [] });
    const readme = files.get(`${ACTION_PATH}/README.md`) ?? '';
    expect(findRegions(readme, 'README.md')).toEqual([...REGION_NAMES]);
  });
});
