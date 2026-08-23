# Java

The Javadoc half of [GUIDE.md](./GUIDE.md), for gradle-jextract (JDK 25) and rewrite-recipes
(JDK 21). Both are past JDK 18, so every feature below is available in both.

## Contents

- [Current state](#current-state)
- [The gate](#the-gate)
- [What doclint checks](#what-doclint-checks)
- [`package-info.java` is the root comment](#package-infojava-is-the-root-comment)
- [The three audience tags](#the-three-audience-tags)
- [JSpecify already says it](#jspecify-already-says-it)
- [Snippets, not `<pre>{@code}`](#snippets-not-precode)
- [The first sentence trap](#the-first-sentence-trap)
- [OpenRewrite recipes are two documents](#openrewrite-recipes-are-two-documents)

## Current state

Neither repository has any Javadoc. `MigrateGuiToNewApi` carries none on the class, none on the
visitor, and none on the four `MethodMatcher` constants that encode the actual migration. The one
`package-info.java` in gradle-jextract holds `@NullMarked` and nothing else:

```java
@org.jspecify.annotations.NullMarked
package de.timscho.jextract;
```

That file already exists, which means the rewrite for these two repositories is additive. Nothing has
to be undone first.

gradle-jextract publishes a Javadoc jar through `JavadocJar.Javadoc()` in the vanniktech publish
plugin, so its comments are already an artefact consumers download. They are currently an empty one.

## The gate

Both halves, because `javac` and the `javadoc` tool run doclint separately and catch different files.

```kotlin
tasks.withType<JavaCompile>().configureEach {
    options.compilerArgs.addAll(listOf("-Xdoclint:all/protected", "-Werror"))
}

tasks.withType<Javadoc>().configureEach {
    (options as StandardJavadocDocletOptions).apply {
        addStringOption("Xdoclint:all/protected", "-quiet")
        addBooleanOption("Werror", true)
    }
}
```

`/protected` is the access level, and it is the right one: it covers public and protected members,
which is exactly the surface a consumer of a Gradle plugin or a recipe catalog can reach. Package-private
and private members fall under the judgement rule in [GUIDE.md](./GUIDE.md#what-carries-one).

`-Werror` is what makes it a gate. Without it doclint prints and the build stays green.

## What doclint checks

Five groups, each enabled or disabled by name, with `-Xdoclint:all,-missing` meaning everything except
one.

| Group           | What it catches                                                          |
| --------------- | ------------------------------------------------------------------------ |
| `accessibility` | Tables without captions, images without alt text, heading levels skipped |
| `html`          | Malformed or unclosed HTML in a comment                                  |
| `missing`       | A missing comment, or a missing `@param`, `@return` or `@throws`         |
| `reference`     | `@link`, `@see` and `@throws` naming something that does not exist       |
| `syntax`        | Malformed tags, unescaped `<` and `&`                                    |

`reference` is the one that pays for the rest. It is the Java equivalent of denying
`broken_intra_doc_links`: a `{@link}` to a renamed class renders as plain text, so the reader who
needs it cannot tell it was ever a link.

`missing` is the group that argues with [GUIDE.md](./GUIDE.md#what-never-goes-in-one), because it will
demand a `@param` on a parameter whose name says everything. Keep it on and treat the demand as a
prompt rather than a form. A `@param` that has nothing to add about unit, range, nullability or what
happens at zero is telling you the parameter is either misnamed or should not be in the signature.

## `package-info.java` is the root comment

Every package gets one, and it carries the comment described in
[GUIDE.md](./GUIDE.md#what-carries-one): what this package is for, what belongs in it, and what a
reader has to know before any class in it makes sense.

```java
/**
 * Downloads a pinned jextract and runs it over a header set to produce Java FFM bindings.
 *
 * <p>The download is content-addressed and cached under the Gradle user home, so a build that
 * already has the archive does no network work. Everything under this package assumes the
 * toolchain resolved by {@code JextractExtension}, never the JDK running Gradle.
 */
@org.jspecify.annotations.NullMarked
package de.timscho.jextract;
```

Note the `<p>` opening the second paragraph. Javadoc is HTML, so a blank line alone renders as one
run-on paragraph, and the `html` doclint group will not complain because nothing is malformed.

## The three audience tags

Java splits what Rust puts in one comment. Use the split; it is the reason a reader can tell a promise
from an implementation detail.

| Tag         | Binds          | Use for                                                        |
| ----------- | -------------- | -------------------------------------------------------------- |
| `@apiNote`  | Nobody         | Guidance to the caller. Why you would use this over the other. |
| `@implSpec` | Every subclass | The contract an override must honour.                          |
| `@implNote` | Nobody         | What this implementation happens to do today.                  |

The distinction is load-bearing on anything overridable. `@implSpec` is a promise a subclass may rely
on and you may not quietly change; `@implNote` is a fact about the current body that a subclass must
not depend on. Putting the second where the first belongs is how a private detail becomes a public
contract without anyone deciding to make it one.

Plain body text before any tag is the specification itself, which binds everyone.

## JSpecify already says it

Both repositories are `@NullMarked`. That annotation is checked by a static analyser and by any
consumer's build. A `@param x the x, may be null` next to it is the second copy, and it is the copy
that will be wrong after the signature changes.

Document what nullability means here, not that it exists. _Null selects the toolchain Gradle is
running on_ is a fact. _May be null_ is the annotation, restated in prose that nothing verifies.

## Snippets, not `<pre>{@code}`

`{@snippet}` arrived in JDK 18 and both repositories are past it. The external form is the one worth
using:

```java
/**
 * {@snippet file="JextractSnippets.java" region="basic-usage"}
 */
```

The referenced file lives in a snippet source set and is compiled by the build, so an example that
stops compiling breaks CI. An inline `<pre>{@code ...}</pre>` block is checked by nothing, which puts
it in the same category as a Rust `ignore` doctest.

This is the only mechanism in Java that gets examples to the level Rust doctests reach by default. Use
it where an example is worth having, and write no example at all where it is not.

## The first sentence trap

Javadoc cuts the summary at the first sentence, and its sentence detection ends at a period followed
by whitespace. A summary containing `e.g. ` or `i.e. ` is therefore truncated mid-thought in every
index and every package summary table, while the full comment renders correctly on the detail page.
The bug is invisible from the source.

`{@summary}` makes the boundary explicit and is the fix:

```java
/**
 * {@summary Resolves the jextract archive for the current platform, e.g. linux-x64.}
 */
```

Avoiding the abbreviation is usually better. Reach for the tag when the abbreviation is the clearest
wording.

## OpenRewrite recipes are two documents

`getDisplayName()` and `getDescription()` are rendered into the recipe catalog and read by people
choosing a recipe. They are user-facing prose and they are covered by
[PROSE.md](../readme/PROSE.md), not by this file. `"Migrates safe Gui API renames from InvUI v1 to
v2."` is already correct: it names the mechanism, and the word _safe_ is doing real work.

The Javadoc on the recipe class answers a different question, for a maintainer:

```java
/**
 * Renames the four {@code Gui} members that moved without changing semantics between InvUI 1.x
 * and 2.x.
 *
 * <p>Only renames. {@code normal(Consumer)} is migrated through a template rather than a rename
 * because v2 moved the consumer onto the builder, and anything whose argument list changed shape
 * is deliberately out of scope: a partial migration that compiles is worse than one that does not.
 *
 * @implNote The matchers are held as constants so the visitor allocates none per file. A recipe
 *           runs over every source in a repository, and {@code MethodMatcher} parses its pattern
 *           on construction.
 */
```

The description says what it does. The Javadoc says what it refuses to do and why, which is the fact
that stops the next person extending it in the direction that breaks builds.
