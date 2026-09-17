// Root of the Gradle build that packages configs/checkstyle/{application,library} as JitPack
// artifacts. JitPack finds this subfolder build automatically (see repo-root jitpack.yml for the
// JDK override) and runs `./gradlew build publishToMavenLocal`, injecting the requested git tag as
// the VERSION environment variable. See application/build.gradle.kts for the packaging mechanics.

allprojects {
    group = "de.timscho"
    version = System.getenv("VERSION") ?: "local"
}
