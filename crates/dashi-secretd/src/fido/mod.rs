//! Passkeys as a security key (docs/secrets.md, "Passkeys"): dashi-secretd
//! makes a virtual FIDO2 key over uhid; browsers talk CTAPHID (ctaphid.rs)
//! and CTAP2 (ctap2.rs) to it; the keys live in the vault of the person at
//! the screen (store.rs); every use is asked about and needs the fingerprint
//! or the password (approval.rs, fprint.rs).

pub mod approval;
pub mod ctap2;
pub mod ctaphid;
pub mod fprint;
mod request;
mod run;
pub mod store;
pub mod uhid;

pub use run::{UHID, serve};
