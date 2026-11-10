/**
 * The YAML helpers, imported as `actions-util/yaml`.
 *
 * Kept out of the main entry point: the `yaml` package cannot be tree-shaken, so re-exporting these
 * from `index.ts` put over 110 KB of YAML parser into every action, read-yaml's neighbours that never
 * parse a document included. Only the actions that read or edit YAML import this.
 */
export * from './yaml.js';
export * from './yaml-document.js';
