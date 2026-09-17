dependencyResolutionManagement {
    repositories {
        mavenCentral()
    }
}

rootProject.name = "checkstyle-configs"

// Directory names stay `application` / `library` so the existing vendoring paths documented in
// README.md (and read by scripts/lib/readme/parsers/checkstyle-parser.ts) are untouched. Only the
// Gradle-facing project name changes, which is what becomes the Maven/JitPack artifact id.
include("application")
include("library")
include("compat-check")

project(":application").name = "checkstyle-application"
project(":library").name = "checkstyle-library"
