/** The git identity of a GitHub App bot, as git and GitHub expect it on a commit. */
export interface BotIdentity {
  /** The bot's GitHub username, always `<app-slug>[bot]`. */
  name: string;
  /** The bot's GitHub noreply address. */
  email: string;
  /** The bot user's numeric GitHub id. */
  id: number;
}

/** The single user lookup this action needs, kept minimal so it can be faked in tests. */
export interface AppUserApi {
  /**
   * Resolves the numeric id of the given user, or `undefined` when GitHub has no such user.
   */
  getUserId(username: string): Promise<number | undefined>;
}

/** The suffix GitHub appends to an app slug to form the bot account's username. */
const BOT_SUFFIX = '[bot]';

/**
 * The characters a GitHub App slug can consist of.
 */
const APP_SLUG_PATTERN = /^[A-Za-z\d][\w.-]*$/;

/**
 * Raised when the `app-slug` input cannot name a GitHub App at all.
 */
export class InvalidAppSlugError extends Error {
  constructor(readonly appSlug: string) {
    super(
      `Invalid app-slug '${appSlug}'. Expected the slug of a GitHub App (e.g. 'my-app'), not a URL, path or empty value.`,
    );
    this.name = 'InvalidAppSlugError';
  }
}

/**
 * Raised when GitHub does not know the bot account of an otherwise well-formed app slug.
 */
export class BotUserNotFoundError extends Error {
  constructor(
    readonly appSlug: string,
    readonly username: string,
  ) {
    super(
      `GitHub has no user '${username}'. Check that app-slug '${appSlug}' is the slug of an existing GitHub App (the slug, not the app's display name or client ID).`,
    );
    this.name = 'BotUserNotFoundError';
  }
}

/**
 * Reduces the `app-slug` input to the bare slug.
 */
export function normalizeAppSlug(appSlug: string): string {
  const trimmed = appSlug.trim();
  const slug = trimmed.toLowerCase().endsWith(BOT_SUFFIX) ? trimmed.slice(0, -BOT_SUFFIX.length) : trimmed;

  if (!APP_SLUG_PATTERN.test(slug)) {
    throw new InvalidAppSlugError(appSlug);
  }

  return slug;
}

/** The username GitHub gives the bot account of the app with this slug. */
export function botUsername(appSlug: string): string {
  return `${appSlug}${BOT_SUFFIX}`;
}

/**
 * Builds the bot's GitHub noreply address, `<id>+<username>@users.noreply.github.com`.
 */
export function botEmail(id: number, username: string): string {
  return `${id}+${username}@users.noreply.github.com`;
}

/**
 * Resolves the git identity of the GitHub App bot behind `appSlug`.
 */
export async function resolveBotIdentity(api: AppUserApi, appSlug: string): Promise<BotIdentity> {
  const slug = normalizeAppSlug(appSlug);
  const username = botUsername(slug);

  const id = await api.getUserId(username);

  if (id === undefined || !Number.isInteger(id) || id <= 0) {
    throw new BotUserNotFoundError(appSlug, username);
  }

  return { email: botEmail(id, username), id, name: username };
}
