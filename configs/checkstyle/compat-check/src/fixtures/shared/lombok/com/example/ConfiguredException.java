package com.example;

import lombok.AccessLevel;
import lombok.experimental.FieldDefaults;

/**
 * Uses {@code @FieldDefaults} directly - not {@code @Value} - to prove the suppression covers this
 * annotation on its own, not just as part of {@code @Value}. Deliberately not declared
 * {@code final}: unlike {@code @Value}, {@code @FieldDefaults} never affects the class itself (only
 * field defaults), so FinalClass is correctly NOT suppressed for it; see the narrowed FinalClass
 * suppress-xpath in ../_shared/lombok-xpath-suppressions.xml. It still doesn't fire here, for the
 * same reason it never fires on GreeterUtils's outer class: a public class with no explicit
 * constructor never matches FinalClass's own trigger conditions.
 */
@FieldDefaults(makeFinal = true, level = AccessLevel.PRIVATE)
public class ConfiguredException extends RuntimeException {
    String detail = "unset";
}
