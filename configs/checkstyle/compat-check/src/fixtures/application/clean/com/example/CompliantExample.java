package com.example;

public final class CompliantExample {

    private static final String GREETING = "Hello";

    private CompliantExample() {
        throw new UnsupportedOperationException();
    }

    static String greet(final String name) {
        final String trimmedName = name.trim();
        return GREETING + ", " + trimmedName + "!";
    }
}
