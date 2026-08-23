# Prose contract

How prose is written in this estate: READMEs, template `.hbs` files, `docs/`, doc comments,
commit bodies, pull request descriptions.

It exists because generated documentation that reads like generated _prose_ wastes the point of
generating it. A reader who can tell a paragraph was produced rather than written stops trusting
the tables next to it.

This is the writing half of the README standard. [GUIDE.md](./GUIDE.md) covers the other half: which
sections appear, in what order, and what generates each. [EXAMPLE.md](./EXAMPLE.md) shows both
applied to a real repository.

## Contents

- [The one test](#the-one-test)
- [Where the house voice already exists](#where-the-house-voice-already-exists)
- [Structural rules](#structural-rules)
- [Word-level rules](#word-level-rules)
- [Rhythm](#rhythm)
- [What is not a rule](#what-is-not-a-rule)
- [Worked examples](#worked-examples)
- [Checks](#checks)
- [Before you commit](#before-you-commit)

## The one test

**Delete the sentence. Did the reader lose a fact?**

If not, it was there for rhythm, and it goes. This single test catches most of what follows:
balanced pairs, aphorisms, three-item lists padded to three, and glossing clauses all fail it.
Apply it first and the rest of this document is mostly explanation.

A corollary: a sentence that would be true in any README belongs in none of them.

## Where the house voice already exists

The code comments in these repositories are already written the right way. The READMEs are not.
Closing that gap is the whole job.

From `crates/config/examples/config-schema.rs`:

> One flat table of every key says that a deployment needs a GitHub token. It does not.
> `github.*` belongs to `update-repos`, a build-time tool that lists repositories and exits
> during the image build; the SSR server never loads it and never sees it.

Note what that does. It states a wrong belief, refuses it in three words, then gives the
mechanism that makes the refusal true. No sentence is decorative. The second sentence is three
words long because three words was enough.

From `.github/workflows/update-files.yaml`:

> Thirty lines of `sed` used to live here, and the region it cut was the one thing this workflow
> and the gate in `build.yaml` had to agree about — written by hand in one file and read by hand
> in another.

That has a history in it. Something used to be one way, it caused a specific problem, it is now
another way. Generated prose never has a history, because nothing happened to it.

**When in doubt, write the README paragraph the way you would write the comment above the code
it describes.**

## Structural rules

These are the patterns that mark text as machine-written. Each is a shape, not a word, which is
why spell-checking a vocabulary list does not fix the problem.

### Do not manufacture parallelism

The tell: a colon followed by two or more clauses of identical grammatical shape.

> One crate compiles to both halves of the site: a native Axum server that renders every route
> server-side, and a WASM client that hydrates it.

Two noun phrases, each with a `that`-clause, weighted the same. The symmetry is invented. Worse,
both clauses restate a tagline three lines above.

Balanced pairs are correct when the thing described is actually symmetric. `apps/web` really does
build twice under two features, so a sentence with two halves is honest there. The rule is not
_avoid parallelism_. It is _do not impose it_.

### Announce nothing before you say it

"Both halves of the site" tells the reader a shape is coming instead of giving them the content.
So do "there are three things to know", "it is worth noting that", and "the key insight is".
Cut the announcement and start at the content.

### No negative parallelisms

Ban on sight:

- `not just X, but Y`
- `it's not X, it's Y`
- `X isn't about A, it's about B`

`X rather than Y` is allowed only when the rejected alternative is real and named for a reason —
"the load fails rather than picking one" is a genuine design decision. "Interactive sections
rather than a static page" is not; nobody proposed a static page.

### No aphorisms

> It is published here to be read as much as to be run.

Deleted. It sounds like a thesis and carries nothing. If a sentence would look at home on a
conference slide, it does not belong in a README.

### Threes are a cadence, not a length

Generated prose defaults to three-item lists because three sounds finished. Count the facts, then
write that many. Two is fine. Five is fine. If you wrote three, check that a fourth did not get
dropped for rhythm and that a second was not padded up.

### Prefer `is`

`serves as`, `stands as`, `functions as`, `operates as`, `represents`, `boasts`, `features`,
`offers` are copula avoidance. They read as padding because they are longer than _is_ without
being more precise.

Exception: use the specific verb when it is specific. "`build.rs` embeds the fingerprint" is
better than "the fingerprint is in the binary", because _embeds_ names the mechanism.

### No glossing participles

`highlighting`, `underscoring`, `ensuring`, `reflecting`, `showcasing`, `contributing to`,
`enabling`, `allowing for` at the end of a sentence almost always restate what the sentence
already said. Cut the clause, or promote it to a sentence with a fact in it.

### Name the mechanism, not its shape

| Shape                                         | Mechanism                                              |
| --------------------------------------------- | ------------------------------------------------------ |
| one crate compiles to both halves of the site | `apps/web` builds twice under two features             |
| the configuration is kept in sync             | the tables are generated from the types that load them |
| a robust security posture                     | no writable volume, not even `/tmp`                    |
| flexible deployment options                   | Docker, Helm, or `cargo run`                           |

The right-hand column is checkable. That is the difference.

### Vary the bullet frame

Eight consecutive `**Bold** — gloss` bullets read as a generated list even when every line is
true. Mix plain sentences with bolded lead-ins. Use the bold only where the term genuinely
deserves a label a reader will scan for.

## Word-level rules

Two lists. The first is a genuine ban. The second needs judgement.

### Banned

`delve`, `showcase`, `underscore` (as a verb), `testament`, `tapestry`, `landscape` (figurative),
`interplay`, `realm`, `foster`, `garner`, `bolster`, `myriad`, `plethora`, `seamless`,
`seamlessly`, `elevate`, `unlock` (figurative), `leverage` (as a verb), `it's worth noting`,
`in today's world`, `at its core`, `dive into`, `game-changer`, `best-in-class`, `cutting-edge`,
`state-of-the-art`, `powerful` (unqualified).

### Allowed only with a measurement attached

`robust`, `crucial`, `pivotal`, `key`, `significant`, `comprehensive`, `extensive`, `meticulous`,
`efficient`, `scalable`, `secure`, `simple`, `easy`, `intuitive`.

These have real technical meanings and blanket-banning them is bad advice. But each is a claim,
and a claim needs a number or a mechanism next to it. "Robust against secret rotation" is empty.
"Reloads the mounted secret without restarting the process" is the same claim, checkable.

`simple` and `easy` carry an extra risk: they describe the reader's experience, which you cannot
know. Say what it takes instead. "One command" beats "easy to install".

### Straight quotes and apostrophes

Curly quotes in a repository file usually mean the text came from somewhere that autocorrects.
Use `'` and `"`.

## Rhythm

Human writing alternates short and long sentences because meaning demands it. Model output holds
a steadier rhythm. The measurable version is _burstiness_: the standard deviation of sentence
length in words.

Do not chase the number. Forcing variation produces its own mechanical pattern, which is worse
than the flat one because it looks like an attempt. Variation is a symptom of writing to the
facts, not a technique.

What to do instead: after a long sentence that establishes something, check whether the next
point can be made in five words. Usually it can, and usually the long sentence was carrying two
facts that should have been two sentences.

For reference, the revised Portfolio README sits at a mean of 13 words, median 11, standard
deviation 9, with a quarter of its sentences under eight words. That came out of cutting, not out
of aiming for it.

## What is not a rule

Guard against over-correcting. The following are fine and should not be edited out:

- **Em dashes with a job.** A dash setting off a genuine aside, or standing in a definition list,
  is correct punctuation. The budget below is about dashes doing a full stop's work.
- **Long sentences.** A sentence carrying a real chain of causation can run forty words. The
  problem is never length; it is a long sentence carrying one fact.
- **Parallel structure that mirrors real symmetry.** Two features, two builds, two tables.
- **Repetition of a term.** Calling the same thing by the same name every time is a virtue in
  technical writing. Do not reach for a synonym to avoid repeating `payload`.
- **Bullet lists.** They are the right form for a set of independent facts. The rule is about
  their frame being identical, not about their existence.
- **The first person.** "I split the tables because a single list implies a deployment needs a
  token" is fine in a commit body or a pull request. It is not fine in a README, which has no
  author on the page.

## Worked examples

Each of these is real, from the Portfolio README rewrite.

### 1

**Before** (25 words, two facts, both already stated above it)

> One crate compiles to both halves of the site: a native Axum server that renders every route
> server-side, and a WASM client that hydrates it.

**After** (three sentences, names the features, no metaphor)

> `apps/web` is a single crate with two feature-selected builds. The `server` build is an Axum
> binary that renders HTML. The `web` build is a WASM bundle that takes over in the browser.

### 2

**Before** (rule of three, then a personified flourish; a field does not _arrive_)

> The configuration tables, the example config file and the image's own contract labels are all
> generated from the Rust types that load them, so a renamed field arrives with its documentation
> already corrected.

**After**

> The configuration tables below are generated, not written. They come out of the Rust types that
> load the configuration, as do `config.example.toml` and the image's contract labels, so renaming
> a field corrects all three in the commit that renames it.

### 3

**Before** (dash doing a full stop's job)

> Pin by digest in production — the Helm chart does.

**After**

> Pin by digest in production. The Helm chart does.

### 4

**Before** (a dash pair wrapped around a four-item list, inside one 21-word sentence)

> Full detail — CSP construction, security headers, reproducible builds and the image's
> self-describing config contract — is in [docs/DEPLOYMENT.md] and [docs/SECURITY_POSTURE.md].

**After**

> CSP construction, the security headers, the reproducible-build setup and the image's
> self-describing config contract are documented in [docs/DEPLOYMENT.md] and
> [docs/SECURITY_POSTURE.md].

### 5

**Before** (semicolon, then a relative clause explaining the document's own structure, then a
dash carrying the actual point)

> It runs during the image build and exits; the server never reads these, which is why they are a
> separate table — a deployment does not need a GitHub token.

**After**

> It runs during the image build and exits. The server never reads these keys, so a deployment
> needs no GitHub token. That is why there are two tables and not one.

## Checks

Two of these rules are mechanical enough to measure. Run them against a rendered README before committing prose.

Em dashes outside tables and definition lists, budget **five per document**:

````bash
awk '/^```/{f=!f; next} !f' README.md   | sed -e '/^|/d' -e '/^[0-9]\+\. /d' -e 's/`[^`]*`//g'   | grep -o '—' | wc -l
````

That strips fenced blocks, table rows, numbered definition lists and inline code before counting.
A check that miscounts is a check people learn to ignore.

Consecutive bullets sharing the `**Bold** —` frame, budget **three**:

```bash
grep -c '^- \*\*.*\*\* —' README.md
```

Sentence length distribution. There is no threshold to pass; this is for information only:

````bash
python - <<'PY'
import re, statistics
t = re.sub(r'```.*?```|<!--.*?-->', '', open('README.md', encoding='utf-8').read(), flags=re.S)
p = ' '.join(l for l in t.split('\n') if not l.startswith(('|', '#', '- ', '[!')))
n = [len(s.split()) for s in re.split(r'(?<=[.!?])\s+', p) if len(s.strip()) > 3]
print(f"n={len(n)} mean={statistics.mean(n):.1f} median={statistics.median(n)} "
      f"stdev={statistics.pstdev(n):.1f} under8={100*sum(1 for x in n if x<8)/len(n):.0f}%")
PY
````

The em-dash count is a candidate for the `readme` drift gate, which already blocks a merge when
the rendered file is stale. Nothing else here can be linted, and pretending otherwise would
produce prose written to pass a check.

## Before you commit

1. Run the delete test on every sentence in any paragraph you touched.
2. Search the diff for a colon followed by two same-shaped clauses.
3. Count em dashes. Five.
4. Check the bullet frames are not all identical.
5. Search for `not just`, `rather than`, `serves as`, `it's worth noting`.
6. Read the first paragraph aloud. If it sounds like it is introducing itself rather than telling
   you something, rewrite it.
7. Ask whether any sentence would be equally true of a different project. Delete it if so.

## Scope

This applies to prose written by anyone, including a model. When a model drafts a README, template,
`docs/` page, commit body or pull request description, this document is the review criteria rather
than a suggestion — say so in the prompt and hand it this file.

It lives here because this is the repository every other one already consumes from. Link to it from a
`CONTRIBUTING.md` rather than copying it: a style guide with two copies is the drift this whole
system exists to prevent.
