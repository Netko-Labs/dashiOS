//! Who may do what, and that no reply carries a secret it shouldn't.

use serde_json::{Value, json};

use super::{protocol::Request, reply::Reply, *};
use crate::{
    caller::Caller,
    vault::{NoTpm, crypto::KdfParams, store::Store},
};

mod access;
mod fixtures;
mod items;
mod payments;
