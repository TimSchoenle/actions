// Entry point of the registration barrier step in .github/workflows/ci-required.yaml. All logic,
// including reading the environment and writing GITHUB_OUTPUT, lives in
// ./lib/ci-required-registration-step.ts, where the unit suite exercises it.
import { main } from './lib/ci-required-registration-step.js';

await main();
