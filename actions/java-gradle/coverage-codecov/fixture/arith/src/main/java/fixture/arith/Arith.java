package fixture.arith;

/** Two methods with known coverage, asserted line by line by the verify workflow. */
public final class Arith {
    private Arith() {}

    public static int covered(int value) {
        return value + 1;
    }

    public static int uncovered(int value) {
        return value * 2;
    }
}
