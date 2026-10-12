// `extraTest` runs the one test class `test` excludes. The action's report has to merge every
// `Test` task's execution data, and the lines only `extraTest` reaches prove that it does.
val extraTest = tasks.register<Test>("extraTest") {
    testClassesDirs = sourceSets["test"].output.classesDirs
    classpath = sourceSets["test"].runtimeClasspath
    filter.includeTestsMatching("fixture.strings.ExtraTest")
}

tasks.named<Test>("test") {
    filter.excludeTestsMatching("fixture.strings.ExtraTest")
}
