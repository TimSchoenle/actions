/**
 * What makes a document a terrace-config contract.
 *
 * Used only against the copy inside an image, and deliberately only as a shape check. The embedded
 * copy carries the version, revision and timestamp of the build that made it, so it is not the
 * byte-reproducible copy the drift check compares against; a full comparison needs an export from
 * that same build rather than a fresh run, and depends on the consumer's stage names. So this asks
 * the question that can be answered here — is something there, and is it a contract — and leaves the
 * rest to the repository's own build.
 */

/** The key every rendering of a contract carries, whatever else the document holds. */
export const CONTRACT_MARKER_KEY = 'terrace_contract';

/** Whether a document is a terrace-config contract, rather than merely a file at the right path. */
export function isContractDocument(content: string): boolean {
  let parsed: unknown;

  try {
    parsed = JSON.parse(content) as unknown;
  } catch {
    return false;
  }

  return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) && CONTRACT_MARKER_KEY in parsed;
}
