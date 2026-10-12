package fixture.arith;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

import org.junit.jupiter.api.Test;

class ArithTest {
    @Test
    void coveredAddsOne() {
        assertEquals(2, Arith.covered(1));
    }

    /** Fails when FIXTURE_FAIL is set, which is how the workflow produces a failing run. */
    @Test
    void failsOnRequest() {
        assertNull(System.getenv("FIXTURE_FAIL"), "FIXTURE_FAIL is set");
    }
}
