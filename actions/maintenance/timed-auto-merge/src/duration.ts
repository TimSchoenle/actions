/** Milliseconds per unit suffix accepted by {@link parseDuration}. */
const UNIT_MS = {
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
} as const;

type DurationUnit = keyof typeof UNIT_MS;

/**
 * One whole number without leading zeros, then exactly one unit.
 *
 * The workflow this action replaces rewrote the value with `sed` and handed the result to GNU
 * `date -d "... ago"`, which reads far more than durations: `1d` became `1 days ago`, but `tomorrow`,
 * `-1d` or `1d 1d` were all accepted and moved the cutoff in directions nobody intended. Six digits
 * bounds the largest value to 999999 days, which stays an exact integer in milliseconds.
 */
const DURATION_PATTERN = /^(0|[1-9]\d{0,5})([smhd])$/;

/** A duration as written in the input, and its value in milliseconds. */
export interface Duration {
  /** The input text, for messages. */
  text: string;
  milliseconds: number;
}

/**
 * Parses a duration such as `30m`, `24h` or `7d`.
 *
 * @param inputName the input the value came from, named in the error.
 * @throws if the value is not a whole number followed by one of `s`, `m`, `h` or `d`.
 */
export function parseDuration(value: string, inputName: string): Duration {
  const match = DURATION_PATTERN.exec(value);

  if (!match) {
    throw new Error(
      `Invalid '${inputName}' ${JSON.stringify(value)}. Expected a whole number followed by s, m, h or d, ` +
        'for example "30m", "24h" or "7d".',
    );
  }

  return { milliseconds: Number(match[1]) * UNIT_MS[match[2] as DurationUnit], text: value };
}

/**
 * Parses `time_elapsed` and rejects a value below `minimum_age`.
 *
 * `time_elapsed` is the input a caller is likely to wire to a `workflow_dispatch` field, and `0s`
 * would approve and merge a pull request the moment it was opened. `minimum_age` lives in the
 * workflow file, where changing it takes a reviewed commit.
 *
 * @throws if either value is malformed, or if `time_elapsed` is shorter than `minimum_age`.
 */
export function resolveMinimumOpenTime(timeElapsed: string, minimumAge: string): Duration {
  const elapsed = parseDuration(timeElapsed, 'time_elapsed');
  const minimum = parseDuration(minimumAge, 'minimum_age');

  if (elapsed.milliseconds < minimum.milliseconds) {
    throw new Error(
      `'time_elapsed' ${JSON.stringify(elapsed.text)} is shorter than 'minimum_age' ${JSON.stringify(minimum.text)}. ` +
        'Raise time_elapsed, or lower minimum_age in the workflow file if the shorter wait is intended.',
    );
  }

  return elapsed;
}
