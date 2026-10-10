//! The leak the end-to-end job excludes through the `paths-ignore` input.

/// Prints a password to standard output.
pub fn report() {
    let password = String::from("fixture-password");
    println!("password = {}", password);
}
