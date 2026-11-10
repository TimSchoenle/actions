import { createServer } from 'node:http';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createReleaseStateApi } from './github.js';

import type { Server, ServerResponse } from 'node:http';

let server: Server;
let content: unknown;
let savedApiUrl: string | undefined;

function reply(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}

beforeEach(async () => {
  server = createServer((request, response) => {
    const url = decodeURIComponent(request.url ?? '');
    if (request.method === 'GET' && url.startsWith('/repos/o/r/contents/CHANGELOG.md?')) {
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
