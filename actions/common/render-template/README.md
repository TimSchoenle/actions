# Common Render Template

Renders a [Handlebars](https://handlebarsjs.com/) template file to an output file from a JSON map of variables.

Built for generated documentation — a README assembled from a list of actions is the case it is designed around — but the
inputs are generic, so it renders CHANGELOGs, docs pages and config files just as well.

Rendering is **deterministic**: the same template and the same variables always produce byte-identical output. That is
what makes `check: true` usable as a CI gate, and what keeps a scheduled regeneration from manufacturing an empty commit
on every run.

## Usage

### Generate a file

```yaml
- uses: <owner>/actions/actions/common/render-template@<ref>
  id: render
  with:
    template: docs/README.hbs
    output: README.md
    partials-dir: docs/partials
    variables: |
      {
        "repo": "acme/actions",
        "actions": [
          { "name": "read-yaml", "description": "Read a value from a YAML file" },
          { "name": "clippy", "description": "Lint Rust" }
        ]
      }

- uses: <owner>/actions/actions/common/commit-changes@<ref>
  if: steps.render.outputs.changed == 'true'
  with:
    message: 'docs: regenerate README'
```

### Verify a committed file is up to date

```yaml
- uses: <owner>/actions/actions/common/render-template@<ref>
  with:
    template: docs/README.hbs
    output: README.md
    variables: ${{ steps.collect.outputs.data }}
    check: true
```

`check: true` writes nothing. It fails the step when the committed file is missing or stale, and reports the first
differing line so the log alone tells you whether it is a real change or a stray newline.

## Inputs

| Input          | Required | Default | Description                                                                                                      |
| -------------- | -------- | ------- | ---------------------------------------------------------------------------------------------------------------- |
| `template`     | yes      |         | Path to the template file.                                                                                        |
| `output`       | yes      |         | Path to write the rendered result to. Missing parent directories are created.                                     |
| `variables`    | no       | `{}`    | Template variables as a **strict JSON object**. Not YAML.                                                         |
| `partials-dir` | no       | `''`    | Directory of reusable `.hbs` partials.                                                                            |
| `strict`       | no       | `true`  | Fail on a reference the variables do not define.                                                                  |
| `escape-html`  | no       | `false` | HTML-escape interpolated values. Off by default: the output is Markdown or config, not HTML.                      |
| `check`        | no       | `false` | Verify the output is current instead of writing it, failing the step when it is stale.                            |

## Outputs

| Output        | Description                                                                     |
| ------------- | ------------------------------------------------------------------------------- |
| `changed`     | `true` when the rendered content differs from what was already at `output`.      |
| `checksum`    | SHA-256 of the rendered content, as lowercase hex.                               |
| `output-path` | The path written to, as given.                                                   |

An unchanged file is left completely untouched — not rewritten with identical bytes — so its modification time survives.

## Variables

`variables` must be strict JSON with an object at the top level. Anything JSON can express is available to the template:
nested objects, arrays, strings, numbers, booleans and `null`.

Keys that would reach the object prototype (`__proto__`, `constructor`, `prototype`) are rejected anywhere in the
document, and a template can never resolve a prototype member — `{{ constructor.constructor }}` and friends render as
nothing.

## Strict mode

With `strict: true` (the default), every root-scope name a template reads must exist in `variables`. This covers more
than Handlebars' own strict option, which only guards a bare `{{ name }}` — these all fail here, and would otherwise
render a silently empty table:

```hbs
{{#each actions}}…{{/each}}          {{! block argument }}
{{#if hasWorkflows}}…{{/if}}         {{! conditional argument }}
{{ join tags }}                      {{! helper argument }}
{{#each (sortBy actions "name")}}…   {{! sub-expression argument }}
```

Two consequences worth knowing:

- **A flag that is off must be declared as `false`, not omitted.** `{{#if hasWorkflows}}` requires `hasWorkflows` to be
  present in the payload.
- **Names inside a block body are not checked.** Within `{{#each actions}}`, `{{ name }}` resolves against an element of
  the array, whose shape `variables` does not describe. Checking there would report failures on templates that render
  correctly.

Set `strict: false` to render undefined references as empty strings instead.

## Partials

Every `.hbs` file under `partials-dir` is registered, recursively. A partial is addressed by its path relative to that
directory, without the extension:

```
docs/partials/footer.hbs         →  {{> footer }}
docs/partials/tables/actions.hbs →  {{> tables/actions }}
```

Partials are compiled with the same options as the template and may use the same helpers. They are **not** re-indented to
the column their `{{> }}` call sits at — Handlebars does that by default, which is right for HTML and wrong for Markdown,
where four leading spaces turn a table into a code block.

Pointing `partials-dir` at something that is not a readable directory fails the step rather than rendering a template
missing all its partials.

## Helpers

Every helper is deterministic. There is deliberately no `now`, `random`, `uuid` or environment access: a file regenerated
from unchanged inputs has to come out byte-identical.

### Markdown

| Helper             | Result                                                                                          |
| ------------------ | ----------------------------------------------------------------------------------------------- |
| `mdCell value`     | Escapes a value for one table cell: `\` and `|` are escaped, newlines become `<br>`.             |
| `mdEscape value`   | Escapes Markdown structural characters in inline text.                                            |

`mdCell` is the one a generated table needs most — an action description containing a pipe would otherwise split the
column, and one containing a newline would end the row.

### Ordering

| Helper             | Result                                                                                          |
| ------------------ | ----------------------------------------------------------------------------------------------- |
| `sort list`        | A copy ordered by code point.                                                                     |
| `sortBy list key`  | A copy ordered by one property, stable, so ties keep the order they were supplied in.             |

Ordering never consults the locale. `localeCompare` would depend on the runner's ICU data, so the same inputs could sort
differently on two machines and the generated file would flip back and forth in version control.

### Logic and comparison

| Helper           | Result                                                        |
| ---------------- | ------------------------------------------------------------- |
| `eq a b`         | `a === b`.                                                     |
| `ne a b`         | `a !== b`.                                                     |
| `lt a b`         | `a` orders before `b`.                                         |
| `gt a b`         | `a` orders after `b`.                                          |
| `and …`          | Every argument is truthy. An empty array counts as falsy.      |
| `or …`           | Any argument is truthy.                                        |
| `not a`          | The argument is falsy.                                         |

### Values

| Helper                        | Result                                                                  |
| ----------------------------- | ----------------------------------------------------------------------- |
| `join list [separator]`       | Joins with `separator`, defaulting to `, `.                              |
| `count value`                 | Length of a list or string, key count of an object.                      |
| `default value fallback`      | `fallback` when `value` is `null`, `undefined` or empty.                 |
| `json value [indent]`         | JSON text, with an optional indent width.                                |
| `upper value` / `lower value` | Case conversion, locale-independent.                                     |
| `trim value`                  | Surrounding whitespace removed.                                          |
| `replace value search to`     | Replaces every literal occurrence. Never a pattern, so never a ReDoS.    |

Helpers compose as sub-expressions:

```hbs
| Action | Description |
| --- | --- |
{{#each (sortBy actions "name")}}| `{{ name }}` | {{ mdCell description }} |
{{/each}}
```

## Line endings

Templates and partials are read with their line endings normalized to LF and a leading byte order mark stripped, and the
output is written the same way. Neither is content, but both would otherwise reach the output file and make a checkout on
a different machine look like a change.
