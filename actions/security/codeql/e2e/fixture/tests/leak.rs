//! The leak the end-to-end job expects the shared `**/tests/**` pattern to exclude.

#[test]
fn prints_a_password() {
    let password = String::from("fixture-password");
    println!("password = {}", password);
}
