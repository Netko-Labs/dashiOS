//! A simulated Strix Point SMU: enough of the MP1 mailbox to exercise the
//! encoding and the request sequence without any hardware. Used by
//! `--sysfs-root` and the tests.

use std::collections::HashMap;
use std::io;

use super::super::encode::{MSG_SET_ALL_CORE, MSG_SET_PER_CORE, decode_all_core, decode_per_core};
use super::super::mailbox::{Mp1, strix_point};
use super::Smn;

const REP_MSG_OK: u32 = 0x1;
const REP_MSG_UNKNOWN: u32 = 0xFE;
const SMU_TEST_MSG: u32 = 0x1;

/// A simulated SMU with the Strix Point mailbox, holding the offsets it has
/// been given since its last "reboot".
#[derive(Clone, Debug, Default)]
pub(crate) struct SimSmu {
    regs: HashMap<u32, u32>,
    mp1: Option<Mp1>,
    pub(crate) all_core: i32,
    pub(crate) per_core: HashMap<u32, i32>,
    /// Refuse writes, as a locked-down kernel does (the PCI write check fails).
    pub(crate) writable: bool,
}

impl SimSmu {
    pub(crate) fn new() -> Self {
        Self {
            writable: true,
            mp1: Some(strix_point()),
            ..Self::default()
        }
    }

    /// Set which addresses answer (none when the family is unknown).
    #[cfg(test)]
    pub(crate) fn with_mailbox(mut self, mp1: Option<Mp1>) -> Self {
        self.mp1 = mp1;
        self
    }

    fn handle_message(&mut self, id: u32) {
        let Some(mp1) = self.mp1 else { return };
        let arg0 = self.regs.get(&mp1.arg_base).copied().unwrap_or(0);
        let response = match id {
            SMU_TEST_MSG => REP_MSG_OK,
            MSG_SET_ALL_CORE => {
                self.all_core = decode_all_core(arg0);
                REP_MSG_OK
            }
            MSG_SET_PER_CORE => {
                let (core, offset) = decode_per_core(arg0);
                self.per_core.insert(core, offset);
                REP_MSG_OK
            }
            _ => REP_MSG_UNKNOWN,
        };
        self.regs.insert(mp1.response, response);
    }
}

impl Smn for SimSmu {
    fn read(&mut self, addr: u32) -> io::Result<u32> {
        Ok(self.regs.get(&addr).copied().unwrap_or(0))
    }

    fn write(&mut self, addr: u32, data: u32) -> io::Result<()> {
        if !self.writable {
            // A read-back of the write will not match: the caller sees the
            // PCI bus as not writable, exactly as under lockdown.
            return Ok(());
        }
        self.regs.insert(addr, data);
        if let Some(mp1) = self.mp1
            && addr == mp1.message
        {
            self.handle_message(data);
        }
        Ok(())
    }
}
