/**
 * The size and findings gates, as a pure decision over numbers.
 *
 * Both thresholds compare the exact size in MiB — never the one-decimal figure the comment shows —
 * so an image one byte past the limit fails even though it renders as the limit itself. A threshold
 * of `0` is disabled, not "anything above zero".
 */

/** Bytes in one MiB. Sizes are reported in MiB because `.Size` is bytes of unpacked layers. */
export const BYTES_PER_MIB = 1_048_576;

/** What the gates are evaluated against. */
export interface GateInput {
  readonly sizeBytes: number;
  readonly warningMib: number;
  readonly limitMib: number;
  readonly findings: number;
  readonly failOnFindings: boolean;
}

/** The verdict of every gate, so the caller can report all of them before failing on any. */
export interface GateDecision {
  readonly overWarning: boolean;
  readonly overLimit: boolean;
  readonly failsOnFindings: boolean;
}

/** Exact size in MiB. */
export function sizeInMib(sizeBytes: number): number {
  return sizeBytes / BYTES_PER_MIB;
}

/** Size in MiB to one decimal place, as every output and rendering shows it. */
export function formatMib(sizeBytes: number): string {
  return sizeInMib(sizeBytes).toFixed(1);
}

/** Whether `sizeBytes` is strictly above a threshold that is enabled. */
export function isAbove(sizeBytes: number, thresholdMib: number): boolean {
  return thresholdMib > 0 && sizeInMib(sizeBytes) > thresholdMib;
}

/** Evaluates every gate. A size exactly at a threshold passes it. */
export function evaluateGates(input: GateInput): GateDecision {
  return {
    overWarning: isAbove(input.sizeBytes, input.warningMib),
    overLimit: isAbove(input.sizeBytes, input.limitMib),
    failsOnFindings: input.failOnFindings && input.findings > 0,
  };
}
