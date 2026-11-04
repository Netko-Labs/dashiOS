//! Link libghostty-vt (libghostty-vt-devel puts it in the default search path).
fn main() {
    println!("cargo:rustc-link-lib=dylib=ghostty-vt");
    println!("cargo:rerun-if-changed=build.rs");
}
