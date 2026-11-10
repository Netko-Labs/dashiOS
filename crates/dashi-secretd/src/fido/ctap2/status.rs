//! CTAP2 command bytes, status bytes, and this key's AAGUID.

pub const MAKE_CREDENTIAL: u8 = 0x01;
pub const GET_ASSERTION: u8 = 0x02;
pub const GET_INFO: u8 = 0x04;

pub const OK: u8 = 0x00;
pub const INVALID_COMMAND: u8 = 0x01;
pub const INVALID_CBOR: u8 = 0x12;
pub const MISSING_PARAMETER: u8 = 0x14;
pub const CREDENTIAL_EXCLUDED: u8 = 0x19;
pub const UNSUPPORTED_ALGORITHM: u8 = 0x26;
pub const OPERATION_DENIED: u8 = 0x27;
pub const INVALID_OPTION: u8 = 0x2c;
pub const NO_CREDENTIALS: u8 = 0x2e;
pub const PIN_AUTH_INVALID: u8 = 0x33;
pub const PIN_NOT_SET: u8 = 0x35;
/// The vault is locked, or failed.
pub const OTHER: u8 = 0x7f;

/// Dashi's virtual key's AAGUID.
pub const AAGUID: [u8; 16] = *b"dashi-vault-key1";
