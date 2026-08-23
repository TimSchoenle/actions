# Writing doc comments

How every repository here documents its own code: one contract for what carries a comment and what
that comment contains, and one annex per language for the lints that keep it true.

The idea underneath is the same one the [README standard](../readme/README.md) runs on. A README
states facts that live in a manifest, so it reads them from the manifest. A doc comment sits next to a
signature that already states the name, the types and the error, so it says what it does and then only
the part the signature cannot hold: the unit, the boundary, the invariant, the failure. Anything else
is a second copy, and the compiler only checks the first one.

## What is here

| File                                | Read it when                                                                              |
| ----------------------------------- | ------------------------------------------------------------------------------------------ |
| [GUIDE.md](./GUIDE.md)              | Writing or reviewing any doc comment. What carries one, what it has to say, the tells, and the rollout order. |
| [RUST.md](./RUST.md)                | Working in a Rust repository. Lint tables, doctests, feature-gated documentation, the `docsrs` defect. |
| [JAVA.md](./JAVA.md)                | Working in gradle-jextract or rewrite-recipes. Doclint groups, `package-info.java`, snippets. |
| [TYPESCRIPT.md](./TYPESCRIPT.md)    | Working in actions or TimSchoenle. The allowed tag set, and why it is short.                |
| [PROSE.md](../readme/PROSE.md)      | Always. It already claims doc comments as its scope, and this standard does not restate it. |

## The short version

1. Say what the item does. Then apply the delete test to every sentence after that one.
2. Work down the [content table](./GUIDE.md#what-the-comment-has-to-say) for the kind of item in front
   of you: the unit, the boundary, the invariant, the failure. Most items finish at the first row.
3. Three markers, three audiences. `///` is the contract a caller reads, `//` is why the code is like
   this, and the root comment is the design record. Reasoning goes in the last two unless a caller
   would act on it.
4. Every exported item is mandatory. Private items are judgement, and stay judgement.
5. Prefer an example the build compiles over a paragraph nothing checks.
6. Turn the lint gate on in the same pull request that writes the comments.

## What this is not

It is not a rule that everything gets a comment. That rule produces `/// The name.` above `name`,
which satisfies a linter and teaches the next reader that comments here are decoration.

It is not a licence to write history where the contract belongs. A caller opening a documentation page
wants the behaviour, and an item comment that opens with a design decision has answered a question
nobody asked. [GUIDE.md](./GUIDE.md#three-tiers-and-where-rationale-goes) says which marker takes it.

It is also not a home for prose a user reads. Four repositories keep that in `action.yaml`,
`values.yaml`, a recipe's `getDescription()` or a config field that renders into
`config.example.toml`. Those are covered by the README standard, and
[GUIDE.md](./GUIDE.md#surfaces-that-are-not-code-comments) says which is which so the rewrite does not
document the wrong file.
