import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import { validateDocsFile } from '../docs-file.js';

import type { DocsValidation } from '../docs-file.js';

const context = { file: 'actions/x/y/docs.yaml', inputNames: new Set(['upload', 'token']) };

function validate(yaml: string): DocsValidation {
  return validateDocsFile(parse(yaml), context);
}

function problemsOf(yaml: string): string[] {
  const result = validate(yaml);
  if (result.ok) {
    throw new Error('expected the file to be refused');
  }
  return result.problems;
}

describe('validateDocsFile', () => {
  it('accepts the full shape', () => {
    const result = validate(`
permissions:
  - scope: contents
    access: read
    when: always
  - scope: security-events
    access: write
    when: { input: upload, equals: true }
  - scope: actions
    access: read
    when:
      all:
        - { input: upload, equals: 'true' }
        - { repository: private }
egress:
  - endpoint: ghcr.io:443
    for: the image pull
  - endpoint: '*.blob.core.windows.net:443'
    for: cache blobs
requires: [linux, docker]
examples:
  - title: Basic
    file: examples/basic.yaml
`);

    expect(result).toEqual({
      ok: true,
      docs: {
        permissions: [
          { scope: 'contents', access: 'read', when: 'always' },
          // An unquoted YAML boolean compares equal to the string GitHub passes.
          { scope: 'security-events', access: 'write', when: { input: 'upload', equals: 'true' } },
          {
            scope: 'actions',
            access: 'read',
            when: { all: [{ input: 'upload', equals: 'true' }, { repository: 'private' }] },
          },
        ],
        egress: [
          { endpoint: 'ghcr.io:443', for: 'the image pull' },
          { endpoint: '*.blob.core.windows.net:443', for: 'cache blobs' },
        ],
        requires: ['linux', 'docker'],
        examples: [{ title: 'Basic', file: 'examples/basic.yaml' }],
      },
    });
  });

  it('accepts empty lists as an explicit "none" and leaves requires and examples optional', () => {
    expect(validate('permissions: []\negress: []\n')).toEqual({
      ok: true,
      docs: { permissions: [], egress: [], requires: [], examples: [] },
    });
  });

  it('requires permissions and egress, so "not documented" differs from "none"', () => {
    expect(problemsOf('{}')).toEqual([
      'actions/x/y/docs.yaml: permissions: must be a list; write [] for none',
      'actions/x/y/docs.yaml: egress: must be a list; write [] for none',
    ]);
  });

  it('refuses a file that is not a map', () => {
    expect(problemsOf('- a')).toEqual(['actions/x/y/docs.yaml: root: must be a YAML map']);
  });

  it.each([
    ['an unknown top-level key', 'permissions: []\negress: []\nnotes: x\n', /root: unknown key 'notes'/],
    [
      'an unknown key in a permission',
      'permissions:\n  - { scope: contents, access: read, when: always, why: x }\negress: []\n',
      /permissions\[0\]: unknown key 'why'/,
    ],
    [
      'an unknown scope',
      'permissions:\n  - { scope: content, access: read, when: always }\negress: []\n',
      /permissions\[0\]\.scope: must be one of/,
    ],
    [
      'an unknown access level',
      'permissions:\n  - { scope: contents, access: admin, when: always }\negress: []\n',
      /permissions\[0\]\.access: must be 'read' or 'write'/,
    ],
    [
      'id-token at read',
      'permissions:\n  - { scope: id-token, access: read, when: always }\negress: []\n',
      /id-token only takes 'write'/,
    ],
    [
      'a condition naming an input the action does not have',
      'permissions:\n  - { scope: contents, access: read, when: { input: uplaod, equals: x } }\negress: []\n',
      /when\.input: action\.yaml has no input 'uplaod'/,
    ],
    [
      'a non-scalar equals',
      'permissions:\n  - { scope: contents, access: read, when: { input: upload, equals: [x] } }\negress: []\n',
      /when\.equals: must be a string or a boolean/,
    ],
    [
      // YAML reads 1.0 as the number 1, while the action receives the text 1.0.
      'a numeric equals',
      'permissions:\n  - { scope: contents, access: read, when: { input: upload, equals: 1.0 } }\negress: []\n',
      /when\.equals: must be a string or a boolean; quote a number/,
    ],
    [
      "'always' inside all",
      'permissions:\n  - { scope: contents, access: read, when: { all: [always, { repository: private }] } }\negress: []\n',
      /when\.all\[0\]: 'always' adds nothing inside 'all'/,
    ],
    [
      'an unknown repository visibility',
      'permissions:\n  - { scope: contents, access: read, when: { repository: internal } }\negress: []\n',
      /when\.repository: must be 'private' or 'public'/,
    ],
    [
      'an all with one condition',
      'permissions:\n  - { scope: contents, access: read, when: { all: [always] } }\negress: []\n',
      /when\.all: needs at least two conditions/,
    ],
    [
      'a nested condition that is invalid',
      'permissions:\n  - { scope: contents, access: read, when: { all: [{ repository: private }, { input: nope, equals: x }] } }\negress: []\n',
      /when\.all\[1\]\.input: action\.yaml has no input 'nope'/,
    ],
    [
      'a free-text condition',
      'permissions:\n  - { scope: contents, access: read, when: sometimes }\negress: []\n',
      /when: must be 'always'/,
    ],
    [
      'an endpoint without a port',
      'permissions: []\negress:\n  - { endpoint: ghcr.io, for: x }\n',
      /egress\[0\]\.endpoint: must be host:port/,
    ],
    [
      'an endpoint with a scheme',
      'permissions: []\negress:\n  - { endpoint: "https://ghcr.io:443", for: x }\n',
      /egress\[0\]\.endpoint: must be host:port/,
    ],
    [
      'a wildcard that is not the first label',
      'permissions: []\negress:\n  - { endpoint: "a.*.example.com:443", for: x }\n',
      /egress\[0\]\.endpoint: must be host:port/,
    ],
    [
      'an endpoint in upper case',
      'permissions: []\negress:\n  - { endpoint: GHCR.io:443, for: x }\n',
      /egress\[0\]\.endpoint: must be host:port/,
    ],
    [
      'an endpoint with an empty label',
      'permissions: []\negress:\n  - { endpoint: "ghcr..io:443", for: x }\n',
      /egress\[0\]\.endpoint: must be host:port/,
    ],
    [
      'a label starting with a hyphen',
      'permissions: []\negress:\n  - { endpoint: "-ghcr.io:443", for: x }\n',
      /egress\[0\]\.endpoint: must be host:port/,
    ],
    [
      'port 0',
      'permissions: []\negress:\n  - { endpoint: "ghcr.io:0", for: x }\n',
      /egress\[0\]\.endpoint: must be host:port/,
    ],
    [
      'a port above 65535',
      'permissions: []\negress:\n  - { endpoint: "ghcr.io:65536", for: x }\n',
      /egress\[0\]\.endpoint: must be host:port/,
    ],
    [
      'an unknown runner requirement',
      'permissions: []\negress: []\nrequires: [windows]\n',
      /requires\[0\]: must be one of linux, docker/,
    ],
    [
      'an example outside examples/',
      'permissions: []\negress: []\nexamples:\n  - { title: t, file: ../x.yaml }\n',
      /examples\[0\]\.file: must be a \.yaml or \.yml file directly under examples\//,
    ],
    [
      'a placeholder left by the migration',
      'permissions: []\negress:\n  - { endpoint: ghcr.io:443, for: TODO }\n',
      /egress\[0\]\.for: still holds a placeholder/,
    ],
    [
      'the same scope at the same level twice',
      'permissions:\n  - { scope: contents, access: read, when: always }\n  - { scope: contents, access: read, when: { repository: private } }\negress: []\n',
      /permissions: contents: read is listed twice/,
    ],
    [
      'the same endpoint twice',
      'permissions: []\negress:\n  - { endpoint: ghcr.io:443, for: a }\n  - { endpoint: ghcr.io:443, for: b }\n',
      /egress: ghcr\.io:443 is listed twice/,
    ],
    [
      "'set' other than true",
      'permissions:\n  - { scope: actions, access: read, when: { input: token, set: false } }\negress: []\n',
      /permissions\[0\]\.when\.set: must be true/,
    ],
    [
      "both 'set' and 'equals'",
      "permissions:\n  - { scope: actions, access: read, when: { input: token, set: true, equals: 'x' } }\negress: []\n",
      /permissions\[0\]\.when: takes either 'equals' or 'set', not both/,
    ],
    [
      "'set' on an input the action does not have",
      'permissions:\n  - { scope: actions, access: read, when: { input: run_id, set: true } }\negress: []\n',
      /permissions\[0\]\.when\.input: action\.yaml has no input 'run_id'/,
    ],
    [
      'a token input the action does not have',
      'permissions:\n  - { scope: contents, access: write, when: always, token: github-token }\negress: []\n',
      /permissions\[0\]\.token: action\.yaml has no input 'github-token'/,
    ],
  ])('refuses %s', (_case, yaml, message) => {
    expect(problemsOf(yaml).join('\n')).toMatch(message);
  });

  it('accepts an input that only has to be set, and a permission held by a token input', () => {
    const result = validate(`
permissions:
  - { scope: actions, access: read, when: { input: upload, set: true } }
  - { scope: contents, access: write, when: always, token: token }
egress: []
`);
    expect(result).toEqual({
      ok: true,
      docs: {
        permissions: [
          { scope: 'actions', access: 'read', when: { input: 'upload', set: true } },
          { scope: 'contents', access: 'write', when: 'always', token: 'token' },
        ],
        egress: [],
        requires: [],
        examples: [],
      },
    });
  });

  it('allows one scope at one level on both the job token and a token input', () => {
    const result = validate(`
permissions:
  - { scope: contents, access: read, when: always }
  - { scope: contents, access: read, when: always, token: token }
egress: []
`);
    expect(result.ok).toBe(true);
  });

  it('allows one scope at both levels under different conditions', () => {
    const result = validate(`
permissions:
  - { scope: contents, access: read, when: always }
  - { scope: contents, access: write, when: { input: upload, equals: 'true' } }
egress: []
`);
    expect(result.ok).toBe(true);
  });

  it('reports every problem at once, each with the key it is about', () => {
    expect(
      problemsOf(
        'permissions:\n  - { scope: nope, access: nope, when: always }\negress:\n  - { endpoint: x, for: "" }\n',
      ),
    ).toEqual([
      'actions/x/y/docs.yaml: permissions[0].scope: must be one of actions, artifact-metadata, attestations, checks, contents, deployments, discussions, id-token, issues, models, packages, pages, pull-requests, security-events, statuses',
      "actions/x/y/docs.yaml: permissions[0].access: must be 'read' or 'write'",
      'actions/x/y/docs.yaml: egress[0].for: must be a non-empty string',
      'actions/x/y/docs.yaml: egress[0].endpoint: must be host:port in lower case, e.g. ghcr.io:443, got "x"',
    ]);
  });
});
