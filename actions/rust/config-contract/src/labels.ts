/**
 * The label set a contract publishes, and what an image's own labels have to say about it.
 *
 * This is the half no source diff can give, and the reason a hand-written LABEL block is safe at
 * all. A diff sees the recipe: it cannot see a build argument that failed to interpolate, a label a
 * base image overrode, or a LABEL line deleted on a branch nobody diffed. Comparing the config blob
 * of the built image sees what a registry will actually serve.
 */
import { LabelRenderingError } from './errors.js';

/** One label the contract publishes. */
export interface ContractLabel {
  readonly name: string;
  readonly value: string;
}

/** A way one label on an image fails to carry what the contract publishes. */
export type LabelFault =
  | { readonly kind: 'absent'; readonly name: string }
  | { readonly kind: 'mismatch'; readonly name: string; readonly expected: string; readonly found: string };

/**
 * Parses the `name=value` lines of `--format labels`.
 *
 * Split on the first `=` only: a label value may contain one, and a name may not. A line without an
 * `=` at all is refused rather than read as an empty value — the shell spelling of this loop read it
 * as `name` with a blank expectation, which then matched any label whose value happened to be empty
 * and quietly compared nothing.
 *
 * @throws {LabelRenderingError} for a rendering with no labels, a malformed line or a repeated name.
 */
export function parseLabelLines(rendered: string): ContractLabel[] {
  const labels: ContractLabel[] = [];
  const seen = new Set<string>();

  for (const [index, raw] of rendered.split(/\r?\n/).entries()) {
    const line = raw.trim();

    if (line === '') {
      continue;
    }

    const separator = line.indexOf('=');

    if (separator <= 0) {
      throw new LabelRenderingError(
        `--format labels line ${index + 1} is not a label: expected 'name=value', got '${line}'.`,
      );
    }

    const name = line.slice(0, separator);

    if (seen.has(name)) {
      throw new LabelRenderingError(`--format labels renders '${name}' twice, so its expected value is undecided.`);
    }

    seen.add(name);
    labels.push({ name, value: line.slice(separator + 1) });
  }

  if (labels.length === 0) {
    throw new LabelRenderingError('--format labels rendered no labels, so nothing would have been compared.');
  }

  return labels;
}

/**
 * Reads the label map out of what `docker inspect` answered with.
 *
 * `null` is the answer for an image carrying no labels at all: Go marshals a nil `map[string]string`
 * as `null`, not as `{}`. It is therefore read as the empty set and falls through to the comparison,
 * which names all three missing labels — refusing it instead would report "nothing was compared" for
 * the case where there is most obviously something to say.
 *
 * `null` is also what reading the wrong field yields — `docker inspect` reports `.Config.Labels` and
 * `crane config` reports `.config.Labels` — but that confusion cannot arise here: the template is
 * `GENERATED_LABEL_FORMAT`, a constant of this action rather than a string each repository
 * retypes, which is what let the two meanings be separated at all.
 *
 * Anything else — an array, a string, a number — means the answer was not a label set, and is
 * refused rather than coerced.
 *
 * @throws {LabelRenderingError} when the value is neither null nor an object of strings.
 */
export function readImageLabels(value: unknown): Record<string, string> {
  if (value === null || value === undefined) {
    return {};
  }

  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new LabelRenderingError(
      `the label set read as ${Array.isArray(value) ? 'an array' : `a ${typeof value}`}, not an object, so nothing was compared.`,
    );
  }

  const labels: Record<string, string> = {};

  for (const [name, entry] of Object.entries(value)) {
    if (typeof entry !== 'string') {
      throw new LabelRenderingError(`the label '${name}' read as ${typeof entry}, not a string.`);
    }

    labels[name] = entry;
  }

  return labels;
}

/**
 * Reports every way an image's labels fall short of the ones the contract publishes.
 *
 * Every violation, not the first: a build that names one missing label and hides two is a second
 * round trip through a pipeline that already took minutes.
 *
 * Extra labels are ignored on purpose — every image carries `org.opencontainers.image.*` and
 * whatever its base contributed, and none of that is this document's business.
 *
 * Presence and value are asked separately, because a label that is absent and a label whose value is
 * empty are different defects and a single lookup cannot tell them apart.
 */
export function findLabelFaults(
  expected: readonly ContractLabel[],
  actual: Readonly<Record<string, string>>,
): LabelFault[] {
  const faults: LabelFault[] = [];

  for (const label of expected) {
    if (!Object.hasOwn(actual, label.name)) {
      faults.push({ kind: 'absent', name: label.name });
      continue;
    }

    const found = actual[label.name];

    if (found !== label.value) {
      faults.push({ kind: 'mismatch', name: label.name, expected: label.value, found });
    }
  }

  return faults;
}

/** Renders a fault as the sentence its annotation is built from. */
export function describeLabelFault(fault: LabelFault): string {
  return fault.kind === 'absent'
    ? `carries no \`${fault.name}\`, so nothing can discover this contract from its config blob.`
    : `\`${fault.name}\` is \`${fault.found}\`, and this contract's is \`${fault.expected}\`.`;
}

/** The label set as a JSON object, which is what a push step would have to put on the image. */
export function labelsAsJson(labels: readonly ContractLabel[]): string {
  return JSON.stringify(Object.fromEntries(labels.map((label) => [label.name, label.value])));
}
