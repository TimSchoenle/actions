# The doc comment contract

What carries a doc comment, what that comment has to say, and what keeps it true after the commit
that wrote it. Prose style is [PROSE.md](../readme/PROSE.md), which already claims doc comments as
its scope; this is the structure half plus the tells that document comments have and READMEs do not.
Per-language mechanics are in [RUST.md](./RUST.md), [JAVA.md](./JAVA.md) and
[TYPESCRIPT.md](./TYPESCRIPT.md).

## Contents

- [The rule underneath](#the-rule-underneath)
- [What carries one](#what-carries-one)
- [Anatomy](#anatomy)
- [What the comment has to say](#what-the-comment-has-to-say)
- [Three tiers, and where rationale goes](#three-tiers-and-where-rationale-goes)
- [When rationale earns a place in the contract](#when-rationale-earns-a-place-in-the-contract)
- [What never goes in one](#what-never-goes-in-one)
- [Tells](#tells)
- [Examples are the only prose that cannot rot](#examples-are-the-only-prose-that-cannot-rot)
- [Surfaces that are not code comments](#surfaces-that-are-not-code-comments)
- [Enforcement](#enforcement)
- [Checks](#checks)
- [Rollout](#rollout)
- [Before you open the pull request](#before-you-open-the-pull-request)

## The rule underneath

**Say what the item does. Then say only what the signature cannot.**

Both halves are load-bearing and the second one is where this goes wrong. A signature states the
name, the parameter types, the return type, the error type, the visibility and whether the receiver is
borrowed. A comment repeating any of that is a second copy of a fact the compiler checks, and the
compiler will not check the copy. That is the [README contract's
rule](../readme/GUIDE.md#the-rule-underneath) moved one level down.

But a comment that skips straight to the exotic is worse than the copy. A reader who opens a
documentation page wants the behaviour first, and gets an essay about a design decision instead. So
the delete test applies to **every sentence after the summary**, not to the summary:

- The summary sentence is mandatory. It is never deleted, even when it feels obvious.
- Every sentence after it: delete it, read the signature. If the reader lost nothing, cut it.

## What carries one

Not everything. A rule that says _document every item_ produces `/// The name.` above `name`, which
costs a line, satisfies the lint, and teaches the next reader that comments here are decoration.

| Item                                           | Rule                                                                         |
| ---------------------------------------------- | ---------------------------------------------------------------------------- |
| Crate, package or module root                  | Mandatory. The longest comment in the repository lives here.                 |
| Any publicly exported item                     | Mandatory.                                                                   |
| A public field on a type that generates a file | Mandatory, and written for whoever reads the generated file, not the source. |
| A private item                                 | Only where the reason is not visible at the definition.                      |
| An override or trait impl                      | Only where the behaviour departs from the contract it inherits.              |

The private rule is judgement and stays judgement. `clippy::missing_docs_in_private_items` exists and
this estate does not enable it, because a private helper whose body is six obvious lines has nothing
to say, while the private constant whose value came out of a rate limit has everything to say. A lint
cannot tell those apart. A reviewer can.

## Anatomy

Four parts, always in this order.

1. **Summary sentence.** One sentence, third person present indicative, on one line, ending in a
   period. Start with the verb: `Resolves a tag to the commit SHA it points at.` Never `This function
resolves`, and never `Resolve`. Rustdoc and Javadoc both cut the index entry at the end of the
   first sentence, so a summary running to four lines becomes a search result nobody can scan.
2. **A blank line.** Both tools treat the first paragraph as the summary, so the blank line is what
   separates the index entry from the body. Without it the whole comment is the summary.
3. **The body**, if there is one. Most items do not need one.
4. **Named sections**, last.

Sections come after the body and examples come last within them, because a reader who opened the page
to find out what happens on failure should not have to scroll past a code block to reach it. Rust
orders them `# Errors`, `# Panics`, `# Safety`, `# Examples`, which is what `std` does.

## What the comment has to say

This is the part a rewrite gets wrong by aiming too high. Before any reasoning, any history and any
rejected alternative, the comment owes the reader the contract. Work down this table for the kind of
item in front of you and stop when you run out of facts.

| Kind               | The comment states                                                                                                                                                                                         |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Function or method | What it does or returns, in terms of its arguments. Then the unit, the accepted range, the behaviour at the boundary, whether it blocks or allocates, any ordering guarantee, and every failure condition. |
| Type or class      | What one value of it represents, and the invariant true of every value. How a caller obtains one. Whether copying is cheap.                                                                                |
| Field or property  | The meaning, the unit, the default, and what absent or empty means.                                                                                                                                        |
| Trait or interface | The contract an implementor has to uphold, and what a caller may rely on across implementations.                                                                                                           |
| Enum variant       | When this variant occurs. Not what its name already says.                                                                                                                                                  |
| Constant           | Where the value came from. A number with no provenance is the one comment that is always worth writing.                                                                                                    |
| Module or package  | What belongs here and what deliberately does not.                                                                                                                                                          |

Most items finish at the first sentence of that row, and that is the correct length. `Returns the
configured user, or `None` when unset or blank.` is a complete doc comment. Nothing has to be added to
it, and adding anything makes it worse.

The rest of the row is where the real content is, and it is almost never narrative:

> Sizes are in bytes. Zero disables the cache rather than caching nothing, which is the reading a
> deployment that sets the variable to empty gets.

Two facts, no history, and both are things a caller gets wrong without being told.

## Three tiers, and where rationale goes

Design reasoning belongs in the codebase. It mostly does not belong in the comment a caller reads,
and putting it there is what turns an API reference into a changelog with a table of contents.

| Marker                | Audience                   | Carries                                                                     |
| --------------------- | -------------------------- | --------------------------------------------------------------------------- |
| `///`, `/** */`       | Whoever calls the item     | The contract. What it takes to use this correctly.                          |
| `//`, plain comment   | Whoever edits the line     | Why the code is written this way. Never rendered, never a caller's problem. |
| `//!`, `package-info` | Whoever is new to the area | The design record. Alternatives rejected, and what would reopen them.       |

`crates/config/src/github.rs` in Portfolio already splits it correctly, and the split is easy to miss.
The rustdoc on `token` tells a caller how to supply a secret without it reaching the environment.
Directly underneath, a plain `//` comment explains why the field is `skip_serializing`, and it opens
by saying so:

> Not rustdoc: every `///` on a field in this crate is rendered into `config.example.toml` and into
> the README table, for an operator who is not reading the source. Why the attribute is
> `skip_serializing` is for whoever changes this line.

That is the whole rule, written by the person who needed it. Copy the split, not the length.

The crate roots in Portfolio's config crate and in terrace-config are long, and they are supposed to
be. They are tier three. **Do not copy their shape onto an item.**

## When rationale earns a place in the contract

One test: **would the caller do something different if they knew?** If yes, it belongs in the `///`.
If no, it is tier two or tier three.

It passes when the reasoning changes a decision the caller is about to make:

> The last three layers are mutually exclusive per key: a key supplied by two of them is refused at
> boot rather than resolved by precedence, because a stale environment variable shadowing a rotated
> mounted secret keeps the process running on the old credential.

A caller deploying this has to know the boot will fail, and the reason tells them which of their two
sources to remove. It fails when the reasoning is about the implementation's past:

> Thirty lines of `sed` used to live here.

True, useful, and a `//` comment. A caller does nothing differently for having read it.

Two more places rationale does not go: the rejected alternative nobody proposed, and the alternative
that was rejected for reasons the caller cannot act on. PROSE.md bans `rather than` on the first count
already.

## What never goes in one

- **The type.** `@param timeout the timeout` and `/// The username as an `Option<String>`.`
- **The name, reworded.** `/// Sets the timeout.` above `set_timeout` earns its line only by adding
  the unit, the range, or what happens at zero.
- **A section that exists because a lint asked for it.** `# Errors` reading _returns an error if the
  operation fails_ is worse than no section, because it looks answered.
- **A paragraph the README also carries.** Link to the item from the README, never a copy in the other
  direction.
- **The first person.** A rendered documentation page has no author on it, same as a README.
- **A changelog.** `#[deprecated]` and `@deprecated` are machine-readable and the release notes cover
  the rest.
- **A TODO.** It belongs in an issue, where it can be closed.

## Tells

PROSE.md's structural rules were written against READMEs. Seven markers are specific to doc comments
and are not on that list.

### The `This function` opener

`This function`, `This method`, `This struct`, `A utility that`, `Helper for`, `Used to`,
`Responsible for`. Rustdoc and Javadoc both render the summary next to the item's own name, so the
subject is already on screen. Start with the verb.

### The type, restated as prose

`Returns a `Result` containing the parsed configuration, or an error.` Every word of that is in the
signature. What the reader needs is which configuration, parsed from what, and which errors.

### Ceremony sections

A `# Errors` or `@throws` that names no condition, a `@param` that repeats the parameter name, a
`# Panics` reading _panics if the input is invalid_. Each of these is a lint being satisfied rather
than a reader being answered, and each is more common in generated text because the lint is the only
thing the generator could see.

### Uniform length

The strongest one, and no linter catches it. Text produced item by item comes out at a steady three to
five lines on everything, because each item was answered by the same prompt. Hand-written comments are
wildly uneven: most say one thing, a few say a great deal.

Portfolio's `crates/config` and `crates/data` hold 128 item comments with a median of **two lines**, a
mean of 3.5, a standard deviation of 3.7, and **41% of them one line long**. The longest is 21 lines.
That distribution is the signature of writing to the facts. A rewrite that lands at a mean of four
with a standard deviation near one has restated 128 signatures.

There is a [check](#checks) for this, and like PROSE.md's burstiness section it is informational.
Chasing the number produces its own pattern.

### Softeners and hedges

`Note that`, `Keep in mind`, `It is important to`, `Simply`, `Basically`, `Under the hood`,
`In other words`. Each one introduces a fact that should have been stated directly, or restates the
previous sentence. `In other words` is the strongest signal: the first attempt did not land and both
were kept.

### The tricolon summary

`Loads, validates and merges the configuration.` Three verbs weighted equally in a summary line is the
[rule of three](../readme/PROSE.md#threes-are-a-cadence-not-a-length) reaching the one sentence that
can least afford it. Name the one thing the item does. If it genuinely does three, that is a finding
about the item.

### Reference chains with no fact

`For more information, see [`Foo`].` A link belongs inside a sentence that says something, so the
reader knows whether following it is worth their time. RFC 1574 puts it plainly: type documentation
should be self-contained rather than a pointer elsewhere.

## Examples are the only prose that cannot rot

Three languages, three levels of checking, and the rule follows the checking rather than taste.

| Ecosystem  | Are examples compiled?                               | What follows                                                  |
| ---------- | ---------------------------------------------------- | ------------------------------------------------------------- |
| Rust       | Yes, `cargo test --doc` runs them                    | Prefer an example over the paragraph describing the same call |
| Java       | `{@snippet file=}` compiles, `<pre>{@code}` does not | Use external snippets from a real source set                  |
| TypeScript | No, nothing reads `@example`                         | One call, or move it to a test named after the item           |

In Rust an example is worth more than the paragraph it replaces, because CI breaks when it stops being
true. Use `?` rather than `unwrap`, since the block is going to be copied verbatim. Reach for `no_run`
when the example binds a port or opens a socket, and treat `ignore` as a code-shaped comment that
nothing checks, which needs a reason on the line above it.

## Surfaces that are not code comments

In four of these repositories the documentation a user actually reads is not in a comment at all, and
a rewrite that adds doc comments to those items would be writing the second copy.

| Repository      | Where the user-facing text lives                         | Rendered into                        |
| --------------- | -------------------------------------------------------- | ------------------------------------ |
| actions         | `description:` in each `action.yaml` and `workflow.yaml` | `README.md`, `SECURITY.md`           |
| helm-charts     | `# --` comments in `values.yaml`                         | each chart's `README.md`             |
| rewrite-recipes | `getDisplayName()` and `getDescription()`                | the OpenRewrite catalog              |
| Portfolio       | `///` on config fields                                   | `config.example.toml`, README tables |

Those strings are prose under [PROSE.md](../readme/PROSE.md) and belong to the README standard. The
comment on the surrounding class or struct is tier two or three and says something different: why the
recipe is written this way, what the visitor refuses to touch, which key the value ends up under.

## Enforcement

The gate goes in the same pull request as the comments. A rewrite without one is undone by the next
feature branch, because nothing stops an undocumented `pub fn` landing on Tuesday.

| Ecosystem  | Gate                                                                                    | Detail                           |
| ---------- | --------------------------------------------------------------------------------------- | -------------------------------- |
| Rust       | `missing_docs`, the rustdoc lint table, `RUSTDOCFLAGS: -D warnings`, `cargo test --doc` | [RUST.md](./RUST.md)             |
| Java       | `-Xdoclint:all -Werror` on `javac` and on the `javadoc` task                            | [JAVA.md](./JAVA.md)             |
| TypeScript | `eslint-plugin-tsdoc`, plus `jsdoc/require-jsdoc` scoped to exported items              | [TYPESCRIPT.md](./TYPESCRIPT.md) |

None of them catch a comment that restates its signature, which is the failure this document is
mostly about. That one is a review criterion, and pretending a linter could do it would produce
comments written to pass a linter.

## Checks

One is mechanical. The other is informational, in the same sense as PROSE.md's sentence statistics.

Openers, budget **zero**:

```bash
rg -n --pcre2 '^\s*(///|\*|//!)\s*(This (function|method|struct|class|enum|trait|module|field)|Used to |Helper (for|that)|Responsible for|A utility|Note that|In other words|Under the hood|Simply |Basically )' \
  --glob '!target' --glob '!dist' --glob '!node_modules'
```

Length distribution, no threshold to pass:

```bash
python - <<'PY'
import re, sys, glob, statistics
lens, run = [], 0
for fn in glob.glob('**/src/**/*.rs', recursive=True):
    if '/target/' in fn: continue
    for line in open(fn, encoding='utf-8'):
        if re.match(r'^\s*///', line):
            run += 1
        else:
            if run: lens.append(run)
            run = 0
    if run: lens.append(run); run = 0
if not lens: sys.exit('no doc comments found')
print(f"n={len(lens)} mean={statistics.mean(lens):.1f} median={statistics.median(lens)} "
      f"stdev={statistics.pstdev(lens):.1f} max={max(lens)} "
      f"one-line={100*sum(1 for x in lens if x == 1)/len(lens):.0f}%")
PY
```

A standard deviation under two, or a one-line share under fifteen percent, means the comments were
written to a template. Read twenty of them and cut every sentence that fails the delete test.

## Rollout

One pull request per repository, gate included. The order is chosen so that the repositories whose
comments other repositories read get fixed first.

| Order | Repository                                                                                     | Scope                                                                                                    |
| ----- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| 1     | terrace-config                                                                                 | Closest already. Fix the `docsrs` defect in [RUST.md](./RUST.md#the-docsrs-trap) and add `missing_docs`. |
| 2     | csp-shell                                                                                      | Library. Crate root, every export, doctests on the builder.                                              |
| 3     | Portfolio                                                                                      | `crates/config` is the model. `crates/data`, `apps/*` follow it.                                         |
| 4     | TankoVault                                                                                     | Multi-service. One root comment per service saying what it owns.                                         |
| 5     | senec-v3-collector, s3-bucket-perma-link, cloudflare-access-webhook-redirect, netcup-offer-bot | Single-purpose services. Root comment plus the failure posture.                                          |
| 6     | mp-stats-legacy-viewer                                                                         | Root comment covering the sharded binary format, which nothing else records.                             |
| 7     | gradle-jextract                                                                                | `package-info.java` currently carries `@NullMarked` and no comment.                                      |
| 8     | rewrite-recipes                                                                                | Recipe classes. The catalog strings are already prose, so this is maintainer documentation only.         |
| 9     | actions                                                                                        | Maintainer-facing only. `action.yaml` stays the user-facing contract.                                    |
| 10    | helm-charts                                                                                    | Audit `# --` coverage against `values.schema.json`, which is generated.                                  |

Archived repositories are out of scope. So is `actions-testing`, which has no source.

## Before you open the pull request

1. Every comment states what the item does before it states anything else.
2. Run the delete test on every sentence after the summary. Signature first, sentence second.
3. No summary opens with `This function` or any of its relatives. The opener check is at zero.
4. Every rationale sentence in a `///` passes the caller test. The rest moved to `//` or the root.
5. No `@param`, `# Errors` or `@throws` exists solely because a lint demanded it.
6. Every claimed failure condition is one a test could trigger.
7. Doctests run. Java snippets come from a compiled source set.
8. The length distribution does not look like a template.
9. The lint gate is in this pull request, not a follow-up.
