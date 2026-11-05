//! The Curve Optimizer's numbers: how an offset and a core index become the
//! argument the SMU's MP1 mailbox takes (docs/hardware.md, "The Curve
//! Optimizer"). Pure arithmetic; no hardware.

/// MP1 message ids (RyzenAdj, Strix Point / Zen 5 and relatives).
pub(crate) const MSG_SET_ALL_CORE: u32 = 0x4C;
pub(crate) const MSG_SET_PER_CORE: u32 = 0x4B;

/// The widths the SMU reads: a 20-bit offset, the core in the bits above it.
const OFFSET_BITS: u32 = 20;
const OFFSET_MASK: u32 = (1 << OFFSET_BITS) - 1; // 0xFFFFF
const OFFSET_SIGN: i32 = 1 << (OFFSET_BITS - 1); // 0x80000, −0x80000 is the floor

/// The inclusive offset range the encoding can carry.
pub(crate) const OFFSET_MIN: i32 = -OFFSET_SIGN;
pub(crate) const OFFSET_MAX: i32 = OFFSET_SIGN - 1;

/// An all-core offset as `0x100000 + offset` (−5 → `0xFFFFB`), 20-bit two's
/// complement. A plain negative 32-bit value is what the SMU rejects.
pub(crate) fn all_core_arg(offset: i32) -> Result<u32, String> {
    in_range(offset)?;
    Ok((offset as u32) & OFFSET_MASK)
}

/// A per-core offset: the core index in the bits above the 20-bit offset.
pub(crate) fn per_core_arg(core: u32, offset: i32) -> Result<u32, String> {
    in_range(offset)?;
    // The core index rides in the 12 bits above the 20-bit offset.
    if core > (u32::MAX >> OFFSET_BITS) {
        return Err(format!("core {core} is out of range"));
    }
    Ok((core << OFFSET_BITS) | ((offset as u32) & OFFSET_MASK))
}

/// The offset a 20-bit all-core argument carries (for the simulated SMU and
/// read-back): sign-extend bit 19.
pub(crate) fn decode_all_core(arg: u32) -> i32 {
    let low = (arg & OFFSET_MASK) as i32;
    if low & OFFSET_SIGN != 0 {
        low - (1 << OFFSET_BITS)
    } else {
        low
    }
}

/// The (core, offset) a per-core argument carries.
pub(crate) fn decode_per_core(arg: u32) -> (u32, i32) {
    (arg >> OFFSET_BITS, decode_all_core(arg))
}

fn in_range(offset: i32) -> Result<(), String> {
    if (OFFSET_MIN..=OFFSET_MAX).contains(&offset) {
        Ok(())
    } else {
        Err(format!("offset {offset} is outside the 20-bit range"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn negative_five_is_the_verified_encoding() {
        // The value this laptop accepted on 2026-11-04: 0x100000 − 5.
        assert_eq!(all_core_arg(-5), Ok(0xF_FFFB));
        assert_eq!(all_core_arg(-5).unwrap(), 0x100000 - 5);
        assert_eq!(decode_all_core(0xFFFFB), -5);
    }

    #[test]
    fn zero_and_the_bounds_round_trip() {
        for offset in [0, -1, -40, OFFSET_MIN, OFFSET_MAX, 30] {
            let arg = all_core_arg(offset).expect("in range");
            assert_eq!(decode_all_core(arg), offset, "offset {offset}");
        }
        assert_eq!(all_core_arg(0), Ok(0));
        assert!(all_core_arg(OFFSET_MIN - 1).is_err());
        assert!(all_core_arg(OFFSET_MAX + 1).is_err());
    }

    #[test]
    fn per_core_packs_the_core_above_the_offset() {
        let arg = per_core_arg(3, -5).expect("in range");
        assert_eq!(arg, (3 << 20) | 0xFFFFB);
        assert_eq!(decode_per_core(arg), (3, -5));
        assert_eq!(decode_per_core(per_core_arg(0, 0).unwrap()), (0, 0));
    }
}
