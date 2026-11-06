//! The CPU family from CPUID, the way RyzenAdj reads it: vendor from leaf 0,
//! family and model from leaf 1. Only AMD is of interest.

use super::mailbox::Family;

/// The running CPU's family, or `None` when it isn't an AMD part Dashi knows.
pub(crate) fn detect_family() -> Option<Family> {
    let (vendor_ebx, vendor_edx, vendor_ecx) = cpuid(0);
    if !is_amd(vendor_ebx, vendor_edx, vendor_ecx) {
        return None;
    }
    let (eax, ..) = cpuid_eax(1);
    let (family, model) = family_model(eax);
    Family::from_cpuid(family, model)
}

/// "AuthenticAMD" is EBX="Auth", EDX="enti", ECX="cAMD".
fn is_amd(ebx: u32, edx: u32, ecx: u32) -> bool {
    ebx == u32::from_le_bytes(*b"Auth")
        && edx == u32::from_le_bytes(*b"enti")
        && ecx == u32::from_le_bytes(*b"cAMD")
}

/// The extended family and model from leaf 1's EAX, as x86 defines them.
fn family_model(eax: u32) -> (u32, u32) {
    let base_family = (eax >> 8) & 0xF;
    let base_model = (eax >> 4) & 0xF;
    let family = base_family + ((eax >> 20) & 0xFF);
    let model = base_model | (((eax >> 16) & 0xF) << 4);
    (family, model)
}

#[cfg(target_arch = "x86_64")]
fn cpuid(leaf: u32) -> (u32, u32, u32) {
    // CPUID is always available on x86-64 and has no side effects.
    let result = std::arch::x86_64::__cpuid(leaf);
    (result.ebx, result.edx, result.ecx)
}

#[cfg(target_arch = "x86_64")]
fn cpuid_eax(leaf: u32) -> (u32, u32, u32, u32) {
    let r = std::arch::x86_64::__cpuid(leaf);
    (r.eax, r.ebx, r.ecx, r.edx)
}

#[cfg(not(target_arch = "x86_64"))]
fn cpuid(_leaf: u32) -> (u32, u32, u32) {
    (0, 0, 0)
}

#[cfg(not(target_arch = "x86_64"))]
fn cpuid_eax(_leaf: u32) -> (u32, u32, u32, u32) {
    (0, 0, 0, 0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_hx_370s_signature_is_strix_point() {
        // family 0x1A, model 0x24: base family 0xF, ext family 0x0B,
        // base model 0x4, ext model 0x2.
        let eax = (0x2 << 16) | (0x0B << 20) | (0xF << 8) | (0x4 << 4);
        assert_eq!(family_model(eax), (0x1A, 0x24));
        assert_eq!(Family::from_cpuid(0x1A, 0x24), Some(Family::StrixPoint));
    }

    #[test]
    fn the_amd_vendor_string_is_recognised() {
        assert!(is_amd(
            u32::from_le_bytes(*b"Auth"),
            u32::from_le_bytes(*b"enti"),
            u32::from_le_bytes(*b"cAMD"),
        ));
        // "GenuineIntel"
        assert!(!is_amd(
            u32::from_le_bytes(*b"Genu"),
            u32::from_le_bytes(*b"ineI"),
            u32::from_le_bytes(*b"ntel"),
        ));
    }
}
