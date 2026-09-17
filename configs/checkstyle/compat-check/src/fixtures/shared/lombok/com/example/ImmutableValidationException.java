package com.example;

import lombok.Value;

/**
 * Deliberately omits {@code private}/{@code final} on its field and {@code final} on the class:
 * {@code @Value} adds all three via Lombok, which is exactly what
 * configs/checkstyle/_shared/lombok-xpath-suppressions.xml exists to keep VisibilityModifier and
 * MutableException from flagging. MutableException requires both the class's own name AND its
 * superclass's name to match "*Exception"/"*Error"/"*Throwable" (its default `format` and
 * `extendedClassNameFormat`), which is why this class - unlike the checkstyle-suppressions.xml
 * pattern for test sources - is deliberately named to end in "Exception" rather than "Failure".
 */
@Value
public class ImmutableValidationException extends RuntimeException {
    String reason;
}
