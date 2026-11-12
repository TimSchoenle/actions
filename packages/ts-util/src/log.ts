/**
 * Rendering of untrusted values for the step log.
 *
 * `core.info` writes to stdout verbatim, and the runner parses *every line* of a step's stdout for
 * workflow commands. A value that reaches the log unescaped therefore is not merely ugly when it
 * spans lines — it is executable. A YAML document read from a pull request, an image tag in a chart,
 * a check-run name fetched from the API: any of them can carry `\n::error::…` and forge an
 * annotation, `\n::add-mask::…` and blind the log, or `\n::stop-commands::<token>` and suppress every
 * command the action itself issues afterwards, including the `set-output` its caller depends on.
 *
 * The defence is to make it impossible for a value to start a line at all.
 */

/**
 * Characters JSON leaves literal that a terminal or a log viewer still treats specially.
 *
 * `JSON.stringify` escapes U+0000–U+001F and nothing above it, so DEL, the C1 block and the unicode
 * line separators survive it. None of them can forge a workflow command — the runner splits on `\n`
 * alone — but they can move a cursor or hide text in the rendered log, which is the same class of
 * problem one step down. The bidirectional and zero-width controls (U+061C, U+200B–U+200F,
 * U+202A–U+202E, U+2060–U+2064, U+2066–U+2069, U+FEFF) belong here too: they reorder or hide text, so
 * a value can read as something it is not.
 */
const RESIDUAL_CONTROL = /[\u007F-\u009F\u061C\u200B-\u200F\u2028-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/gu;

/**
 * The runner's legacy command prefix, `##[command]`.
 *
 * Whether the runner honours it mid-line, where quoting does not reach, is unverified. Writing the
 * second `#` as the JSON escape `\u0023` costs nothing either way: the result still parses back to the
 * original value, and no `##[` survives in it.
 */
const LEGACY_COMMAND_PREFIX = '##[';
const BROKEN_LEGACY_PREFIX = String.raw`#\u0023[`;

function escapeUnit(character: string): string {
  return `\\u${(character.codePointAt(0) ?? 0).toString(16).padStart(4, '0')}`;
}

/**
 * Renders a value for a log line, quoted and collapsed onto a single line.
 *
 * JSON quoting is the whole mechanism: the result is one line, so no part of the value can begin a
 * line, so no part of it can be read as a workflow command. That it also makes a trailing space, an
 * empty string and a stray carriage return visible is a second, smaller win — a log reading
 * `Read value: ` and one reading `Read value: ""` are otherwise the same page.
 *
 * The result is still valid JSON for the original value: every escape it adds is a JSON escape.
 *
 * Use it for every value a log line interpolates that the action did not itself construct. That
 * includes action inputs: a workflow is free to pass `${{ github.event.issue.title }}` into one.
 */
export function quoteForLog(value: string): string {
  return JSON.stringify(value)
    .replaceAll(RESIDUAL_CONTROL, escapeUnit)
    .replaceAll(LEGACY_COMMAND_PREFIX, BROKEN_LEGACY_PREFIX);
}

/** Renders a list of untrusted values as a comma-separated run of quoted ones. */
export function quoteAllForLog(values: readonly string[]): string {
  return values.map((value) => quoteForLog(value)).join(', ');
}

/**
 * Renders a URL for a log line, with any embedded credentials removed.
 *
 * `https://user:token@github.com/...` is a valid URL and a step log is a durable, widely readable
 * artefact, so the userinfo has to come off before the rest goes anywhere. Nothing in this repository
 * *needs* to pass a URL that way — but an input that accepts a URL accepts that one too, and a log
 * line is a poor place to discover it.
 *
 * A value that is not a URL at all is quoted unchanged rather than rejected: this is a log helper,
 * and refusing to print a malformed input is precisely when printing it matters most.
 */
export function quoteUrlForLog(value: string): string {
  try {
    const url = new URL(value);

    if (url.username === '' && url.password === '') {
      return quoteForLog(value);
    }

    url.username = '';
    url.password = '';

    return quoteForLog(url.toString());
  } catch {
    return quoteForLog(value);
  }
}
