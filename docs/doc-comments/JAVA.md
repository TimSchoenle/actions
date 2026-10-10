# Java

The Javadoc half of [GUIDE.md](./GUIDE.md), for gradle-jextract (JDK 25) and rewrite-recipes
(JDK 21). Both are past JDK 18, so every feature below is available in both.

## Contents

- [Current state](#current-state)
- [The gate](#the-gate)
- [What doclint checks](#what-doclint-checks)
- [What Checkstyle adds](#what-checkstyle-adds)
- [`package-info.java` is the root comment](#package-infojava-is-the-root-comment)
- [The three audience tags](#the-three-audience-tags)
- [JSpecify already says it](#jspecify-already-says-it)
- [Snippets, not `<pre>{@code}`](#snippets-not-precode)
- [The first sentence trap](#the-first-sentence-trap)
- [OpenRewrite recipes are two documents](#openrewrite-recipes-are-two-documents)

## Current state

Both repositories carry the standard: gradle-jextract since TimSchoenle/gradle-jextract#218, and
rewrite-recipes since TimSchoenle/rewrite-recipes#129. Their builds are the reference gates, and each
records a trap this page now repeats.

- **gradle-jextract**, `build.gradle.kts`. Holds `de.timscho.jextract.internal` out of doclint with
  `-Xdoclint/package`, because Lombok and the buildConfig plugin write members nobody can comment,
  and excludes the same packages from the published Javadoc jar so the gate covers exactly what
  ships. Both spellings, `-a.b` and `-a.b.*`, are needed: the wildcard matches subpackages and not
  the package itself.
- **rewrite-recipes**, `buildSrc/src/main/kotlin/rewrite.java-conventions.gradle.kts`. The plain
  form below, in one convention plugin.

gradle-jextract publishes a Javadoc jar through `JavadocJar.Javadoc()` in the vanniktech publish
plugin, so its comments are an artefact consumers download.

## The gate

Both halves, because `javac` and the `javadoc` tool run doclint separately and catch different files.

```kotlin
tasks.withType<JavaCompile>().configureEach {
    options.compilerArgs.addAll(listOf("-Xdoclint:all/protected", "-Werror"))
}

tasks.withType<Javadoc>().configureEach {
    (options as StandardJavadocDocletOptions).apply {
        memberLevel = JavadocMemberLevel.PROTECTED
        addStringOption("Xdoclint:all", "-quiet")
        addBooleanOption("Werror", true)
        tags(
            "apiNote:a:API Note:",
            "implSpec:a:Implementation Requirements:",
            "implNote:a:Implementation Note:",
        )
    }
}
```

`/protected` is the access level, and it is the right one: it covers public and protected members,
which is exactly the surface a consumer of a Gradle plugin or a recipe catalog can reach.
Package-private and private members fall under the judgement rule in
[GUIDE.md](./GUIDE.md#what-carries-one).

**The two halves spell the level differently.** `javac` takes it as the `/protected` suffix. The
`javadoc` tool rejects that suffix and takes the level from its own `-protected` flag, which is what
`memberLevel` sets. Copying the `javac` spelling onto the `javadoc` task fails the task before it
reads a single comment.

`-Werror` is what makes it a gate. Without it doclint prints and the build stays green.

`tags(...)` registers [the three audience tags](#the-three-audience-tags). The standard doclet knows
`@apiNote`, `@implSpec` and `@implNote` only inside the JDK's own build. Anywhere else an
unregistered block tag is a `javadoc` error, so the first `@implNote` fails the build whether or not
`-Werror` is set.

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

## What Checkstyle adds

The shared rulesets in [`configs/checkstyle/`](../../configs/checkstyle) check Javadoc too, and
they overlap doclint without matching it.

| Module                              | Library tier                                                              | Application tier |
| ----------------------------------- | ------------------------------------------------------------------------- | ---------------- |
| `JavadocMethod`                     | Public and protected members; `@Override` exempt; `allowMissingReturnTag` | Omitted          |
| `AtclauseOrder`                     | `@param`, `@return`, `@throws`, `@deprecated`                             | Same             |
| `NonEmptyAtclauseDescription`       | On                                                                        | On               |
| `JavadocTagContinuationIndentation` | Offset `0`                                                                | Same             |

`allowMissingReturnTag` is there for the inline `{@return}` tag. Checkstyle does not read it, so
without the property it demands a trailing `@return` on a comment that already has one. Doclint does
read it, which is why the `missing` group still fails a return value documented nowhere. Write
`{@return the resolved path}` as the summary of a getter rather than a summary plus a `@return`
saying the same thing.

The application tier omits `JavadocMethod` because an application has no API surface for a
consumer to reach. Doclint at the `/protected` level is still the gate there; what drops is the
second, stricter check.

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

None of the three works until it is registered on the `javadoc` task, as [the gate](#the-gate) does.

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
stops compiling breaks CI. The `javadoc` task finds it through `--snippet-path`, which has to name
that source set's directory; without the option, `javadoc` looks only in a `snippet-files`
directory beside the package. An inline `<pre>{@code ...}</pre>` block is checked by nothing, which puts
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
[PROSE.md](../readme/PROSE.md), not by this file: one line that names the mechanism, with every
qualifier doing real work.

The Javadoc on the recipe class answers a different question, for a maintainer. This is
`MigrateGuiToNewApi` in rewrite-recipes:

```java
/**
 * Renames the three {@code Gui} members that kept their meaning across InvUI 1.x and 2.x.
 *
 * <p>{@code normal(Consumer)} did not, and is replaced by an immediately invoked supplier that
 * applies the consumer to {@code Gui.builder()}. A rename would have left the consumer sitting in
 * the argument list of a factory that no longer takes one.
 */
```

The summary says what the recipe does and where that stops. The second paragraph names the one
member that is not a rename and why a rename would have been wrong, which is the fact the next
person needs before adding a matcher to the same visitor.
