import { applyOutput } from './output.js';
import { loadPartials } from './partials.js';
import { renderTemplate } from './render.js';
import { readTemplateSource } from './template-file.js';
import { parseVariables } from './variables.js';

import type { RenderOutcome } from './output.js';

/** The action's inputs, already coerced but not yet interpreted. */
export interface GenerateRequest {
  templatePath: string;
  outputPath: string;
  /** The raw `variables` input, still JSON text. */
  variables: string;
  /** Directory of `.hbs` partials, or an empty string for none. */
  partialsDir: string;
  strict: boolean;
  escapeHtml: boolean;
  check: boolean;
}

export interface GenerateResult extends RenderOutcome {
  /** How many partials were registered, so a workflow log shows a mis-pointed directory. */
  partialCount: number;
}

/**
 * Renders one template to one file.
 *
 * The single seam between the action's I/O and its behaviour: everything above this is reading
 * inputs and publishing outputs, everything below is testable without a runner. The order is
 * deliberate — the variables and the partials are validated before the output file is touched, so a
 * malformed request never leaves a half-written file behind.
 */
export async function generateFile(request: GenerateRequest): Promise<GenerateResult> {
  const variables = parseVariables(request.variables);
  const partials = await loadPartials(request.partialsDir);
  const templateSource = await readTemplateSource(request.templatePath);

  const content = renderTemplate({
    templatePath: request.templatePath,
    templateSource,
    variables,
    partials,
    strict: request.strict,
    escapeHtml: request.escapeHtml,
  });

  const outcome = await applyOutput(request.outputPath, content, { check: request.check });

  return { ...outcome, partialCount: partials.length };
}
