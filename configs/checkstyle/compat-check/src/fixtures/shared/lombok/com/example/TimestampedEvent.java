package com.example;

import lombok.val;

/**
 * Deliberately omits {@code final} on the local variable: {@code lombok.val} forces it via type
 * inference, which is exactly what configs/checkstyle/_shared/lombok-xpath-suppressions.xml exists
 * to keep FinalLocalVariable from flagging. {@code describeFirst} additionally uses a single-char
 * name outside a for-loop: LocalVariableName's configured pattern requires 2+ characters, but
 * LocalFinalVariableName's (unconfigured, default) pattern allows 1+ - since Checkstyle classifies
 * a variable as final/non-final from the "final" keyword actually written in source, a `val`
 * variable is checked against LocalVariableName's stricter pattern even though it is, in truth,
 * final, so a single-char `val` name is wrongly rejected unless that check is suppressed too.
 */
final class TimestampedEvent {

    String describe() {
        val label = "event";
        return label;
    }

    String describeFirst() {
        val e = "event";
        return e;
    }
}
