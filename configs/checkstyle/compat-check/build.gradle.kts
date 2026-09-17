// Not published anywhere. Runs both rulesets, in both consumption modes, against the Checkstyle
// version pinned in gradle/libs.versions.toml (bumped by Renovate's built-in Gradle version-catalog
// support) so a Checkstyle release that removes/renames a module or tightens a check fails CI here
// instead of silently breaking every downstream consumer.
//
// Also exercises every rule in ../_shared/lombok-xpath-suppressions.xml end to end: each fixture in
// src/fixtures/shared/lombok is written the way Lombok expects it (no explicit "static"/"final"/
// "private" that Lombok itself would add), so running the real ruleset against it proves the
// suppression actually fires, and a matching single-check negative control (src/negative-control)
// proves the same fixture would be flagged without it - so neither assertion is vacuous.

plugins {
    checkstyle
}

checkstyle {
    toolVersion = libs.versions.checkstyle.get()
}

val fixturesDir = layout.projectDirectory.dir("src/fixtures")
val sharedLombokFixtures = fixturesDir.dir("shared/lombok")
val negativeControlDir = layout.projectDirectory.dir("src/negative-control")

// rulesetDirName's own directory also holds the *publishable* module's build/ output (see
// ../application/build.gradle.kts): reading checkstyle.xml straight out of that directory makes
// this task's config-file input overlap the module's task outputs on disk, which Gradle's stricter
// task validation now rejects outright (not just as an ordering warning) once enough of that
// module's tasks - compileTestJava, test, jar, ... - have actually run in the same build. Copying
// the files each ruleset needs into compat-check's own build/ directory first sidesteps the whole
// category of problem instead of chasing it task by task. The relative layout is preserved
// (application/, library/, and _shared/ as siblings) because checkstyle.xml resolves the shared
// Lombok suppressions via `${config_loc}/../_shared/...`.
val vendorConfigCopy =
    tasks.register<Sync>("copyVendorConfig") {
        from(rootProject.layout.projectDirectory.dir("application")) {
            include("checkstyle.xml", "checkstyle-suppressions.xml")
            into("application")
        }
        from(rootProject.layout.projectDirectory.dir("library")) {
            include("checkstyle.xml", "checkstyle-suppressions.xml")
            into("library")
        }
        from(rootProject.layout.projectDirectory.dir("_shared")) {
            include("lombok-xpath-suppressions.xml")
            into("_shared")
        }
        into(layout.buildDirectory.dir("vendor-config"))
    }

// Vendor mode: the exact consumption path README.md documents today, `${config_loc}` and all.
fun registerVendorModeCheck(
    taskName: String,
    rulesetDirName: String,
    fixtureSubdir: String,
): TaskProvider<Checkstyle> =
    tasks.register<Checkstyle>(taskName) {
        dependsOn(vendorConfigCopy)
        val vendorConfigDir = vendorConfigCopy.get().destinationDir.resolve(rulesetDirName)
        classpath = files()
        config = resources.text.fromFile(vendorConfigDir.resolve("checkstyle.xml"))
        configDirectory.set(vendorConfigDir)
        source(fixturesDir.dir(fixtureSubdir))
        include("**/*.java")
        isIgnoreFailures = false
        reports {
            xml.required.set(true)
            html.required.set(false)
        }
    }

val checkstyleApplicationClean = registerVendorModeCheck("checkstyleApplicationClean", "application", "application/clean")
val checkstyleLibraryClean = registerVendorModeCheck("checkstyleLibraryClean", "library", "library/clean")
val checkstyleApplicationLombokSuppressed =
    registerVendorModeCheck("checkstyleApplicationLombokSuppressed", "application", "shared/lombok")
val checkstyleLibraryLombokSuppressed =
    registerVendorModeCheck("checkstyleLibraryLombokSuppressed", "library", "shared/lombok")

// Jar mode: the classpath: rewrite that application/build.gradle.kts and library/build.gradle.kts
// perform, exercised against the exact jar a JitPack consumer would resolve.
fun registerJarModeCheck(
    taskName: String,
    moduleProjectPath: String,
): TaskProvider<Checkstyle> =
    tasks.register<Checkstyle>(taskName) {
        val moduleProject = project(moduleProjectPath)
        dependsOn("$moduleProjectPath:jar")
        classpath = files()
        // `classpath:` URIs inside the config are resolved by Checkstyle's own classloader, which
        // Gradle builds from `checkstyleClasspath` (the tool classpath) - NOT from `classpath`
        // (the classpath of the sources under analysis). The module's jar has to join the former.
        checkstyleClasspath = configurations.getByName("checkstyle") + moduleProject.tasks.named("jar").get().outputs.files
        config =
            resources.text.fromFile(
                moduleProject.layout.buildDirectory
                    .file("generated/checkstyle-resources/checkstyle.xml")
                    .get()
                    .asFile,
            )
        source(sharedLombokFixtures)
        include("**/*.java")
        isIgnoreFailures = false
        reports {
            xml.required.set(true)
            html.required.set(false)
        }
    }

val checkstyleApplicationJarMode = registerJarModeCheck("checkstyleApplicationJarMode", ":checkstyle-application")
val checkstyleLibraryJarMode = registerJarModeCheck("checkstyleLibraryJarMode", ":checkstyle-library")

// One negative control per rule in ../_shared/lombok-xpath-suppressions.xml: a minimal,
// single-module config run against the one fixture file that rule's suppression targets, with
// isIgnoreFailures = true so the *expected* violation doesn't fail the build - a follow-up task
// asserts the report actually contains it.
data class LombokRuleControl(
    val id: String,
    val configFileName: String,
    val fixtureFileName: String,
    val checkName: String,
)

val lombokRuleControls =
    listOf(
        LombokRuleControl("requireThis", "require-this-only.xml", "GreeterUtils.java", "RequireThis"),
        LombokRuleControl("finalClass", "final-class-only.xml", "GreeterUtils.java", "FinalClass"),
        LombokRuleControl("designForExtension", "design-for-extension-only.xml", "GreeterUtils.java", "DesignForExtension"),
        LombokRuleControl(
            "visibilityModifierValue",
            "visibility-modifier-only.xml",
            "ImmutableValidationException.java",
            "VisibilityModifier",
        ),
        LombokRuleControl(
            "mutableExceptionValue",
            "mutable-exception-only.xml",
            "ImmutableValidationException.java",
            "MutableException",
        ),
        // @FieldDefaults is matched by the same suppress-xpath as @Value for these two checks (see
        // ../_shared/lombok-xpath-suppressions.xml), but is a genuinely different annotation with
        // its own fixture - ConfiguredException uses @FieldDefaults alone, not @Value - so both
        // branches of that "Value or FieldDefaults" match are actually exercised, not just one.
        LombokRuleControl(
            "visibilityModifierFieldDefaults",
            "visibility-modifier-only.xml",
            "ConfiguredException.java",
            "VisibilityModifier",
        ),
        LombokRuleControl(
            "mutableExceptionFieldDefaults",
            "mutable-exception-only.xml",
            "ConfiguredException.java",
            "MutableException",
        ),
        LombokRuleControl("finalLocalVariable", "final-local-variable-only.xml", "TimestampedEvent.java", "FinalLocalVariable"),
        LombokRuleControl("localVariableName", "local-variable-name-only.xml", "TimestampedEvent.java", "LocalVariableName"),
        LombokRuleControl("memberName", "member-name-only.xml", "GreeterUtils.java", "MemberName"),
    )

val verifyLombokRuleControlsFires = mutableListOf<TaskProvider<Task>>()

lombokRuleControls.forEach { control ->
    val taskId = control.id.replaceFirstChar { it.uppercase() }

    val negativeControlCheck =
        tasks.register<Checkstyle>("checkstyleLombok${taskId}NegativeControl") {
            classpath = files()
            config = resources.text.fromFile(negativeControlDir.file(control.configFileName).asFile)
            source(sharedLombokFixtures.file("com/example/${control.fixtureFileName}"))
            isIgnoreFailures = true
            reports {
                xml.required.set(true)
                html.required.set(false)
            }
        }

    val verifyFires =
        tasks.register<Task>("verifyLombok${taskId}NegativeControlFires") {
            dependsOn(negativeControlCheck)
            val reportFile = negativeControlCheck.map { it.reports.xml.outputLocation.get().asFile }
            val checkName = control.checkName
            val fixtureFileName = control.fixtureFileName
            doLast {
                val report = reportFile.get()
                val violations = Regex("<error[\\s>]").findAll(report.readText()).count()
                if (violations == 0) {
                    throw GradleException(
                        "Negative control at $report reported zero $checkName violations against " +
                            "src/fixtures/shared/lombok/com/example/$fixtureFileName; that fixture no longer " +
                            "exercises the check, so the suppressed assertions above prove nothing about " +
                            "whether the suppression for it still works.",
                    )
                }
            }
        }

    verifyLombokRuleControlsFires.add(verifyFires)
}

tasks.register("verifyCheckstyleCompat") {
    description =
        "Runs both rulesets against fixtures, in vendor and jar-classpath consumption modes, " +
            "against the Checkstyle version pinned in gradle/libs.versions.toml, and proves every " +
            "rule in ../_shared/lombok-xpath-suppressions.xml both fires unsuppressed and is " +
            "suppressed by the real ruleset."
    dependsOn(
        checkstyleApplicationClean,
        checkstyleLibraryClean,
        checkstyleApplicationLombokSuppressed,
        checkstyleLibraryLombokSuppressed,
        checkstyleApplicationJarMode,
        checkstyleLibraryJarMode,
    )
    dependsOn(verifyLombokRuleControlsFires)
}
