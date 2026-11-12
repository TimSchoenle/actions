// Entry point of the plan step in .github/workflows/verify.yaml. All logic lives in
// ./lib/verify/plan-step.ts and ./lib/verify/affected.ts, where the unit suite exercises it. Both
// import Node.js built-ins only, because the step runs before any dependency is installed.
import { main } from './lib/verify/plan-step.js';

await main();
