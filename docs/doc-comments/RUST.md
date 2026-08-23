# Rust

The rustdoc half of [GUIDE.md](./GUIDE.md). Every lint level below was read off `rustc -W help` and
`cargo clippy -- -W help` on 1.97.1 rather than copied from a blog post, because several of these
changed default in the last two years.

## Contents

- [The lint tables](#the-lint-tables)
- [What each lint actually covers](#what-each-lint-actually-covers)
- [The `docsrs` trap](#the-docsrs-trap)
- [Feature-gated documentation](#feature-gated-documentation)
- [Doctests](#doctests)
- [Do not include the README](#do-not-include-the-readme)
- [The CI job](#the-ci-job)

## The lint tables

Declared on the workspace and inherited with `[lints] workspace = true` in every member, so a macro
crate cannot be held to a looser standard than the crate it writes code for.

```toml
[workspace.lints.rust]
missing_docs = "warn"

[workspace.lints.clippy]
pedantic = { level = "warn", priority = -1 }
missing_errors_doc = "warn"
missing_panics_doc = "warn"
doc_markdown = "warn"
too_long_first_doc_paragraph = "warn"
doc_link_with_quotes = "warn"
doc_broken_link = "warn"
doc_include_without_cfg = "warn"

[workspace.lints.rustdoc]
broken_intra_doc_links = "deny"
private_intra_doc_links = "warn"
unescaped_backticks = "warn"
```

`missing_errors_doc` and `missing_panics_doc` are already in `pedantic`; naming them again is how the
next reader learns they are deliberate rather than swept in with the group. `missing_safety_doc` is
warn by default and needs no line, and in a crate with `unsafe_code = "forbid"` it can never fire.

`clippy::missing_docs_in_private_items` is deliberately absent. See
[GUIDE.md](./GUIDE.md#what-carries-one).

## What each lint actually covers

`missing_docs` fires on the crate root, every module, function, struct, enum, trait, and **every
public struct field**, and stays quiet on anything private. Verified on 1.97.1 against a crate with
one of each. That makes `rustdoc::missing_crate_level_docs` redundant, so it is not in the table
above.

The rustdoc lints that are already warn by default and therefore need no line: `bare_urls`,
`invalid_codeblock_attributes`, `invalid_html_tags`, `invalid_rust_codeblocks`,
`redundant_explicit_links`, `unportable_markdown`. They only run under `rustdoc`, never `cargo check`,
which is why the documentation job in [the CI section](#the-ci-job) has to exist as its own step.

`broken_intra_doc_links` is denied rather than warned for one reason: a broken link renders as the
literal text ``[`Foo`]`` on the page, so it is invisible to the person reading the rendered output and
visible only to the person who no longer needs it.

Two clippy lints are worth the line even though they look cosmetic. `doc_markdown` catches a
`snake_case` or `CamelCase` identifier written outside backticks, which rustdoc otherwise renders as
prose and which then cannot be searched. `too_long_first_doc_paragraph` catches the missing blank line
from [GUIDE.md](./GUIDE.md#anatomy), where the whole comment becomes the index entry.

## The `docsrs` trap

Current terrace-config `src/lib.rs` ends its attribute block with:

```rust
#![cfg_attr(docsrs, feature(doc_auto_cfg))]
```

That line no longer compiles. `doc_auto_cfg` was **removed in Rust 1.92.0** and merged into
`doc_cfg`, so the moment anything sets `--cfg docsrs` the build fails with `E0557: feature has been
removed`. It is currently invisible for two reasons that both stop being true at once: nothing in CI
passes `--cfg docsrs`, and the crate is `publish = false`, so docs.rs never builds it and the
`rustdoc-args` under `[package.metadata.docs.rs]` are read by nothing.

The working spelling on nightly 1.99 is two attributes:

```rust
#![cfg_attr(docsrs, feature(doc_cfg))]
#![cfg_attr(docsrs, doc(auto_cfg))]
```

`#[doc(auto_cfg)]` is still unstable, tracked in rust-lang/rust#43781. So the estate has one decision
to make per crate:

- **Stable only.** Delete both lines and the `[package.metadata.docs.rs]` table. Feature badges are
  lost, and the gated `doc` attributes described below carry the same information as prose.
- **Keep the badges.** Add a `cargo +nightly doc --all-features` step with `RUSTDOCFLAGS="--cfg
docsrs -D warnings"`, and accept that one CI job pins nightly.

Take the first for anything `publish = false`. The metadata table has no reader.

## Feature-gated documentation

A crate whose features change which items exist cannot document them all in one `//!` block, because
`broken_intra_doc_links` is denied and a link to a gated item does not resolve when the gate is off.
terrace-config solves this by writing the crate documentation as gated `doc` attributes:

```rust
#![cfg_attr(feature = "reload", doc = r"
# Reloading

[`reload::run`] takes the closure that builds your whole runtime and re-runs it whenever the
watched directories change and then go quiet.
")]
```

Each section renders only when the feature that defines its links is on, so
`cargo doc --no-default-features --features reload` is a coherent page rather than a wall of
unresolved links. That is the pattern for any crate with more than two independent features.

## Doctests

They run under `cargo test --doc`, and that is the entire argument for preferring them to prose.

- `?` rather than `unwrap`, since readers copy the block.
- `no_run` when the example binds a port, opens a socket or reads the clock. It still compiles.
- `ignore` needs a `//` reason above it. An ignored block is a code-shaped comment that nothing
  checks, and it will be wrong within two releases.
- `compile_fail` is the right way to document a constraint the type system enforces, and it is
  checked.
- No `fn main`. `clippy::needless_doctest_main` catches it; rustdoc wraps the block already.
- No `#[test]` inside one. `clippy::test_attr_in_doctest` catches that.

A hidden `# use` line for the imports keeps the example short without making it uncopyable.

## Do not include the README

`#![doc = include_str!("../README.md")]` is a common pattern and it is wrong in this estate,
specifically. Every README here is rendered from a Handlebars template by the
[README standard](../readme/GUIDE.md), so including one pulls a badge row, an interpolated version
string and an HTML provenance banner onto the front page of the API documentation. It also creates
the second copy the whole system exists to prevent, and it makes the documentation job depend on a
file that CI regenerates.

The crate root comment and the README are two documents for two readers. The README says what the
repository is and how to deploy it. The crate root says what the API is and which invariants hold.
Where they overlap, the README links to the item.

`clippy::doc_include_without_cfg` is in the table for the case where an included file is genuinely
right: it catches an `include_str!` that is not behind `cfg(doc)`, which otherwise embeds the file in
every build.

## The CI job

terrace-config already has the shape. Copy it rather than inventing one.

```yaml
doc:
  name: doc
  runs-on: ubuntu-latest
  env:
    RUSTDOCFLAGS: '-D warnings'
  steps:
    # ...checkout and toolchain...

    # Once per feature set: the crate documentation is itself feature-gated, so a broken
    # intra-doc link can hide in a set `--all-features` never renders.
    - run: cargo doc --all-features --no-deps
    - run: cargo doc --no-default-features --features loader --no-deps
    - run: cargo test --doc --all-features
```

The per-feature repetition is not thoroughness for its own sake. `--all-features` renders every gated
section, so a link that only breaks when a feature is off never appears in that run.

Add `doc` to the `needs:` list of whatever job gates the merge. A documentation job that is not
required is a documentation job that goes red on `main` and stays there.
