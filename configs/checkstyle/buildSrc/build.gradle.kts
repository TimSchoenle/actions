// buildSrc is its own, independent Gradle build: it needs its own repositories to resolve the
// kotlin-dsl plugin used to compile the precompiled script plugin(s) under src/main/kotlin.

plugins {
    `kotlin-dsl`
}

repositories {
    gradlePluginPortal()
    mavenCentral()
}
