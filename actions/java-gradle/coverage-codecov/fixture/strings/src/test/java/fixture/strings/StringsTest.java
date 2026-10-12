package fixture.strings;

import static org.junit.jupiter.api.Assertions.assertEquals;

import org.junit.jupiter.api.Test;

class StringsTest {
    @Test
    void upperCases() {
        assertEquals("A", Strings.upper("a"));
    }
}
