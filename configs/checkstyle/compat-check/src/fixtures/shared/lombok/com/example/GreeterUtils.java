package com.example;

import lombok.experimental.UtilityClass;

/**
 * Deliberately omits the {@code static} keyword on its field and method: {@code @UtilityClass}
 * adds it via Lombok, which is exactly the case configs/checkstyle/_shared/lombok-xpath-suppressions.xml
 * exists to keep RequireThis from flagging. The single-character field {@code n} additionally
 * proves MemberName is suppressed too: MemberName's configured pattern here requires 2+ characters,
 * but StaticVariableName's (unconfigured, default) pattern allows 1+ - since a field Lombok will
 * make static is classified as MemberName by Checkstyle (no "static" keyword ever appears in
 * source), a single-char name would otherwise be wrongly rejected against the stricter pattern.
 */
@UtilityClass
public class GreeterUtils {

    private String prefix = "Hello, ";
    private String n = "N/A";

    public String greet(final String name) {
        return name.isEmpty() ? n : prefix + name;
    }

    /**
     * A private nested holder with no declared constructor: FinalClass fires on any zero-constructor
     * {@code private} class regardless of Lombok (this is the shape that actually triggers it, unlike
     * the outer class above, which has no explicit constructor either but is not itself {@code private}
     * and so never matches FinalClass's own trigger conditions). {@code @UtilityClass} still makes it
     * final via Lombok without writing the keyword, so the same suppression applies here too.
     */
    @UtilityClass
    private static class Defaults {

        private String fallbackName = "friend";
    }
}
