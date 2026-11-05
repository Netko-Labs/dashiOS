//! dashi-hardware: Dashi's privileged hardware helper (docs/hardware.md).

mod fans;
mod knobs;
mod model;
mod sysfs;

fn main() {
    let _ = sysfs::Sysfs::real();
    eprintln!("dashi-hardware: not built yet");
    std::process::exit(2);
}
