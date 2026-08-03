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
export E2E_GITHUB_TOKEN=$(gh auth token)
bun run e2e                                # every action's cases
bun run e2e actions/common/create-branch   # one action
bun run e2e create-branch delete-branch    # several, by substring
```

| Variable | Required | Purpose |
| --- | --- | --- |
| `E2E_GITHUB_TOKEN` | for suites that reach GitHub | Every API call, and the `token` input of the action under test. |
| `E2E_TEST_REPOSITORY` | no | Scratch repository the cases mutate. Defaults to `TimSchoenle/actions-testing`. |
| `E2E_APP_SLUG` | CI only | Slug of the app that minted the token. See *Identity*, below. |
| `E2E_GITHUB_TOKEN_SECONDARY` | `auto-approve-pr` only | A second identity. See *Two identities*, below. |
| `E2E_APP_SLUG_SECONDARY` | CI only | Slug of the app behind the secondary token. |
| `E2E_KEEP_WORKSPACE` | no | Keeps each run's scratch directory for inspection. |

A CI run without `E2E_GITHUB_TOKEN` **fails before any file loads**; it does not skip. Locally the
check is relaxed, so the suites that never reach GitHub — `read-yaml`, `modify-yaml`,
`render-template`, `verify-branch-name`, `apply-chart-updates` — run with no credentials at all.

Two suites cannot run on a laptop, and fail loudly rather than skipping if you try:

- `ensure-actions-are-executed` creates check runs, and `POST /repos/{o}/{r}/check-runs` accepts
  **only** a GitHub App token. A `gho_` token from `gh auth token` gets a 403.
- `auto-approve-pr` needs a second identity, below.

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

Properties worth knowing:

- **Inputs are checked against `action.yaml`.** Names are typed through the generated `ActionInput`
  union, and defaults come from the manifest — so renaming an input or changing a default changes
  what the action receives and fails the case. Pass `undefined` to omit a required input on purpose.
- **A `${{ }}` default is refused, not passed through.** The runner evaluates those against a context
  the harness has none of; handing the action the literal string `${{ github.repository }}` would be
  worse than failing. Supply the value the workflow would have resolved.
- **`scratch.branch()` registers a name, not a creation.** Teardown therefore also removes branches
  left behind by a case that failed halfway, which is how the scratch repository accumulated
  96 orphaned refs under the old model.
- **Setup never uses the action under test.** `scratch.createBranch()` and `scratch.commitFile()` go
  through the raw API, because a fixture built by the code under test cannot distinguish a correct
  result from two matching bugs.
- **Reads after a write go through `scratch.headOf()`.** A `getRef` issued moments after a write
  regularly 404s, and a ref that was *moved* can read back at its previous commit with no 404 to
  announce it. Pass the expected commit to poll for convergence.

## Hostile inputs

`actions-e2e` ships the payloads and the assertions for the adversarial half of each suite, so a new
trick is added once and tested against every action. They live in `src/adversarial.ts`.

```ts
it('publishes a value that forges every workflow command, without any taking effect', async () => {
  const result = await read(blockScalar(commandInjectionPayload()));

  expect(result.outputs['value']).toBe(commandInjectionPayload()); // still published, as data
  expectNoInjection(result); // but nothing acted on it
});
```

| Export | What it produces |
| --- | --- |
| `commandInjectionPayload()` | A value forging `::error::`, `::add-mask::`, `::stop-commands::` and the rest. |
| `fileCommandInjectionPayload()` | A value shaped like the `GITHUB_OUTPUT` heredoc format, to forge a second key. |
| `HOSTILE_CHARACTERS` / `INPUT_HOSTILE_CHARACTERS` | Control, bidi and zero-width characters. The second list drops the ones the runner cannot deliver through an environment variable. |
| `TRAVERSAL_PATHS` / `DECEPTIVE_PATHS` | Paths that escape a directory, and paths that only look like they do. |
| `REDOS_PATTERNS` | Patterns whose backtracking is superlinear, each with a subject that triggers it. |
| `yamlAliasBomb()`, `oversized()` | A geometrically expanding document, and a value of an exact size. |
| `expectNoInjection(result)` | Nothing forged, on either the command stream or the command files. |
| `expectCleanRejection(result, /reason/)` | Failed, annotated, and not by crashing. |

Two properties are worth stating because they are what make the assertions usable:

- **Publishing a hostile value as an output is not a finding.** `expectNoInjection` matches forged
  command messages by *equality*, so an action quoting a payload into a legitimate `::error::`
  annotation passes — the escaping is the correct behaviour, and asserting on a substring would
  forbid it.
- **A NUL cannot reach an action through an input.** The runner delivers inputs as environment
  variables, so `resolveInputEnv` refuses one with that reason rather than failing inside `spawn`.
  Exercise that character through file content.

## Identity

`accountId()` resolves the account whose commits the fixtures carry. Locally that is `GET /user`. In
CI the token is a GitHub App **installation** token, which that endpoint rejects with 403 — so the
generated workflow passes `E2E_APP_SLUG` and the bot user is resolved by name instead.

## Two identities

GitHub refuses a review submitted by the pull request's own author, so `auto-approve-pr` cannot be
exercised by the account that opened the fixture. Its workflow mints a second token, scoped to
`pull-requests: write` and nothing else, and the suite reads it from `E2E_GITHUB_TOKEN_SECONDARY`.

## Network scope

Each generated workflow runs `harden-runner` with `egress-policy: block`, and splits into two jobs so
that the allowlists can differ:

- **`install`** checks out, sets up bun and runs `bun install --frozen-lockfile`. It is the only job
  that may reach `registry.npmjs.org`, and it holds no token.
- **`e2e`** restores `node_modules` from the cache `install` wrote (`fail-on-cache-miss: true`), mints
  the app token and runs the cases. It may reach `api.github.com` and nothing else beyond the
  checkout and cache endpoints.

The split exists because `harden-runner` sets one policy for a whole job. Keeping the install in the
same job would put a package registry on the allowlist of the job holding a repository-scoped write
token, and a `postinstall` script would run there. A contract test in `scripts/__tests__` fails any
generated workflow whose `e2e` job can reach a registry, uses the installing bun setup, or restores
without `fail-on-cache-miss`.

## Token scope

Every generated workflow declares explicit `permission-*` inputs on `create-github-app-token`.
Without at least one, that action hands over the installation's **entire** permission set — a suite
that only reads a YAML file would be given a token that can rewrite branches. The scopes live in
`TOKEN_PERMISSIONS` in `scripts/lib/e2e-workflow.ts` and are the union of what an action's fixtures
need and what the action itself needs; a contract test fails any workflow that mints an unscoped
token.

## Cleanup

Teardown removes every branch a suite reserved and closes every pull request it opened, and **throws**
if anything survives — teardown that fails quietly is indistinguishable from teardown that worked.
It cannot survive a cancelled run, so `.github/workflows/e2e-janitor.yaml` sweeps `test/**` refs and
stale pull requests on a schedule as the backstop.

Check runs are the one resource that cannot be cleaned up: GitHub offers no delete endpoint. Each CI
run of `ensure-actions-are-executed` leaves four behind on an orphaned commit.

## Fidelity, and its limits

The harness reproduces the runner's contract: `INPUT_*` naming (including that a hyphen is *not*
translated), `action.yaml` defaults, the `GITHUB_OUTPUT` heredoc encoding, `GITHUB_ENV`,
`GITHUB_STATE`, the `::command::` stream, and starting the process in `GITHUB_WORKSPACE`. The default
`entry: 'dist'` runs the committed bundle under node, which is the artifact GitHub runs;
`entry: 'source'` runs `src/generated/index.ts` under bun for a faster edit loop, at the cost of
testing a different runtime.

The environment is an allowlist, not `process.env`. Inheriting the developer's shell would let a run
pass locally on an ambient `GITHUB_TOKEN` and fail in CI.

What this does **not** cover, and still needs a workflow:

- `post:` steps, matrix expansion, `if:` conditions and step outputs feeding a later step.
- Composite actions — seven verify workflows remain hand-written for exactly this reason.
- An `action.yaml` default that is a `${{ }}` expression. `verify-branch-name` keeps one job in YAML
  to cover its payload fallback; see `actions/helper/verify-branch-name/e2e/extra-jobs.yaml`, whose
  contents the generator appends to the generated workflow.
