//! The one leak the end-to-end job expects CodeQL to report.
//!
//! `rust/cleartext-logging` treats a value named `password` as sensitive and `println!` as a log
//! sink. This file is outside every excluded pattern, so its alert is the proof that the analysis
//! ran at all; the same leak in `vendored.rs` and `tests/leak.rs` must not be reported.

mod vendored;

/// Prints a password to standard output.
pub fn report() {
    let password = String::from("fixture-password");
    println!("password = {}", password);
    vendored::report();
}
