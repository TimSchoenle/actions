package fixture.strings;

import static org.junit.jupiter.api.Assertions.assertEquals;

import org.junit.jupiter.api.Test;

/** Run only by the `extraTest` task. */
class ExtraTest {
    @Test
    void lowerCases() {
        assertEquals("a", Strings.lower("A"));
    }
}
