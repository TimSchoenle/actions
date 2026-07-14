import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  botEmail,
  botUsername,
  BotUserNotFoundError,
  InvalidAppSlugError,
  normalizeAppSlug,
  resolveBotIdentity,
} from './identity.js';

import type { AppUserApi } from './identity.js';

function fakeApi(users: Record<string, number> = { 'my-app[bot]': 123456 }): AppUserApi {
  return {
    getUserId: vi.fn(async (username: string) => users[username]),
  };
}

describe('normalizeAppSlug', () => {
  it('keeps a bare slug unchanged', () => {
    expect(normalizeAppSlug('my-app')).toBe('my-app');
  });

  it('trims surrounding whitespace, which a YAML block scalar easily introduces', () => {
    expect(normalizeAppSlug('  my-app\n')).toBe('my-app');
  });

  it.each([
    ['my-app[bot]', 'my-app'],
    ['my-app[BOT]', 'my-app'],
    ['  my-app[bot]  ', 'my-app'],
  ])('strips the bot suffix from %j', (input, expected) => {
    expect(normalizeAppSlug(input)).toBe(expected);
  });

  it.each(['', '   ', '[bot]', 'my app', 'owner/my-app', 'https://github.com/apps/my-app', 'my-app[bot][bot]', '-app'])(
    'rejects the malformed slug %j',
    (appSlug) => {
      expect(() => normalizeAppSlug(appSlug)).toThrow(InvalidAppSlugError);
      expect(() => normalizeAppSlug(appSlug)).toThrow(`Invalid app-slug '${appSlug}'`);
    },
  );
});

describe('botUsername', () => {
  it('appends the bot suffix', () => {
    expect(botUsername('my-app')).toBe('my-app[bot]');
  });
});

describe('botEmail', () => {
  it('builds the GitHub noreply address from the id and the username', () => {
    expect(botEmail(123456, 'my-app[bot]')).toBe('123456+my-app[bot]@users.noreply.github.com');
  });
});

describe('resolveBotIdentity', () => {
  let api: AppUserApi;

  beforeEach(() => {
    api = fakeApi();
  });

  it('resolves the identity of an existing app bot', async () => {
    await expect(resolveBotIdentity(api, 'my-app')).resolves.toEqual({
      email: '123456+my-app[bot]@users.noreply.github.com',
      id: 123456,
      name: 'my-app[bot]',
    });

    expect(api.getUserId).toHaveBeenCalledWith('my-app[bot]');
  });

  it('looks up the same user for a slug the caller already suffixed with [bot]', async () => {
    await expect(resolveBotIdentity(api, 'my-app[bot]')).resolves.toEqual({
      email: '123456+my-app[bot]@users.noreply.github.com',
      id: 123456,
      name: 'my-app[bot]',
    });

    expect(api.getUserId).toHaveBeenCalledWith('my-app[bot]');
  });

  it('rejects an empty slug before making any API call', async () => {
    await expect(resolveBotIdentity(api, '')).rejects.toThrow(InvalidAppSlugError);

    expect(api.getUserId).not.toHaveBeenCalled();
  });

  it('reports an unknown app bot against the slug the caller passed', async () => {
    await expect(resolveBotIdentity(api, 'typo-app')).rejects.toThrow(BotUserNotFoundError);
    await expect(resolveBotIdentity(api, 'typo-app')).rejects.toThrow("GitHub has no user 'typo-app[bot]'");
  });

  it.each([0, -1, 1.5])('rejects the unusable user id %j instead of building a broken email', async (id) => {
    const broken: AppUserApi = { getUserId: vi.fn(async () => id) };

    await expect(resolveBotIdentity(broken, 'my-app')).rejects.toThrow(BotUserNotFoundError);
  });

  it('propagates API failures instead of reporting them as an unknown app', async () => {
    const failing: AppUserApi = {
      getUserId: vi.fn(async () => {
        throw new Error('Bad credentials');
      }),
    };

    await expect(resolveBotIdentity(failing, 'my-app')).rejects.toThrow('Bad credentials');
  });
});
