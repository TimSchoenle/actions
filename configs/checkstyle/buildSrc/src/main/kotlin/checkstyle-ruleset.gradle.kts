// Convention plugin for a publishable ruleset module under configs/checkstyle/<name>/. Applying it
// is the entire module build file - see ../../application/build.gradle.kts and
// ../../library/build.gradle.kts. To add a new ruleset: create configs/checkstyle/<name>/ with
// checkstyle.xml + checkstyle-suppressions.xml, a one-line build.gradle.kts applying this plugin,
// and register it in ../../settings.gradle.kts the same way application/library are registered.
//
// checkstyle.xml resolves its own suppression files via `${config_loc}`, a property only Gradle's
// `configDirectory`/Maven's `propertyExpansion` set, and only when config comes from a local
// directory (see the comment at the top of CheckstyleParser.parseCheckstyleMeta in
// scripts/lib/readme/parsers/checkstyle-parser.ts). A jar dependency has no such directory, so
// every `${config_loc}/...` property is rewritten to a `classpath:` URI in the copy that goes into
// the jar, which Checkstyle resolves against whatever jar/classpath entry supplied the config. That
// includes the optional `custom-suppressions.xml` hook: an *empty* placeholder
// (../_shared/custom-suppressions.xml) is packaged alongside it so the property always resolves
// without requiring a jar consumer to configure anything. A jar consumer who wants their own local
// suppressions on top of a ruleset adds a second SuppressionFilter/SuppressionXpathFilter in their
// own Checkstyle config instead of trying to override the packaged placeholder; see the comment in
// that placeholder file for why.

plugins {
    id("java")
    `maven-publish`
}

val generateCheckstyleResources =
    tasks.register<Sync>("generateCheckstyleResources") {
        from(projectDir) {
            include("checkstyle.xml")
            filteringCharset = "UTF-8"
            filter { line: String ->
                line
                    .replace("\${config_loc}/checkstyle-suppressions.xml", "classpath:/checkstyle-suppressions.xml")
                    .replace("\${config_loc}/custom-suppressions.xml", "classpath:/custom-suppressions.xml")
                    .replace(
                        "\${config_loc}/../_shared/lombok-xpath-suppressions.xml",
                        "classpath:/lombok-xpath-suppressions.xml",
                    )
            }
        }
        from(projectDir) {
            include("checkstyle-suppressions.xml")
        }
        from(rootProject.projectDir.resolve("_shared")) {
            include("lombok-xpath-suppressions.xml", "custom-suppressions.xml")
        }
        into(layout.buildDirectory.dir("generated/checkstyle-resources"))
    }

sourceSets {
    main {
        resources.srcDir(generateCheckstyleResources)
    }
}

publishing {
    publications {
        create<MavenPublication>("maven") {
            from(components["java"])
        }
    }
}
