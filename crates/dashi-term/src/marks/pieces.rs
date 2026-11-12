//! Cutting the shell's output where an OSC sequence ends.

/// `bytes` cut after each BEL and each ST (`ESC \`): the ends of OSC
/// sequences, so the terminal can be asked where its cursor is right after
/// each mark. `esc_before`: the last piece ended with ESC.
pub(crate) fn pieces(bytes: &[u8], esc_before: bool) -> Vec<&[u8]> {
    let mut out = Vec::new();
    let mut start = 0;
    for (at, byte) in bytes.iter().enumerate() {
        let st = *byte == b'\\'
            && if at == 0 {
                esc_before
            } else {
                bytes[at - 1] == 0x1b
            };
        if *byte == 0x07 || st {
            out.push(&bytes[start..=at]);
            start = at + 1;
        }
    }
    if start < bytes.len() {
        out.push(&bytes[start..]);
    }
    out
}
