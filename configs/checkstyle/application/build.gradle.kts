// See ../buildSrc/src/main/kotlin/checkstyle-ruleset.gradle.kts for what this applies. Published
// to JitPack via the repo-root jitpack.yml, which builds ../build.gradle.kts (this subfolder)
// explicitly, since JitPack only auto-discovers a build file at the repo root by default. That
// install command invokes ../gradlew directly on a Linux image, which needs its executable bit
// intact in git - lost it once already (v1.0.0/v1.0.1 both failed on JitPack as a result).
plugins {
    id("checkstyle-ruleset")
}
