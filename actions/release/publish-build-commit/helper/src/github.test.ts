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
        reply(response, 500, { message: 'Server Error' });
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
      cause: expect.objectContaining({ status: 500 }),
    });
  });

  it('reports a created ref', async () => {
    handler = (_request, response) => reply(response, 201, { ref: 'refs/tags/v1', object: { sha: SHA } });

    await expect(createPublishApi('token', { owner: 'o', repo: 'r' }).createRef('tags/v1', SHA)).resolves.toBe(
      'created',
    );
  });
});
