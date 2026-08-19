/**
 * The failures this action reports, one class per situation a caller can act on.
 *
 * Two kinds live here, and the difference is what a caller does next. An {@link InvalidInputError}
 * or a {@link GeneratorError} means the check never ran, so the step has to fail with no verdict at
 * all — an unrun check reported as a passing image is the one outcome this whole scheme cannot
 * afford. A drift, by contrast, is a verdict, and those are collected as findings so a run reports
 * every fault it saw rather than the first.
 */

/** An action input is not a value this action can use, reported before anything is read or run. */
export class InvalidInputError extends Error {
  constructor(
    readonly input: string,
    reason: string,
  ) {
    super(`${input}: ${reason}`);
    this.name = 'InvalidInputError';
  }
}

/** The generator could not be run, or produced something that cannot be compared against. */
export class GeneratorError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = 'GeneratorError';
  }
}

/** A `docker` invocation failed, or answered with something that is not what it documents. */
export class DockerError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = 'DockerError';
  }
}

/**
 * The generated `--format labels` rendering is not a set of labels.
 *
 * Separate from {@link GeneratorError} only in name: it is the same class of problem — the generator
 * produced something nothing can be compared against — and is raised where the parse happens.
 */
export class LabelRenderingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LabelRenderingError';
  }
}

/** The checks found at least one drift. Carries the count so the step summary need not recount. */
export class ContractDriftError extends Error {
  constructor(readonly findingCount: number) {
    super(
      `${findingCount} contract ${findingCount === 1 ? 'check' : 'checks'} failed. ` +
        'Each is annotated above with what was compared and what it found.',
    );
    this.name = 'ContractDriftError';
  }
}
