import { main } from './lib/release-tags.js';

// Run by the Generate Docs job in .github/workflows/release-please.yml. The step lives in
// ./lib/release-tags.ts, where the unit suite covers it.
if (import.meta.main) {
  await main();
}
