import { checkBundles } from './lib/action-dist.js';
import { Sys } from './lib/utils.js';

const STAGE_FLAG = '--stage';

/**
 * Verifies that the bundle every action ships at `runs.main` is a build of the sources next to it.
 *
 * GitHub runs `dist/index.js`, never the TypeScript sources, so a bundle that was not rebuilt after
 * a source change ships behaviour that corresponds to no source tree — and no lint, typecheck or
 * unit test can see it. Rebuilding and comparing is the only check that can.
 *
 * By default the committed bundle is restored after the comparison, leaving the working tree
 * untouched. `--stage` instead keeps the fresh build and adds it to the index, which is what the
 * pre-commit hook needs to keep a commit self-consistent. Any remaining arguments are paths — the
 * hook passes the staged files — and narrow the run to the actions they belong to.
 *
 * @returns the process exit code.
 */
export async function main(argv: string[] = Bun.argv.slice(2)): Promise<number> {
  const stage = argv.includes(STAGE_FLAG);
  const paths = argv.filter((argument) => !argument.startsWith('--'));

  const checks = await checkBundles(paths, !stage);
  if (checks.length === 0) {
    console.warn('⚠️ No Node-based actions found — nothing to build.');
    return 0;
  }

  const drifted = checks.filter((check) => check.drifted);

  if (drifted.length === 0) {
    console.log(`✅ ${checks.length} action bundle(s) match their sources.`);
    return 0;
  }

  if (stage) {
    console.log(`🔧 Rebuilt ${drifted.length} action bundle(s):`);
    for (const check of drifted) {
      console.log(`  ${check.relativePath}`);
    }
    await Sys.exec(`git add ${drifted.map((check) => check.relativePath).join(' ')}`);

    return 0;
  }

  console.error(`❌ ${drifted.length} action bundle(s) do not match their sources:`);
  for (const check of drifted) {
    console.error(`  ${check.relativePath}`);
  }
  console.error("\nRun 'bun run build:workspaces' and commit the result.");

  return 1;
}

if (import.meta.main) {
  process.exit(await main());
}
