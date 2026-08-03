# actions-e2e

Runs a `node20` action end-to-end against a real repository, without a workflow.

## Why

A `node20` action is a bundle the runner executes with `INPUT_*` in the environment and a
`GITHUB_OUTPUT` file to write to. Nothing about that requires GitHub, so nothing about testing it
requires a workflow. Driving it directly buys three things the workflow-per-case model cannot:

- **The cases run locally.** The old loop was push, wait about four minutes, read a log.
- **One job per action instead of one job per case.** Each case previously paid for a runner start,
  an app-token mint and two repository checkouts.
- **Typed assertions.** The shell version had 227 assertions across 153 `run:` blocks, 97 of which
  ran without `set -euo pipefail` — where a failed `gh api` or `grep` mid-block passes green.

Composite actions cannot be driven this way: only the runner can invoke them. `parseActionManifest`
refuses them by name rather than failing obscurely at the spawn.

## Running

```sh
export E2E_GITHUB_TOKEN=<token with contents:write on the scratch repository>
bun run e2e                                # every action's cases
bun run e2e actions/common/create-branch   # one action
```

| Variable | Default | Purpose |
| --- | --- | --- |
| `E2E_GITHUB_TOKEN` | — | Required. Every API call, and the `token` input of the action under test. |
| `E2E_TEST_REPOSITORY` | `TimSchoenle/actions-testing` | The scratch repository the cases mutate. |
| `E2E_KEEP_WORKSPACE` | unset | Keeps each run's scratch directory for inspection. |

A run without `E2E_GITHUB_TOKEN` **fails**; it does not skip. A suite that skips itself when a
credential is missing reports green, which is the failure mode this package exists to remove.

## Writing a case

Cases live in `<action>/e2e/*.e2e.test.ts` and are excluded from the unit suite.

```ts
const scratch = ScratchRepo.fromEnvironment('create-branch');

afterAll(() => scratch.teardown());

it('creates a branch at the head of the default branch', async () => {
  const branch = scratch.branch('default-base');

  const result = await runAction<ActionInput, ActionOutput>({
    actionDirectory: ACTION_DIRECTORY,
    inputs: { token: scratch.token, repository: scratch.repository, branch_name: branch },
    secrets: [scratch.token],
  });

  expect(result.outputs).toEqual({ branch, base_branch: 'main', sha: defaultSha, created: 'true' });
});
```

Three properties are worth knowing:

- **Inputs are checked against `action.yaml`.** Names are typed through the generated `ActionInput`
  union, and defaults come from the manifest — so renaming an input or changing a default changes
  what the action receives and fails the case. Pass `undefined` to omit a required input on purpose.
- **`scratch.branch()` registers a name, not a creation.** Teardown therefore also removes branches
  left behind by a case that failed halfway, which is how the scratch repository accumulated
  96 orphaned refs under the old model.
- **Setup never uses the action under test.** `scratch.createBranch()` and `scratch.commitFile()` go
  through the raw API, because a fixture built by the code under test cannot distinguish a correct
  result from two matching bugs.

## Fidelity, and its limits

The harness reproduces the runner's contract: `INPUT_*` naming (including that a hyphen is *not*
translated), `action.yaml` defaults, the `GITHUB_OUTPUT` heredoc encoding, `GITHUB_ENV`,
`GITHUB_STATE` and the `::command::` stream. The default `entry: 'dist'` runs the committed bundle
under node, which is the artifact GitHub runs; `entry: 'source'` runs `src/generated/index.ts` under
bun for a faster edit loop, at the cost of testing a different runtime.

The environment is an allowlist, not `process.env`. Inheriting the developer's shell would let a run
pass locally on an ambient `GITHUB_TOKEN` and fail in CI.

What this does **not** cover, and still needs a workflow: `post:` steps, anything the runner does
around the action (matrix expansion, `if:` conditions, step outputs feeding a later step), and
composite actions.
