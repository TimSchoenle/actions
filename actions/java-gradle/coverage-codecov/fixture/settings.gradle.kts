// Fixture for verify-action-java-gradle-coverage-codecov. Two projects, so the action has to find
// one report per project, and a root project without the java plugin, which is the common shape.
rootProject.name = "coverage-fixture"

include("arith", "strings")
