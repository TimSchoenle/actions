import { createServer } from 'node:http';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createPublishApi } from './github.js';

import type { IncomingMessage, Server, ServerResponse } from 'node:http';

type Handler = (request: IncomingMessage, response: ServerResponse) => void;

const SHA = 'a'.repeat(40);
let server: Server;
let handler: Handler;
let savedApiUrl: string | undefined;

function reply(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}

beforeEach(async () => {
  server = createServer((request, response) => handler(request, response));
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

/** Answers ref creation with 422, and the ref lookup as `lookup` says. */
function refusingCreate(lookup: 'present' | 'absent' | 'failing'): void {
  handler = (request, response) => {
    // Octokit sends the ref of `git/ref/{ref}` with its slash encoded.
    const url = decodeURIComponent(request.url ?? '');
    if (request.method === 'POST' && url === '/repos/o/r/git/refs') {
      reply(response, 422, { message: lookup === 'present' ? 'Reference already exists' : 'Object does not exist' });
    } else if (request.method === 'GET' && url === '/repos/o/r/git/ref/tags/v1') {
      if (lookup === 'present') {
        reply(response, 200, { ref: 'refs/tags/v1', object: { type: 'commit', sha: SHA } });
      } else if (lookup === 'failing') {
        // A failure the client does not retry: a transient 5xx on this read would be retried with real
        // waits, and that retry is covered by the shared client's own tests.
        reply(response, 403, { message: 'Resource not accessible by integration' });
      } else {
        reply(response, 404, { message: 'Not Found' });
      }
    } else {
      reply(response, 500, { message: `unexpected ${request.method} ${request.url}` });
    }
  };
}

describe('createPublishApi createRef', () => {
  it('reports a ref that is already there as existing', async () => {
    refusingCreate('present');

    await expect(createPublishApi('token', { owner: 'o', repo: 'r' }).createRef('tags/v1', SHA)).resolves.toBe(
      'exists',
    );
  });

  it('rethrows a 422 for a ref that is not there, such as an unknown object', async () => {
    refusingCreate('absent');

    await expect(createPublishApi('token', { owner: 'o', repo: 'r' }).createRef('tags/v1', SHA)).rejects.toMatchObject({
      status: 422,
      message: expect.stringContaining('Object does not exist'),
    });
  });

  it('rethrows the 422 when the lookup after it fails, with the lookup failure as its cause', async () => {
    refusingCreate('failing');

    await expect(createPublishApi('token', { owner: 'o', repo: 'r' }).createRef('tags/v1', SHA)).rejects.toMatchObject({
      status: 422,
      message: expect.stringContaining('Object does not exist'),
      cause: expect.objectContaining({ status: 403 }),
    });
  });

  it('reports a created ref', async () => {
    handler = (_request, response) => reply(response, 201, { ref: 'refs/tags/v1', object: { sha: SHA } });

    await expect(createPublishApi('token', { owner: 'o', repo: 'r' }).createRef('tags/v1', SHA)).resolves.toBe(
      'created',
    );
  });
});

describe('createPublishApi updateRef', () => {
  /** Answers the branch update with `status` and `message`. */
  function updating(status: number, message: string): void {
    handler = (request, response) => {
      const url = decodeURIComponent(request.url ?? '');
      if (request.method === 'PATCH' && url === '/repos/o/r/git/refs/heads/releases') {
        reply(response, status, status === 200 ? { ref: 'refs/heads/releases', object: { sha: SHA } } : { message });
      } else {
        reply(response, 500, { message: `unexpected ${request.method} ${url}` });
      }
    };
  }

  it('reports a fast-forward as updated', async () => {
    updating(200, '');

    await expect(createPublishApi('token', { owner: 'o', repo: 'r' }).updateRef('heads/releases', SHA)).resolves.toBe(
      'updated',
    );
  });

  it('reports the 422 GitHub sends for a non-fast-forward as such', async () => {
    updating(422, 'Update is not a fast forward');

    await expect(createPublishApi('token', { owner: 'o', repo: 'r' }).updateRef('heads/releases', SHA)).resolves.toBe(
      'not-fast-forward',
    );
  });

  it.each(['Object does not exist', 'Reference does not exist'])('rethrows any other 422: %s', async (message) => {
    updating(422, message);

    await expect(
      createPublishApi('token', { owner: 'o', repo: 'r' }).updateRef('heads/releases', SHA),
    ).rejects.toMatchObject({ status: 422, message: expect.stringContaining(message) });
  });
});

describe('createPublishApi release lookups', () => {
  const api = () => createPublishApi('token', { owner: 'o', repo: 'r' });

  /** A release as the REST API returns it. */
  function release(id: number, createdAt: string, draft = false) {
    return {
      id,
      tag_name: `v${id}`,
      draft,
      html_url: `https://github.com/o/r/releases/${id}`,
      upload_url: `https://uploads.github.com/repos/o/r/releases/${id}/assets{?name,label}`,
      created_at: createdAt,
      assets: [],
    };
  }

  it('stops listing releases at the first page that reaches back past the cutoff', async () => {
    const base = process.env['GITHUB_API_URL'] as string;
    const pages: Record<string, unknown[]> = {
      '1': [release(4, '2026-03-04T00:00:00Z', true), release(3, '2026-03-03T00:00:00Z')],
      '2': [release(2, '2026-03-02T00:00:00Z'), release(1, '2026-02-01T00:00:00Z')],
      '3': [release(0, '2026-01-01T00:00:00Z')],
    };
    const requested: string[] = [];
    handler = (request, response) => {
      const url = new URL(request.url ?? '', base);
      const page = url.searchParams.get('page') ?? '1';
      requested.push(page);
      response.writeHead(200, {
        'content-type': 'application/json',
        link: `<${base}/repos/o/r/releases?per_page=100&page=${Number(page) + 1}>; rel="next"`,
      });
      response.end(JSON.stringify(pages[page] ?? []));
    };

    const releases = await api().listReleasesSince('2026-03-01T00:00:00Z');

    expect(requested).toEqual(['1', '2']);
    expect(releases.map((entry) => [entry.id, entry.draft, entry.createdAt])).toEqual([
      [4, true, '2026-03-04T00:00:00Z'],
      [3, false, '2026-03-03T00:00:00Z'],
      [2, false, '2026-03-02T00:00:00Z'],
      [1, false, '2026-02-01T00:00:00Z'],
    ]);
  });

  it('finds a published release by its tag, and nothing for an unknown tag', async () => {
    handler = (request, response) => {
      if (request.url === '/repos/o/r/releases/tags/v1') {
        reply(response, 200, release(1, '2026-01-01T00:00:00Z'));
      } else {
        reply(response, 404, { message: 'Not Found' });
      }
    };

    await expect(api().getReleaseByTag('v1')).resolves.toMatchObject({ id: 1, tagName: 'v1', draft: false });
    await expect(api().getReleaseByTag('v2')).resolves.toBeUndefined();
  });

  it('lists a tree recursively in one request and reports truncation', async () => {
    let query = '';
    handler = (request, response) => {
      query = new URL(request.url ?? '', 'http://x').search;
      reply(response, 200, {
        sha: SHA,
        truncated: true,
        tree: [
          { path: 'a', mode: '040000', type: 'tree', sha: 'b'.repeat(40) },
          { path: 'a/x.js', mode: '100644', type: 'blob', sha: 'c'.repeat(40) },
        ],
      });
    };

    await expect(api().getTreeRecursive(SHA)).resolves.toEqual({
      truncated: true,
      items: [
        { name: 'a', mode: '040000', type: 'tree', sha: 'b'.repeat(40) },
        { name: 'a/x.js', mode: '100644', type: 'blob', sha: 'c'.repeat(40) },
      ],
    });
    expect(query).toBe('?recursive=1');
  });
});

describe('createPublishApi matchingRefs', () => {
  it('reads every page of a ref family, without the refs/ prefix', async () => {
    const base = process.env['GITHUB_API_URL'] as string;
    const ref = (name: string, type = 'commit') => ({ ref: `refs/tags/${name}`, object: { sha: SHA, type } });
    handler = (request, response) => {
      const page = new URL(request.url ?? '', base).searchParams.get('page') ?? '1';
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (page === '1') {
        headers['link'] = `<${base}/repos/o/r/git/matching-refs/tags/a-?per_page=100&page=2>; rel="next"`;
      }
      response.writeHead(200, headers);
      response.end(JSON.stringify(page === '1' ? [ref('a-v1')] : [ref('a-v2', 'tag')]));
    };

    await expect(createPublishApi('token', { owner: 'o', repo: 'r' }).matchingRefs('tags/a-')).resolves.toEqual([
      { ref: 'tags/a-v1', sha: SHA, type: 'commit' },
      { ref: 'tags/a-v2', sha: SHA, type: 'tag' },
    ]);
  });
});
