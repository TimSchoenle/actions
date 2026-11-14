import * as core from './core.js';
import { errorMessage } from './errors.js';

/**
 * How the shared Octokit rides out a transient GitHub server failure.
 *
 * Kept apart from the rate-limit policy on purpose. A rate limit comes with a wait GitHub dictates,
 * often a minute or more. A transient failure, such as a 502 from GitHub's edge proxy or a dropped
 * connection, usually clears within seconds, and waiting a minute on one would only hold the runner.
 */
export interface TransientRetryPolicy {
  /** How many times a failed request is retried before its error is surfaced. */
  maxRetries: number;
  /** The first wait. It doubles on each retry, and it is also the width of the forward jitter. */
  baseDelayMs: number;
  /** The longest any single wait may be, jitter included. */
  maxDelayMs: number;
}

/**
 * Three retries after about 1s, 2s and 4s, plus up to 1s of jitter each: at most about 10s in total.
 * That is long enough to ride out a brief GitHub incident, and short enough that an actual outage
 * still fails the step quickly.
 */
export const DEFAULT_TRANSIENT_RETRY_POLICY: TransientRetryPolicy = {
  maxRetries: 3,
  baseDelayMs: 1_000,
  maxDelayMs: 8_000,
};

/** The clock effects the retry loop depends on, injected so tests need no real timers. */
export interface TransientRetryClock {
  sleep(milliseconds: number): Promise<void>;
  /** A uniform draw from `[0, 1)` used for jitter. Defaults to `Math.random`. */
  random?(): number;
}

/**
 * HTTP statuses that indicate a failure on GitHub's side or in transit, not a problem with the request.
 *
 * `@octokit/request` also reports a network failure or an aborted fetch as 500, with no response
 * attached. Retrying covers those as well.
 */
const TRANSIENT_STATUSES: ReadonlySet<number> = new Set([500, 502, 503, 504]);

/** HTTP methods that read without changing state, so replaying one cannot repeat a side effect. */
const SAFE_METHODS: ReadonlySet<string> = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Any mention of an operation type other than `query`.
 *
 * Deliberately broad: the word inside a comment, a string or a field name also counts. A false match
 * only means a read-only request is not retried. A missed match would mean replaying a write whose
 * outcome is unknown.
 */
const NON_QUERY_OPERATION = /\b(?:mutation|subscription)\b/i;

/** Whether the error is an HTTP failure that is worth sending the same request again for. */
export function isTransientServerError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }

  const { status } = error as { status?: unknown };

  return typeof status === 'number' && TRANSIENT_STATUSES.has(status);
}

/** Whether the GraphQL document can only read: it has no mutation or subscription. */
export function isReadOnlyGraphqlDocument(document: string): boolean {
  return !NON_QUERY_OPERATION.test(document);
}

/** The request options the classifier reads. Octokit passes more, all of which are ignored here. */
interface RequestShape {
  method?: unknown;
  url?: unknown;
  query?: unknown;
}

function isGraphqlEndpoint(url: unknown): boolean {
  if (typeof url !== 'string') {
    return false;
  }

  // Octokit passes `/graphql` relative to its base URL. On GHES it may pass the absolute
  // `.../api/graphql` URL instead.
  const [path = ''] = url.split('?', 1);

  return path.endsWith('/graphql');
}

/**
 * Whether a request can be replayed after a failure that leaves its outcome unknown.
 *
 * A 502 or a dropped connection does not tell whether GitHub acted on the request, so only requests
 * that cannot change state qualify: REST reads, and GraphQL documents with no mutation. Writes stay
 * single-shot even where HTTP calls them idempotent, because a replayed GitHub write (a merge, a
 * branch update, a comment) can still produce a second effect or a misleading error.
 */
export function isReplayableRequest(options: unknown): boolean {
  if (typeof options !== 'object' || options === null) {
    return false;
  }

  const { method, query, url } = options as RequestShape;
  const verb = typeof method === 'string' ? method.toUpperCase() : 'GET';

  if (SAFE_METHODS.has(verb)) {
    return true;
  }

  return verb === 'POST' && isGraphqlEndpoint(url) && typeof query === 'string' && isReadOnlyGraphqlDocument(query);
}

/** The wait before retry number `attempt + 1`: exponential, jittered forwards, capped at the ceiling. */
export function transientDelayMs(attempt: number, policy: TransientRetryPolicy, random: () => number): number {
  const exponential = policy.baseDelayMs * 2 ** attempt;
  const jitter = Math.round(random() * policy.baseDelayMs);

  return Math.min(exponential + jitter, policy.maxDelayMs);
}

/**
 * A one-line description of the failure for the log.
 *
 * The error message alone is not enough. For a 502 from GitHub's edge proxy, Octokit uses the whole
 * HTML error page as the message.
 */
function describeFailure(error: unknown): string {
  const { response, status } = error as { response?: unknown; status?: unknown };

  if (response !== undefined) {
    return `HTTP ${String(status)}`;
  }

  const [firstLine = ''] = errorMessage(error).split('\n', 1);

  return `no response: ${firstLine.trim()}`;
}

const REAL_CLOCK: TransientRetryClock = {
  sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  random: () => Math.random(),
};

/**
 * Runs a request and retries it while it fails with a transient server error.
 *
 * The caller decides whether the request is safe to replay (see {@link isReplayableRequest}). Every
 * other error, and the last transient one once the retries run out, is rethrown unchanged.
 */
export async function requestWithTransientRetry<T>(
  perform: () => Promise<T>,
  policy: TransientRetryPolicy = DEFAULT_TRANSIENT_RETRY_POLICY,
  clock: TransientRetryClock = REAL_CLOCK,
): Promise<T> {
  const random = clock.random?.bind(clock) ?? Math.random;

  for (let attempt = 0; ; attempt += 1) {
    try {
      return await perform();
    } catch (error) {
      if (attempt >= policy.maxRetries || !isTransientServerError(error)) {
        throw error;
      }

      const delayMs = transientDelayMs(attempt, policy, random);
      core.info(
        `GitHub API request failed transiently (${describeFailure(error)}); retrying in ` +
          `${Math.ceil(delayMs / 1_000)}s (attempt ${attempt + 1} of ${policy.maxRetries}).`,
      );
      await clock.sleep(delayMs);
    }
  }
}
