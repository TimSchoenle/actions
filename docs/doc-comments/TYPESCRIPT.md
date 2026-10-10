# TypeScript

The TSDoc half of [GUIDE.md](./GUIDE.md), for actions and TimSchoenle. Tag names and standardization
levels below come from `StandardTags.ts` in microsoft/tsdoc rather than from the website, because the
website documents tags one page at a time and the levels are only visible in the source.

## Contents

- [Who reads these](#who-reads-these)
- [The gate](#the-gate)
- [The allowed tags](#the-allowed-tags)
- [Types are already there](#types-are-already-there)
- [Examples are unchecked](#examples-are-unchecked)
- [Generated sources](#generated-sources)

## Who reads these

Nobody downstream. The actions repository ships committed bundles under `actions/*/*/dist/`, and
under `actions/*/*/helper/dist/` for a composite action with a TypeScript helper, built by Bun with
its minifier, so no comment written in `src/` reaches a consumer. There is no published
package, no `.d.ts` artefact and no API report.

That scopes the work honestly. TSDoc here serves the maintainer and the editor hover, and the correct
volume is much lower than in a published library. The user-facing contract is `action.yaml`. Its top-level
`description:` is rendered into the root `README.md` tables by `scripts/generate-docs.ts`, and each
input's `description:` is what a caller reads in the action's own README and in the editor. Copying
an input description into a TSDoc comment above the code that reads it creates a second copy with
nothing keeping the two in step.

**Document the module and the exported functions. Leave the rest to the types.**

## The gate

**Not installed yet.** Neither plugin below is in `package.json` or `eslint.config.mjs`; this is the
configuration [rollout step 9](./GUIDE.md#rollout) adds. Three things in the current sources fail
`tsdoc/syntax` and have to be converted in the same pull request that switches it on:

- `@throws {ManifestParseError} if ...`, the JSDoc spelling most `@throws` tags use. TSDoc reads the
  braces as a malformed inline tag. Write `@throws {@link ManifestParseError} if ...` instead.
- `@param name description`. TSDoc requires the hyphen: `@param name - description`.
- Module root comments with no `@packageDocumentation` modifier. Without it, the comment is attached
  to the first declaration below it.

`eslint-plugin-tsdoc` checks syntax only: it catches an unrecognised tag, a malformed inline tag and a
misplaced modifier. It does not require a comment to exist and does not check that a `@param` name
matches a parameter. Two plugins, then.

```js
import tsdoc from 'eslint-plugin-tsdoc';
import jsdoc from 'eslint-plugin-jsdoc';

{
  files: ['actions/**/src/**/*.ts', 'packages/**/src/**/*.ts', 'scripts/**/*.ts'],
  plugins: { tsdoc, jsdoc },
  rules: {
    'tsdoc/syntax': 'error',
    'jsdoc/check-param-names': 'error',
    'jsdoc/no-types': 'error',
    'jsdoc/require-jsdoc': ['warn', {
      publicOnly: true,
      require: { FunctionDeclaration: true },
      contexts: ['TSInterfaceDeclaration', 'TSTypeAliasDeclaration'],
    }],
  },
}
```

The globs match the `lint` script in `package.json`, so `packages/actions-util`, which every action
imports, and the `helper/src/` of a composite action are covered as well.

`publicOnly: true` restricts the requirement to exported declarations, which is the tier from
[GUIDE.md](./GUIDE.md#what-carries-one). `jsdoc/no-types` is the enforcement of
[the next section](#types-are-already-there): it errors on a `@param {string}` in a TypeScript file.

The existing config already ignores `**/src/generated/` and `**/*.test.ts`. Both stay ignored.

## The allowed tags

TSDoc grades tags Core, Extended and Discretionary. Core is understood by every tool that reads TSDoc;
Discretionary is understood by whichever one implements it.

| Tag                     | Kind     | Level    | Use it for                                  |
| ----------------------- | -------- | -------- | ------------------------------------------- |
| `@param`                | Block    | Core     | A constraint the type does not carry        |
| `@returns`              | Block    | Core     | What the value means, never what type it is |
| `@remarks`              | Block    | Core     | Everything after the summary sentence       |
| `@typeParam`            | Block    | Core     | A bound the declaration does not express    |
| `@link`                 | Inline   | Core     | A reference to another item                 |
| `@deprecated`           | Block    | Core     | With the replacement named                  |
| `@packageDocumentation` | Modifier | Core     | The module root comment                     |
| `@throws`               | Block    | Extended | Every rejection a caller has to handle      |
| `@defaultValue`         | Block    | Extended | On an options-object property               |
| `@example`              | Block    | Extended | Sparingly. See below.                       |
| `@see`                  | Block    | Extended | Rarely. Prefer `{@link}` inside a sentence. |

Everything else is out. `@public`, `@internal`, `@alpha` and `@beta` are Discretionary and mean
something only to API Extractor, which nothing here runs. In a repository with no published surface
they are annotations about a release process that does not exist.

`@throws` earns its place despite being Extended. An action that throws terminates the step, and which
inputs cause that is the single fact a caller most needs and the type signature never carries. Name
the error class with `{@link}` when there is one, so the reader can jump to it and a rename breaks
the link visibly: `@throws {@link RepositoryFormatError} if the value is not owner/name.`

## Types are already there

This is the [rule underneath](./GUIDE.md#the-rule-underneath) in its most obvious form, because
TypeScript puts more into the signature than Rust or Java do.

```ts
// Wrong. Every word is in the signature.
/**
 * Resolves a tag to a SHA.
 * @param tag - the tag, a string
 * @returns a Promise of a string
 */
export async function resolveTag(tag: string): Promise<string>;

// Right.
/**
 * Resolves a tag to the commit SHA it points at, following one level of annotation.
 *
 * @remarks
 * A lightweight tag and an annotated tag resolve differently: the annotated form points at a tag
 * object, and the SHA a workflow needs is one dereference further in. Both spellings are accepted
 * so a caller does not have to know which kind the repository used.
 *
 * @param tag - a tag name, with or without `refs/tags/`
 * @throws {@link TagNotFoundError} if the tag does not exist.
 * @throws {@link RequestError} if the token cannot read the repository.
 */
export async function resolveTag(tag: string): Promise<string>;
```

The second comment survives a signature change. The first one contradicts it.

## Examples are unchecked

No tool in this repository compiles the contents of an `@example` block. `tsc` does not look inside
comments, and the lint plugins parse the tag without reading the code in it. An example here is prose
shaped like code, and it decays the same way prose does.

So: at most one call, short enough to read at a glance, or no example at all. Where a longer example
would genuinely help, write the test instead and link it with `{@link}`. The test is compiled and run,
which is the whole difference.

## Generated sources

Every `src/generated/` directory under `actions/`, `helper/src/generated/` included, is written by
`bun run generate-action-sources` from the neighbouring `action.yaml` and committed. The
`check-action-sources` step in `.github/workflows/scripts-ci.yml` regenerates them and fails the pull
request when the committed copy differs, so a hand edit, a doc comment included, cannot merge.

The comments those files carry come from the generator's templates in
`scripts/generate-action-sources.ts`. If the generated input and output constants deserve more, the
fix is there, emitting each input's `description:` from the `action.yaml` into the generated file.
That is the same fact reaching a second reader from the same source, which is the pattern the whole
estate is built on. It is not a doc comment task.
