//! One person's vault: a random vault key seals the body (every item); the
//! vault key is itself sealed by a key derived from the login password and,
//! where there is a TPM, a share only this machine's TPM can unseal. The file
//! is JSON: the header in the clear, the rest sealed (docs/secrets.md).

pub mod bytes;
pub mod crypto;
mod file;
pub mod item;
mod lifecycle;
mod sealer;
pub mod store;
pub mod token;
mod wrapping;

#[cfg(test)]
mod tests;

pub use item::Data;
pub use lifecycle::Vault;
pub use sealer::{NoTpm, Sealer};
