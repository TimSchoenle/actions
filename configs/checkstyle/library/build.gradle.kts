// See ../buildSrc/src/main/kotlin/checkstyle-ruleset.gradle.kts for what this applies. Published
// to JitPack via the repo-root jitpack.yml, which builds ../build.gradle.kts (this subfolder)
// explicitly, since JitPack only auto-discovers a build file at the repo root by default.
plugins {
    id("checkstyle-ruleset")
}
