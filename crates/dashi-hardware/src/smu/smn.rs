//! SMN access: 32-bit reads and writes of the System Management Network,
//! through the PCI root complex's config space (device `0000:00:00.0`, the
//! index register at `0xB8`, the data register at `0xBC`), the way RyzenAdj
//! reaches it without `/dev/mem` or a kernel module.
//!
//! The real backend seeks into the device's `config` file. The simulated one
//! is a map of addresses, with the MP1 mailbox modelled, for tests and the
//! `--sysfs-root` CLI. SMU writes are never run on this host: only the
//! simulation is exercised.

use std::io;

mod sim;

pub(crate) use sim::SimSmu;

/// The config-space offsets of the two registers.
pub(crate) const REG_INDEX: u64 = 0xB8;
pub(crate) const REG_DATA: u64 = 0xBC;
/// The root complex, where those registers live.
pub(crate) const ROOT_COMPLEX: &str = "0000:00:00.0";

/// Something that can read and write SMN registers.
pub(crate) trait Smn {
    fn read(&mut self, addr: u32) -> io::Result<u32>;
    fn write(&mut self, addr: u32, data: u32) -> io::Result<()>;
}

/// The real root complex, reached through its `config` file under the tree.
pub(crate) struct PciSmn {
    config: std::path::PathBuf,
}

impl PciSmn {
    /// `sys_root` is the `/sys` the helper uses (always the real one for a
    /// real SMU; `--sysfs-root` uses the simulation instead of this).
    pub(crate) fn new(sys_root: &std::path::Path) -> Self {
        Self {
            config: sys_root
                .join("bus/pci/devices")
                .join(ROOT_COMPLEX)
                .join("config"),
        }
    }

    fn seek_u32(&self, file: &mut std::fs::File, offset: u64, value: u32) -> io::Result<()> {
        use std::io::{Seek, SeekFrom, Write};
        file.seek(SeekFrom::Start(offset))?;
        file.write_all(&value.to_le_bytes())
    }

    fn read_u32(&self, file: &mut std::fs::File, offset: u64) -> io::Result<u32> {
        use std::io::{Read, Seek, SeekFrom};
        file.seek(SeekFrom::Start(offset))?;
        let mut buf = [0u8; 4];
        file.read_exact(&mut buf)?;
        Ok(u32::from_le_bytes(buf))
    }
}

impl Smn for PciSmn {
    fn read(&mut self, addr: u32) -> io::Result<u32> {
        // RyzenAdj aligns the index to 4 bytes on a read.
        let mut file = std::fs::OpenOptions::new().read(true).write(true).open(&self.config)?;
        self.seek_u32(&mut file, REG_INDEX, addr & !0x3)?;
        self.read_u32(&mut file, REG_DATA)
    }

    fn write(&mut self, addr: u32, data: u32) -> io::Result<()> {
        let mut file = std::fs::OpenOptions::new().read(true).write(true).open(&self.config)?;
        self.seek_u32(&mut file, REG_INDEX, addr)?;
        self.seek_u32(&mut file, REG_DATA, data)
    }
}
