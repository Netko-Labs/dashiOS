//! The TPM's share of the vault key, sealed and unsealed by `systemd-creds`
//! (`--with-key=tpm2`): a copy of the vault file is then useless on another
//! machine, however good the guess at the password. No TPM, or one
//! systemd-creds can't use: the password alone protects the vault, and the
//! file says so (Settings › Passwords shows it).

use std::{
    io::Write,
    path::Path,
    process::{Command, Stdio},
};

use zeroize::Zeroizing;

use crate::vault::Sealer;

const NAME: &str = "--name=dashi-vault";

pub struct SystemdCreds;

fn run(args: &[&str], input: &[u8]) -> Result<Zeroizing<Vec<u8>>, String> {
    let mut child = Command::new("systemd-creds")
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("systemd-creds: {e}"))?;
    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(input)
            .map_err(|e| format!("systemd-creds: {e}"))?;
    }
    let output = child
        .wait_with_output()
        .map_err(|e| format!("systemd-creds: {e}"))?;
    if !output.status.success() {
        return Err(format!("systemd-creds failed ({})", output.status));
    }
    Ok(Zeroizing::new(output.stdout))
}

impl Sealer for SystemdCreds {
    fn seal(&self, share: &[u8]) -> Result<Option<Vec<u8>>, String> {
        if !Path::new("/dev/tpmrm0").exists() {
            return Ok(None);
        }
        match run(&["encrypt", "--with-key=tpm2", NAME, "-", "-"], share) {
            Ok(blob) => Ok(Some(blob.to_vec())),
            Err(error) => {
                eprintln!(
                    "dashi-secretd: the TPM can't seal the vault key ({error}); the password alone protects it"
                );
                Ok(None)
            }
        }
    }

    fn unseal(&self, blob: &[u8]) -> Result<Zeroizing<Vec<u8>>, String> {
        run(&["decrypt", NAME, "-", "-"], blob)
    }
}
