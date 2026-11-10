/** A Markdown ATX heading: its level and its text. */
interface Heading {
  readonly level: number;
  readonly text: string;
}

function parseHeading(line: string): Heading | undefined {
  let level = 0;
  while (line[level] === '#') {
    level += 1;
  }
  if (level === 0 || level > 6 || (line.length > level && line[level] !== ' ')) {
    return undefined;
  }

  return { level, text: line.slice(level).trim() };
}

/** Characters a version token is made of; anything else separates tokens. */
function isVersionCharacter(character: string): boolean {
  return /[0-9A-Za-z.+-]/.test(character);
}

/** Whether `text` contains `version` as a whole token, as in `[1.2.0](...)` or `1.2.0 (2026-01-01)`. */
function mentionsVersion(text: string, version: string): boolean {
  let start = text.indexOf(version);
  while (start !== -1) {
    const before = start === 0 ? ' ' : text[start - 1];
    const after = start + version.length >= text.length ? ' ' : text[start + version.length];
    if (!isVersionCharacter(before) && !isVersionCharacter(after)) {
      return true;
    }
    start = text.indexOf(version, start + 1);
  }

  return false;
}

/**
 * The release notes of `version` in a release-please changelog: everything below the first heading
 * that names the version, up to the next heading of the same or a higher level, trimmed of blank
 * lines.
 *
 * @throws an `Error` when no heading names the version, or its section is empty
 */
export function extractReleaseNotes(changelog: string, version: string, file: string): string {
  const lines = changelog.replaceAll('\r\n', '\n').split('\n');
  const start = lines.findIndex((line) => {
    const heading = parseHeading(line);

    return heading !== undefined && mentionsVersion(heading.text, version);
  });
  if (start === -1) {
    throw new Error(`${file} has no heading for version ${version}.`);
  }

  const level = (parseHeading(lines[start]) as Heading).level;
  const end = lines.findIndex((line, index) => {
    const heading = index > start ? parseHeading(line) : undefined;

    return heading !== undefined && heading.level <= level;
  });
  const notes = lines
    .slice(start + 1, end === -1 ? lines.length : end)
    .join('\n')
    .trim();
  if (notes === '') {
    throw new Error(`${file} has an empty section for version ${version}.`);
  }

  return `${notes}\n`;
}
