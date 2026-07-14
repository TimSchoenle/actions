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
   *
   * Only a genuinely unknown user may map to `undefined`; every other failure must throw, so a
   * revoked token can never be reported as a misspelled app slug.
   */
  getUserId(username: string): Promise<number | undefined>;
}

/** The suffix GitHub appends to an app slug to form the bot account's username. */
const BOT_SUFFIX = '[bot]';

/**
 * The characters a GitHub App slug can consist of. GitHub itself only ever mints
 * `[a-z0-9-]` slugs, but the pattern stays deliberately wider than that: the point is to reject
 * values that would corrupt the lookup (empty strings, whitespace, path separators, stray brackets),
 * not to re-derive GitHub's naming rules and start failing on a slug GitHub happily accepts.
 */
const APP_SLUG_PATTERN = /^[A-Za-z\d][\w.-]*$/;

/**
 * Raised when the `app-slug` input cannot name a GitHub App at all — an empty value, or one carrying
 * characters that a slug can never contain.
 *
 * Separate from {@link BotUserNotFoundError}: a malformed slug is a mistake in the caller's workflow
 * file, while an unknown one is a mistake in the app it names.
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
 *
 * The bot account only exists once the app is installed and has been seen by GitHub, so this is
 * reported against the app slug rather than as a raw 404: a caller reading "not found" for
 * `/users/my-app[bot]` has no way to tell which of its inputs was wrong.
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
 *
 * A caller that already holds the bot username (`my-app[bot]`, e.g. straight out of a token action's
 * output) previously produced the nonsense lookup `my-app[bot][bot]` and a 404. The suffix is
 * therefore stripped rather than rejected: `[` and `]` cannot occur inside a GitHub App slug, so a
 * trailing `[bot]` is unambiguously the bot suffix and never part of the slug itself. Accepting both
 * spellings cannot mis-target a different user, and it turns an input that only ever failed into one
 * that works.
 *
 * @throws {InvalidAppSlugError} if what remains cannot be a slug.
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
 *
 * This exact shape is the whole reason the action exists: GitHub only attributes a commit to the bot
 * account — avatar, profile link, contribution graph — when the author email carries the account's
 * numeric id in front of the `+`. An address without the id, or with a mismatched one, produces
 * commits authored by nobody.
 */
export function botEmail(id: number, username: string): string {
  return `${id}+${username}@users.noreply.github.com`;
}

/**
 * Resolves the git identity of the GitHub App bot behind `appSlug`.
 *
 * @throws {InvalidAppSlugError} if the slug is empty or malformed.
 * @throws {BotUserNotFoundError} if GitHub does not know the app's bot account.
 */
export async function resolveBotIdentity(api: AppUserApi, appSlug: string): Promise<BotIdentity> {
  const slug = normalizeAppSlug(appSlug);
  const username = botUsername(slug);

  const id = await api.getUserId(username);

  // A user without a usable id is not a case GitHub is documented to produce, but the identity is
  // worthless without it — an email built from `undefined` or `0` would silently detach every commit
  // from the bot account — so it fails here rather than downstream in git history.
  if (id === undefined || !Number.isInteger(id) || id <= 0) {
    throw new BotUserNotFoundError(appSlug, username);
  }

  return { email: botEmail(id, username), id, name: username };
}
