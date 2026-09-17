package com.example;

/**
 * A minimal, fully-documented example used only to prove the library ruleset still loads and
 * accepts compliant code against the pinned Checkstyle version.
 */
public final class CompliantLibraryExample {

    private static final String GREETING = "Hello";

    private CompliantLibraryExample() {
        throw new UnsupportedOperationException();
    }

    /**
     * Builds a greeting for the given name.
     *
     * @param name the name to greet
     * @return the greeting
     */
    static String greet(final String name) {
        final String trimmedName = name.trim();
        return GREETING + ", " + trimmedName + "!";
    }
}
