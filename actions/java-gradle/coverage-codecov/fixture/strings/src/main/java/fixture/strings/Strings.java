package fixture.strings;

/** Reached by `test` through {@link #upper} and by `extraTest` through {@link #lower}. */
public final class Strings {
    private Strings() {}

    public static String upper(String value) {
        return value.toUpperCase(java.util.Locale.ROOT);
    }

    public static String lower(String value) {
        return value.toLowerCase(java.util.Locale.ROOT);
    }
}
