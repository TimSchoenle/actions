import fs from 'node:fs';
import path from 'node:path';

import chalk from 'chalk';

import { applyGeneratedList, applySummaryBlock, isVerifyWorkflowFile, parseWorkflow } from './lib/ci-required.js';
import { ROOT_DIR } from './lib/utils.js';

const WORKFLOWS_DIR = path.join(ROOT_DIR, '.github', 'workflows');
const CI_REQUIRED_PATH = path.join(WORKFLOWS_DIR, 'ci-required.yaml');

// Rebuilds the `workflow_run.workflows` watch list in ci-required.yaml from the
// verify-action-*.yaml workflows on disk so a new verify workflow is picked up
// without hand-editing the aggregate gate. The ci-required drift test fails CI
// if this output is ever stale.
export function collectVerifyWorkflowNames(): string[] {
  const files = fs.readdirSync(WORKFLOWS_DIR).filter(isVerifyWorkflowFile);

  return files.map((file) => {
    const content = fs.readFileSync(path.join(WORKFLOWS_DIR, file), 'utf8');
    const { name } = parseWorkflow(content);
    if (!name) {
      throw new Error(`Verify workflow ${file} is missing a top-level 'name:'.`);
    }
    return name;
  });
}

// Rewrites each verify workflow's trailing `summary` job so its `needs` list
// always covers every other job in that workflow. Returns how many files changed.
export function syncSummaryBlocks(): number {
  const files = fs.readdirSync(WORKFLOWS_DIR).filter(isVerifyWorkflowFile);

  let updated = 0;
  for (const file of files) {
    const filePath = path.join(WORKFLOWS_DIR, file);
    const current = fs.readFileSync(filePath, 'utf8');
    const next = applySummaryBlock(current);
    if (next !== current) {
      fs.writeFileSync(filePath, next);
      updated += 1;
    }
  }
  return updated;
}

export function main(): void {
  const summariesUpdated = syncSummaryBlocks();

  const names = collectVerifyWorkflowNames();
  const current = fs.readFileSync(CI_REQUIRED_PATH, 'utf8');
  const next = applyGeneratedList(current, names);
  const listChanged = next !== current;
  if (listChanged) {
    fs.writeFileSync(CI_REQUIRED_PATH, next);
  }

  if (summariesUpdated === 0 && !listChanged) {
    console.log(chalk.blue('ci-required is already up to date.'));
    return;
  }

  const listState = listChanged ? 'updated' : 'unchanged';
  console.log(
    chalk.green(
      `Synced ci-required: ${summariesUpdated} summary job(s) updated, watch list ${listState} (${names.length} verify workflows).`,
    ),
  );
}

if (import.meta.main) {
  main();
}
