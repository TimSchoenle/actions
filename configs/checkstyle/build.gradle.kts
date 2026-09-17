// Root of the Gradle build that packages configs/checkstyle/{application,library} as JitPack
// artifacts. The repo-root jitpack.yml points JitPack at this subfolder explicitly (it only looks
// at the repo root by default, and that root is the TypeScript/Bun monorepo, not this build) and
// runs `./gradlew build publishToMavenLocal` here, injecting the requested git tag as the VERSION
// environment variable. See application/build.gradle.kts for the packaging mechanics.

allprojects {
    group = "de.timscho"
    version = System.getenv("VERSION") ?: "local"
}
