/**
 * The Go template `docker inspect` is asked to render.
 *
 * Its own module because it is the one string in this action that has to be reproduced exactly
 * somewhere else — an end-to-end case matching the argument vector, a workflow debugging the same
 * call by hand — and because `.Config.Labels` versus `.config.Labels` is precisely the confusion
 * `readImageLabels` exists to catch.
 */
export const GENERATED_LABEL_FORMAT = '{{json .Config.Labels}}';
