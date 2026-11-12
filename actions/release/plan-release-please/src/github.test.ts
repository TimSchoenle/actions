import { createServer } from 'node:http';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createReleaseStateApi } from './github.js';

import type { Server, ServerResponse } from 'node:http';

let server: Server;
let content: unknown;
/** Every GraphQL request body the server received, parsed. */
let graphqlRequests: Array<{ query: string; variables: Record<string, string> }>;
/** The tag refs the fake repository has, as `refs/tags/<name>`. */
let presentRefs: Set<string>;
let savedApiUrl: string | undefined;

function reply(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}

/** Answers a GraphQL query of aliased `ref(qualifiedName:)` lookups from {@link presentRefs}. */
function answerGraphql(body: string, response: ServerResponse): void {
  const request = JSON.parse(body) as { query: string; variables: Record<string, string> };
  graphqlRequests.push(request);
  const repository = Object.fromEntries(
    [...request.query.matchAll(/(\w+): ref\(qualifiedName: \$(\w+)\)/g)].map(([, alias, variable]) => {
      const qualified = request.variables[variable];
      return [alias, presentRefs.has(qualified) ? { name: qualified.slice('refs/tags/'.length) } : null];
    }),
  );
  reply(response, 200, { data: { repository } });
}

beforeEach(async () => {
  graphqlRequests = [];
  presentRefs = new Set();
  server = createServer((request, response) => {
    const url = decodeURIComponent(request.url ?? '');
    if (request.method === 'POST' && url === '/graphql') {
      let body = '';
      request.on('data', (chunk: Buffer) => (body += chunk.toString()));
      request.on('end', () => answerGraphql(body, response));
    } else if (request.method === 'GET' && url.startsWith('/repos/o/r/contents/CHANGELOG.md?')) {
      reply(response, 200, content);
    } else {
      reply(response, 404, { message: 'Not Found' });
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  savedApiUrl = process.env['GITHUB_API_URL'];
  process.env['GITHUB_API_URL'] = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

afterEach(async () => {
  if (savedApiUrl === undefined) {
    delete process.env['GITHUB_API_URL'];
  } else {
    process.env['GITHUB_API_URL'] = savedApiUrl;
  }
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('createReleaseStateApi fileAt', () => {
  const api = () => createReleaseStateApi('token', { owner: 'o', repo: 'r' });

  it('decodes a file the contents API returns in base64', async () => {
    content = { type: 'file', encoding: 'base64', size: 6, content: Buffer.from('# v1\n\n').toString('base64') };

    await expect(api().fileAt('CHANGELOG.md', 'abc')).resolves.toBe('# v1\n\n');
  });

  it('refuses a file too large for the contents API instead of reading it as empty', async () => {
    content = { type: 'file', encoding: 'none', size: 1_500_000, content: '' };

    await expect(api().fileAt('CHANGELOG.md', 'abc')).rejects.toThrow(
      'CHANGELOG.md at abc is too large for the contents API (1500000 bytes, encoding "none").',
    );
  });

  it('returns nothing for a file that does not exist', async () => {
    await expect(api().fileAt('missing.md', 'abc')).resolves.toBeUndefined();
  });
});

describe('createReleaseStateApi existingTags', () => {
  const api = () => createReleaseStateApi('token', { owner: 'o', repo: 'r' });

  // P12: preflight used to page through every source tag on every push to main.
  it('looks every tag up by name in one query, passing the names as variables', async () => {
    presentRefs = new Set(['refs/tags/src-a-v1.0.0', 'refs/tags/src-c-v3.0.0']);

    const found = await api().existingTags(['src-a-v1.0.0', 'src-b-v2.0.0', 'src-c-v3.0.0']);

    expect(found).toEqual(new Set(['src-a-v1.0.0', 'src-c-v3.0.0']));
    expect(graphqlRequests).toHaveLength(1);
    expect(graphqlRequests[0].variables).toMatchObject({ owner: 'o', repo: 'r', t0: 'refs/tags/src-a-v1.0.0' });
    expect(graphqlRequests[0].query).not.toContain('src-a');
  });

  it('splits a long list into queries of at most 100 lookups', async () => {
    const names = Array.from({ length: 150 }, (_, index) => `src-p${index}-v1.0.0`);
    presentRefs = new Set(names.map((name) => `refs/tags/${name}`));

    expect(await api().existingTags(names)).toEqual(new Set(names));
    expect(graphqlRequests.map((request) => Object.keys(request.variables).length - 2)).toEqual([100, 50]);
  });

  it('asks nothing for an empty list', async () => {
    expect(await api().existingTags([])).toEqual(new Set());
    expect(graphqlRequests).toEqual([]);
  });
});
