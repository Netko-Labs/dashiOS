//! CTAP2 (FIDO's Client to Authenticator Protocol 2.1): authenticatorGetInfo,
//! authenticatorMakeCredential and authenticatorGetAssertion, the three a
//! browser needs for passkeys. Every passkey is resident and P-256; there is
//! no PIN: user verification is built in (the fingerprint reader or the
//! login password, asked by `approve`), and every use asks.

mod assertion;
mod cbor;
mod env;
mod info;
mod make;
mod status;

pub use assertion::get_assertion;
pub use env::{Ask, Env, WithVault};
pub use info::get_info;
pub use make::make_credential;
pub use status::*;

// What the tests (ctap2/tests.rs) reach through `super`.
#[cfg(test)]
use super::store::{self, AT, UP, UV};
#[cfg(test)]
use cbor::encode;

/// A CTAPHID CBOR message (its first byte the command), answered: a status byte, then CBOR.
pub fn handle(message: &[u8], env: &Env<'_>) -> Vec<u8> {
    let Some((&command, params)) = message.split_first() else {
        return vec![INVALID_COMMAND];
    };
    let result = match command {
        GET_INFO => Ok(get_info()),
        MAKE_CREDENTIAL => make_credential(params, env),
        GET_ASSERTION => get_assertion(params, env),
        _ => Err(INVALID_COMMAND),
    };
    result.unwrap_or_else(|status| vec![status])
}

#[cfg(test)]
mod tests;
