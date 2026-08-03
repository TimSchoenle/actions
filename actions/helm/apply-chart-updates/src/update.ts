/**
 * The update itself: turn validated inputs into two rewritten files.
 *
 * The ordering here is the atomicity guarantee. Everything that can be rejected — every key, every
 * template expansion, every rendered value, both file loads — is rejected *before* the first write.
 * A caller updating ten images either gets all ten or gets an untouched checkout and one error
 * naming what was wrong.
 */

import { planYamlEdits, writeEditPlan } from './edits.js';
import { assertMatches, mergeVariables } from './inputs.js';
import { renderTemplate } from './template.js';

import type { AppliedEdit, PlannedEdit } from './edits.js';
import type { ImageEntry, VariableBag } from './inputs.js';

/** Everything the update needs, already parsed and validated in isolation. */
export interface UpdateRequest {
  readonly chartFile: string;
  readonly valuesFile: string;
  readonly images: readonly ImageEntry[];
  readonly sharedVariables: VariableBag;
  readonly valueTemplate: string;
  readonly keyPattern: RegExp;
  readonly valuePattern: RegExp;
  readonly chartVersion: string;
  readonly previousChartVersion: string;
  /** Written to `appVersion` when set. Absent means the chart has no single app version. */
  readonly appVersion: string | undefined;
}

/** What the update changed. */
export interface UpdateResult {
  readonly imageEdits: readonly AppliedEdit[];
  readonly chartEdits: readonly AppliedEdit[];
}

/**
 * Renders one value per image.
 *
 * Each entry's own variables are layered over the shared defaults, so an image that moved to its own
 * version simply carries its own `tag`. An entry that is short a variable fails naming that entry —
 * it never inherits a sibling's version, which would publish a chart claiming to ship a build that
 * was never produced.
 */
export function planImageEdits(request: UpdateRequest): PlannedEdit[] {
  return request.images.map((entry) => {
    assertMatches(request.keyPattern, entry.key, 'images key');

    const variables = mergeVariables(request.sharedVariables, entry.variables);
    const value = renderTemplate(request.valueTemplate, variables, `images['${entry.key}']`);

    assertMatches(request.valuePattern, value, `rendered value for '${entry.key}'`);

    return { key: entry.key, value };
  });
}

/** The `Chart.yaml` edits: always the version, and `appVersion` only when the caller asked for one. */
function planChartEdits(request: UpdateRequest): PlannedEdit[] {
  const edits: PlannedEdit[] = [{ key: 'version', value: request.chartVersion }];

  if (request.appVersion !== undefined) {
    edits.push({ key: 'appVersion', value: request.appVersion });
  }

  return edits;
}

/**
 * Applies the update to both files.
 *
 * Both plans are built first: a `values.yaml` that names a key the chart does not have must not
 * leave a bumped `Chart.yaml` behind.
 */
export async function applyUpdate(request: UpdateRequest): Promise<UpdateResult> {
  const valuesPlan = await planYamlEdits(request.valuesFile, planImageEdits(request));
  const chartPlan = await planYamlEdits(request.chartFile, planChartEdits(request));

  await writeEditPlan(chartPlan);
  await writeEditPlan(valuesPlan);

  return { imageEdits: valuesPlan.applied, chartEdits: chartPlan.applied };
}
