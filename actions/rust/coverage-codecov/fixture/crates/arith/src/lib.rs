//! Two functions with known coverage: the verify workflow asserts that the report marks the
//! first as hit and the second as missed, so a change in the report format fails it.

/// Called by the test below, so every line of it is covered.
pub fn covered(value: u32) -> u32 {
    value + 1
}

/// Called by nothing, so every line of it is missed.
pub fn uncovered(value: u32) -> u32 {
    value * 2
}

#[cfg(test)]
mod tests {
    #[test]
    fn covered_adds_one() {
        assert_eq!(super::covered(1), 2);
    }

    /// Fails when `FIXTURE_FAIL` is set, which is how the workflow produces a failing run
    /// without a second fixture.
    #[test]
    fn fails_on_request() {
        assert!(std::env::var_os("FIXTURE_FAIL").is_none(), "FIXTURE_FAIL is set");
    }
}
